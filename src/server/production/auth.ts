import {createHash,randomBytes} from 'node:crypto';
import type {Request,RequestHandler} from 'express';
import {getAddress,isAddress,verifyMessage} from 'viem';
import {pool,withTx} from './db';

const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const cookieName='arena_session';
const cookieValue=(req:Request)=>req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
export async function sessionOwner(req:Request):Promise<string|null>{
  const token=cookieValue(req);if(!token||!new RegExp('^[a-f0-9]{64}$').test(token))return null;
  const result=await pool.query<{address:string}>('SELECT address FROM auth_sessions WHERE token_hash=$1 AND expires_at>now()',[digest(token)]);
  return result.rows[0]?.address||null;
}
export const requireOwner:RequestHandler=async(req,res,next)=>{
  try{const owner=await sessionOwner(req);if(!owner){res.status(401).json({error:'Connect and sign in with your creator wallet.'});return;}
    res.locals.owner=owner;next();}catch(nextError){next(nextError);}
};
export async function makeChallenge(addressInput:unknown){
  if(typeof addressInput!=='string'||!isAddress(addressInput))throw new Error('Valid EVM address required');
  const address=getAddress(addressInput).toLowerCase();
  const nonce=randomBytes(20).toString('hex');
  await pool.query(`INSERT INTO auth_challenges(address,nonce,expires_at) VALUES($1,$2,now()+interval '5 minutes')
    ON CONFLICT(address) DO UPDATE SET nonce=$2,expires_at=now()+interval '5 minutes'`,[address,nonce]);
  return{address,nonce,message:`Agent Arena sign-in\nDomain: ${process.env.PUBLIC_HOSTNAME||'localhost'}\nAddress: ${address}\nNonce: ${nonce}\nPurpose: Manage AI agents and Arc Testnet tournament entries.\nExpires: 5 minutes`};
}
export async function verifyChallenge(addressInput:unknown,message:unknown,signature:unknown){
  if(typeof addressInput!=='string'||!isAddress(addressInput)||typeof message!=='string'||typeof signature!=='string')throw new Error('Address, message and signature required');
  const address=getAddress(addressInput).toLowerCase();
  const domain=process.env.PUBLIC_HOSTNAME||'localhost';
  if(!message.startsWith(`Agent Arena sign-in\nDomain: ${domain}\nAddress: ${address}\nNonce: `))throw new Error('Sign-in message does not match this arena');
  const nonce=message.match(/\nNonce: ([a-f0-9]{40})\n/)?.[1];
  if(!nonce||!message.endsWith('\nPurpose: Manage AI agents and Arc Testnet tournament entries.\nExpires: 5 minutes'))throw new Error('Invalid sign-in challenge');
  if(!await verifyMessage({address:getAddress(address),message,signature:signature as `0x${string}`}))throw new Error('Invalid wallet signature');
  return withTx(async client=>{
    const deleted=await client.query('DELETE FROM auth_challenges WHERE address=$1 AND nonce=$2 AND expires_at>now() RETURNING address',[address,nonce]);
    if(!deleted.rowCount)throw new Error('Challenge expired or already used');
    const token=randomBytes(32).toString('hex');
    await client.query(`INSERT INTO auth_sessions(token_hash,address,expires_at) VALUES($1,$2,now()+interval '7 days')`,[digest(token),address]);
    return{address,token};
  });
}
export function sessionCookie(token:string,secure:boolean){return`${cookieName}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=604800${secure?'; Secure':''}`;}
export function clearSessionCookie(secure:boolean){return`${cookieName}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${secure?'; Secure':''}`;}
export async function revokeSession(req:Request){const token=cookieValue(req);if(token)await pool.query('DELETE FROM auth_sessions WHERE token_hash=$1',[digest(token)]);}
