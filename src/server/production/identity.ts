import {type Address,type Hex} from 'viem';
import {arcClient} from '../arc';
import {extractIdentityToken,identityAbi} from '../circleArc';
import {ARC_CHAIN_ID,ARC_IDENTITY_REGISTRY,ARC_EXPLORER} from '../../shared/arc';
import {pool} from './db';
import {advanceOperation,prepareOperation} from './operations';
import {configHash} from './commitments';
import type {AgentRow} from './types';

function metadataUri(id:string){
  const origin=process.env.PUBLIC_ORIGIN;
  if(!origin?.startsWith('https://'))throw new Error('HTTPS public origin is required for onchain agent metadata');
  return`${origin}/api/agents/${id}/identity.json`;
}
export async function agentIdentityMetadata(id:string){
  const a=(await pool.query<AgentRow>('SELECT * FROM arena_agents WHERE id=$1',[id])).rows[0];
  if(!a)return null;
  return{type:'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',name:a.name,description:a.description||`${a.strategy} poker research agent`,active:true,
    services:[{name:'web',endpoint:`${process.env.PUBLIC_ORIGIN}/#/agents/${id}`}],supportedTrust:[],
    registrations:a.identity_token_id?[{agentId:a.identity_token_id,agentRegistry:`eip155:${ARC_CHAIN_ID}:${ARC_IDENTITY_REGISTRY}`}]:[],
    arena:{agentId:a.id,creator:a.owner,wallet:a.wallet_address,network:'Arc Testnet',strategy:a.strategy,model:a.model,configurationHash:a.wallet_address?configHash({...a,walletAddress:a.wallet_address}):null,
      results:`${process.env.PUBLIC_ORIGIN}/api/agents/${id}/analytics`,trust:'The arena operates poker and asserts results. Replay and Arc settlement provide public evidence.'}};
}
export async function registerAgentIdentity(id:string,owner:string){
  const a=(await pool.query<AgentRow>('SELECT * FROM arena_agents WHERE id=$1',[id])).rows[0];
  if(!a||a.owner!==owner||!a.wallet_id||!a.wallet_address)throw new Error('Agent wallet not found for this owner');
  if(a.identity_token_id)return{state:'confirmed',tokenId:a.identity_token_id,txHash:a.identity_tx_hash};
  if(await arcClient.getChainId()!==ARC_CHAIN_ID)throw new Error('Wrong Arc chain');
  if(!((await arcClient.getCode({address:ARC_IDENTITY_REGISTRY}))?.replace(/^0x/,'')))throw new Error('Arc identity registry is unavailable');
  const key=`identity:${id}`;
  await prepareOperation({key,kind:'identity',agentId:id,walletId:a.wallet_id,expectedContract:ARC_IDENTITY_REGISTRY,
    call:{kind:'identity',registry:ARC_IDENTITY_REGISTRY,metadataUri:metadataUri(id)},expected:{kind:'identity',wallet:a.wallet_address as Address}});
  return advanceOperation(key);
}
export async function syncAgentIdentities(){
  const rows=await pool.query<{id:string;wallet_address:string;tx_hash:string}>(`SELECT a.id,a.wallet_address,o.tx_hash FROM arena_agents a JOIN arc_operations o ON o.agent_id=a.id
    WHERE o.kind='identity' AND o.state='confirmed' AND a.identity_token_id IS NULL`);
  for(const a of rows.rows){
    const receipt=await arcClient.getTransactionReceipt({hash:a.tx_hash as Hex});
    const tokenId=extractIdentityToken(receipt.logs,a.wallet_address as Address);
    if(tokenId===null||receipt.status!=='success')continue;
    const [owner,uri]=await Promise.all([arcClient.readContract({address:ARC_IDENTITY_REGISTRY,abi:identityAbi,functionName:'ownerOf',args:[tokenId]}),arcClient.readContract({address:ARC_IDENTITY_REGISTRY,abi:identityAbi,functionName:'tokenURI',args:[tokenId]})]);
    if(owner.toLowerCase()!==a.wallet_address||uri!==metadataUri(a.id))throw new Error('Registered agent identity does not match its wallet or metadata');
    await pool.query('UPDATE arena_agents SET identity_token_id=$2,identity_tx_hash=$3,identity_registry=$4 WHERE id=$1 AND identity_token_id IS NULL',[a.id,tokenId.toString(),a.tx_hash,ARC_IDENTITY_REGISTRY]);
  }
}
export async function identityStatus(id:string){
  const a=(await pool.query<AgentRow>('SELECT * FROM arena_agents WHERE id=$1',[id])).rows[0];if(!a)return null;
  const operation=(await pool.query(`SELECT state,tx_hash FROM arc_operations WHERE agent_id=$1 AND kind='identity' ORDER BY created_at DESC LIMIT 1`,[id])).rows[0];
  return{registry:ARC_IDENTITY_REGISTRY,tokenId:a.identity_token_id||null,state:a.identity_token_id?'registered':operation?.state||'unregistered',txHash:a.identity_tx_hash||operation?.tx_hash||null,
    metadataUrl:`/api/agents/${id}/identity.json`,registryUrl:`${ARC_EXPLORER}/address/${ARC_IDENTITY_REGISTRY}`};
}
