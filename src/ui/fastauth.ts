/** NEAR Auth (FastAuth) sign-in: Google, Apple, email or passkey through Auth0, with the user's NEAR key
 * derived by the MPC network. No wallet, seed phrase or NEAR is needed.
 *
 * Redirect flow (popups are blocked after async work, so we use the documented `redirectUri` mode):
 *   1. startNearAuth(): Auth0 login → redirect back
 *   2. resumeNearAuth() stage "login": fetch a NEP-413 challenge, ask the user to approve it → redirect back
 *   3. resumeNearAuth() stage "sign": build the MPC `sign` action; the arena relayer submits it and pays gas;
 *      recover the ed25519 signature; the arena verifies it like any wallet signature.
 * The account is the implicit account (hex of the derived key). Loaded lazily: only this path pulls the SDK. */
export type FastAuthConfig={contractId:string;mpcContractId:string;clientId:string|null};
const SHARED_TESTNET_CLIENT_ID='np8paqIpMWmNbzT4xAvOOapZBjsOpptl'; // NEAR Auth's shared development client id
const STAGE='arena.nearauth.stage',CHALLENGE='arena.nearauth.challenge',RETURN='arena.nearauth.return';

const store={get:(k:string)=>{try{return sessionStorage.getItem(k);}catch{return null;}},set:(k:string,v:string)=>{try{sessionStorage.setItem(k,v);}catch{/* storage blocked */}},
  del:(k:string)=>{try{sessionStorage.removeItem(k);}catch{/* storage blocked */}}};
async function post<T>(path:string,body:unknown):Promise<T>{
  const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify(body)});
  const d=await r.json();if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);return d as T;
}
const toBase64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));
const fromBase64=(v:string)=>Uint8Array.from(atob(v),c=>c.charCodeAt(0));
const toHex=(bytes:Uint8Array)=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
const redirectUri=()=>`${location.origin}${location.pathname}`;

let clientPromise:Promise<{client:any;provider:any}>|null=null;
function load(cfg:FastAuthConfig){
  if(!clientPromise)clientPromise=(async()=>{
    // The NEAR Auth SDK (near-api-js v5) expects Node's Buffer in the browser.
    const {Buffer}=await import('buffer');(globalThis as {Buffer?:unknown}).Buffer??=Buffer;
    const [{FastAuthClient},{JavascriptProvider},{connect}]=await Promise.all([import('@fast-auth-near/browser-sdk'),import('@fast-auth-near/javascript-provider'),import('near-api-js-v5')]);
    const provider=new JavascriptProvider({network:'testnet',clientId:cfg.clientId||SHARED_TESTNET_CLIENT_ID});
    const {connection}=await connect({networkId:'testnet',nodeUrl:'https://rpc.testnet.near.org'});
    return{provider,client:new FastAuthClient(provider as any,connection as any,{fastAuthContractId:cfg.contractId,mpcContractId:cfg.mpcContractId})};
  })().catch(error=>{clientPromise=null;throw error;});
  return clientPromise;
}

/** Step 1. Leaves the page for the NEAR Auth login. */
export async function startNearAuth(cfg:FastAuthConfig){
  const {client}=await load(cfg);
  store.set(STAGE,'login');store.set(RETURN,location.hash||'#/');
  await client.login({redirectUri:redirectUri()});
}

/** Call on every page load. Returns the signed-in account when the flow completes, otherwise null. */
export async function resumeNearAuth(cfg:FastAuthConfig):Promise<{accountId:string}|null>{
  const stage=store.get(STAGE);if(!stage)return null;
  try{
    const {client,provider}=await load(cfg);
    if(!await provider.isLoggedIn())throw new Error('NEAR Auth login was not completed.');
    const signer=await client.getSigner();
    if(stage==='login'){
      const challenge=await post<{message:string;recipient:string;nonce:string}>('/api/auth/challenge',{});
      store.set(CHALLENGE,challenge.nonce);store.set(STAGE,'sign');
      await signer.requestMessageSignature({message:challenge.message,recipient:challenge.recipient,nonce:fromBase64(challenge.nonce),redirectUri:redirectUri()});
      return null;
    }
    const nonce=store.get(CHALLENGE);if(!nonce)throw new Error('Sign-in challenge was lost; please try again.');
    const {signatureRequest}=await signer.getSignatureRequest();
    const action=await signer.createSignAction(signatureRequest,{gas:300000000000000n,deposit:1n});
    const call=action.functionCall;
    if(!call||call.methodName!=='sign')throw new Error('NEAR Auth returned an unexpected action');
    const relayed=await post<{successValue:string|null}>('/api/relay/fastauth-sign',{methodName:call.methodName,argsBase64:toBase64(new Uint8Array(call.args)),gas:String(call.gas),deposit:String(call.deposit)});
    if(!relayed.successValue)throw new Error('NEAR Auth did not sign the message');
    const {FastAuthSignature}=await import('@fast-auth-near/browser-sdk');
    const signature:Uint8Array=FastAuthSignature.fromBase64(relayed.successValue).recover('ed25519');
    const publicKey=await signer.getPublicKey('ed25519');
    const keyBytes:Uint8Array=publicKey.data instanceof Uint8Array?publicKey.data:new Uint8Array(publicKey.data);
    const session=await post<{accountId:string}>('/api/auth/verify',{accountId:toHex(keyBytes),publicKey:publicKey.toString(),signature:toBase64(new Uint8Array(signature)),nonce});
    const back=store.get(RETURN);store.del(STAGE);store.del(CHALLENGE);store.del(RETURN);
    history.replaceState(null,'',`${location.pathname}${back||'#/'}`);
    return session;
  }catch(error){store.del(STAGE);store.del(CHALLENGE);throw error;}
}
export async function signOutNearAuth(){if(!clientPromise)return;try{await (await clientPromise).client.logout();}catch{/* not logged in */}}
