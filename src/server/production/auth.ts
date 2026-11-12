import {createHash,randomBytes} from 'node:crypto';
import type {Request,RequestHandler} from 'express';
import {isFullAccessKey,isImplicitAccountOf,validAccountId,verifyNep413Signature} from '../near';
import {pool,withTx} from './db';

const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const cookieName='arena_session';
export const signInRecipient=()=>process.env.PUBLIC_HOSTNAME||'localhost';
const cookieValue=(req:Request)=>req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);

export async function sessionOwner(req:Request):Promise<{accountId:string;publicKey:string}|null>{
  const token=cookieValue(req);if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
  const r=await pool.query<{account_id:string;public_key:string}>('SELECT account_id,public_key FROM sessions WHERE token_hash=$1 AND expires_at>now()',[digest(token)]);
  return r.rows[0]?{accountId:r.rows[0].account_id,publicKey:r.rows[0].public_key}:null;
}
export const requireOwner:RequestHandler=async(req,res,next)=>{
  try{const owner=await sessionOwner(req);if(!owner){res.status(401).json({error:'Connect and sign in with your NEAR wallet.'});return;}
    res.locals.owner=owner.accountId;res.locals.ownerPublicKey=owner.publicKey;next();}catch(error){next(error);}
};

/** NEP-413 challenge: a fresh 32-byte nonce, single use, five minutes. */
export async function makeChallenge(){
  const nonce=randomBytes(32);
  const message=`Agent Arena sign-in\nPurpose: manage AI agents and NEAR tournament entries.\nIssued: ${new Date().toISOString()}`;
  await pool.query(`INSERT INTO sign_in_challenges(nonce,message,expires_at) VALUES($1,$2,now()+interval '5 minutes')`,[nonce.toString('hex'),message]);
  return{message,recipient:signInRecipient(),nonce:nonce.toString('base64')};
}

export async function verifyChallenge(body:{accountId?:unknown;publicKey?:unknown;signature?:unknown;nonce?:unknown}){
  const {accountId,publicKey,signature,nonce}=body;
  if(!validAccountId(accountId)||typeof publicKey!=='string'||typeof signature!=='string'||typeof nonce!=='string')throw new Error('Account, public key, signature and nonce required');
  const nonceBytes=Buffer.from(nonce,'base64');if(nonceBytes.length!==32)throw new Error('Invalid sign-in nonce');
  return withTx(async client=>{
    const found=await client.query<{message:string}>('DELETE FROM sign_in_challenges WHERE nonce=$1 AND expires_at>now() RETURNING message',[nonceBytes.toString('hex')]);
    const message=found.rows[0]?.message;if(!message)throw new Error('Sign-in challenge expired or already used');
    if(!verifyNep413Signature({publicKey,signature,message,nonce:nonceBytes,recipient:signInRecipient()}))throw new Error('Invalid NEAR wallet signature');
    // Named accounts: the key must be a full-access key onchain. Implicit accounts (e.g. NEAR Auth email/Google
    // sign-in) are self-certifying: the account id is the hex of the key, and they may not exist onchain yet.
    if(!isImplicitAccountOf(accountId,publicKey)&&!await isFullAccessKey(accountId,publicKey))throw new Error('The signing key is not a full-access key of this NEAR account');
    const token=randomBytes(32).toString('hex');
    await client.query(`INSERT INTO sessions(token_hash,account_id,public_key,expires_at) VALUES($1,$2,$3,now()+interval '7 days')`,[digest(token),accountId,publicKey]);
    return{accountId,token};
  });
}
export function sessionCookie(token:string,secure:boolean){return`${cookieName}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=604800${secure?'; Secure':''}`;}
export function clearSessionCookie(secure:boolean){return`${cookieName}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${secure?'; Secure':''}`;}
export async function revokeSession(req:Request){const token=cookieValue(req);if(token)await pool.query('DELETE FROM sessions WHERE token_hash=$1',[digest(token)]);}
