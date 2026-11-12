import {NearConnector} from '@hot-labs/near-connect';

/** Browser-side NEAR wallet access via NEAR Connect. Only the owner's own wallet signs here:
 * NEP-413 sign-in, `deposit` (fund an agent's arena balance) and `withdraw` (always pays the owner). */
let connector:NearConnector|null=null;
let connectorNetwork:'testnet'|'mainnet'|null=null;
export function nearConnector(network:'testnet'|'mainnet'){
  if(!connector||connectorNetwork!==network){
    connector=new NearConnector({network,features:{signMessage:true,signAndSendTransaction:true,[network]:true}});connectorNetwork=network;
  }
  return connector;
}

async function api<T>(path:string,body:unknown):Promise<T>{
  const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify(body)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);return data as T;
}
const fromBase64=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));

export async function signInWithNear(network:'testnet'|'mainnet'){
  const challenge=await api<{message:string;recipient:string;nonce:string}>('/api/auth/challenge',{});
  const near=nearConnector(network);
  const wallet=await near.connect();
  const [account]=await wallet.getAccounts({network});
  if(!account)throw new Error('The wallet did not return a NEAR account.');
  const signed=await wallet.signMessage({message:challenge.message,recipient:challenge.recipient,nonce:fromBase64(challenge.nonce),network,signerId:account.accountId});
  return api<{accountId:string}>('/api/auth/verify',{accountId:signed.accountId||account.accountId,publicKey:signed.publicKey,signature:signed.signature,nonce:challenge.nonce});
}
export async function signOutNear(network:'testnet'|'mainnet'){try{await nearConnector(network).disconnect();}catch{/* no wallet connected */}}

const yocto=(near:string)=>{if(!/^\d+(\.\d{1,6})?$/.test(near))throw new Error('Enter a NEAR amount with at most six decimals');const [w,f='']=near.split('.');return(BigInt(w)*10n**24n+BigInt(f.padEnd(24,'0'))).toString();};
/** Gasless when the wallet supports NEP-366 delegate actions: the player signs, the arena relayer pays gas.
 * Otherwise a normal transaction from the player's wallet. Returns how it was sent. */
async function callArena(network:'testnet'|'mainnet',contractId:string,methodName:string,args:object,deposit='0'):Promise<'relayed'|'wallet'>{
  const wallet=await nearConnector(network).wallet();
  const action={type:'FunctionCall' as const,params:{methodName,args,gas:'50000000000000',deposit}};
  if((wallet as {manifest?:{features?:{signDelegateActions?:boolean}}}).manifest?.features?.signDelegateActions){
    try{
      const {signedDelegateActions}=await wallet.signDelegateActions({network,delegateActions:[{receiverId:contractId,actions:[action]}]});
      await api('/api/relay/delegate',{signedDelegate:signedDelegateActions[0]});
      return'relayed';
    }catch(error){console.warn('Gasless relay unavailable, falling back to a wallet transaction',error);}
  }
  await wallet.signAndSendTransaction({network,receiverId:contractId,actions:[action]});
  return'wallet';
}
/** Owner wallet → arena contract: credit `agent`'s arena balance. */
export const depositToAgent=(network:'testnet'|'mainnet',contractId:string,agent:string,near:string)=>callArena(network,contractId,'deposit',{agent},yocto(near));
/** Owner wallet → arena contract: pay `near` from the agent's arena balance back to the owner. */
export const withdrawFromAgent=(network:'testnet'|'mainnet',contractId:string,agent:string,near:string)=>callArena(network,contractId,'withdraw',{agent,amount:yocto(near)});
export const nearToYocto=yocto;
