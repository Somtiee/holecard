import { createPublicClient, decodeEventLog, encodeFunctionData, erc20Abi, http, isAddress, parseAbi, type Address, type Hex } from 'viem';
import { arcTestnet } from 'viem/chains';
import { circleClient } from './wallet';
import {ARC_IDENTITY_REGISTRY,ARC_MULTICALL_FROM} from '../shared/arc';

export const identityAbi=parseAbi(['function register(string agentURI) returns (uint256)','function ownerOf(uint256 tokenId) view returns (address)','function tokenURI(uint256 tokenId) view returns (string)','event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)']);
export const batchFromAbi=parseAbi(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) returns ((bool success,bytes returnData)[])']);

export const factoryV2Abi=parseAbi([
  'function createTournament(bytes32 id, bytes32 rulesHash, bytes32 rosterRoot, bytes32 seedCommitment, uint256 entryFee, uint256 capacity, uint256 closesAt, uint256 duration, uint256 grace, uint16[] shares) returns (address)',
  'function tournamentById(bytes32 id) view returns (address)',
  'function usdc() view returns (address)',
  'function operator() view returns (address)',
  'event TournamentCreated(bytes32 indexed tournamentId, address indexed tournament, bytes32 rulesHash, bytes32 rosterRoot, bytes32 seedCommitment, uint256 entryFee, uint256 capacity)',
]);
export const tournamentV2Abi=parseAbi([
  'function enter(bytes32 agentId, bytes32 configHash, bytes32[] proof)',
  'function start()',
  'function finalize(bytes32 result, bytes32 replay, bytes32 seedReveal, address[] ranking)',
  'function claim()',
  'function refund()',
  'function cancelIfUnfilled()',
  'function cancelExpired()',
  'function state() view returns (uint8)',
  'function startedAt() view returns (uint256)',
  'function prizePool() view returns (uint256)',
  'function claimable(address wallet) view returns (uint256)',
  'event AgentRegistered(bytes32 indexed tournamentId, bytes32 indexed agentId, address indexed wallet, bytes32 configHash, uint256 fee)',
  'event TournamentStarted(bytes32 indexed tournamentId, uint256 startedAt, uint256 endsAt)',
  'event TournamentFinalized(bytes32 indexed tournamentId, bytes32 resultRoot, bytes32 replayHash, bytes32 seedReveal)',
  'event PrizePaid(bytes32 indexed tournamentId, address indexed wallet, uint256 amount)',
  'event EntryRefunded(bytes32 indexed tournamentId, address indexed wallet, uint256 amount)',
  'event TournamentCancelled(bytes32 indexed tournamentId)',
]);

export type ArcV2Call =
  | {kind:'identity';registry:Address;metadataUri:string}
  | {kind:'atomic-entry';usdc:Address;tournament:Address;amountMicroUsdc:bigint;agentId:Hex;configHash:Hex;proof:Hex[]}
  | {kind:'approve';usdc:Address;tournament:Address;amountMicroUsdc:bigint}
  | {kind:'withdraw';usdc:Address;recipient:Address;amountMicroUsdc:bigint}
  | {kind:'create';factory:Address;id:Hex;rulesHash:Hex;rosterRoot:Hex;seedCommitment:Hex;entryFeeMicroUsdc:bigint;capacity:number;closesAt:bigint;duration:bigint;grace:bigint;shares:number[]}
  | {kind:'enter';tournament:Address;agentId:Hex;configHash:Hex;proof:Hex[]}
  | {kind:'start';tournament:Address}
  | {kind:'finalize';tournament:Address;resultRoot:Hex;replayHash:Hex;seedReveal:Hex;ranking:Address[]}
  | {kind:'claim'|'refund'|'cancelIfUnfilled'|'cancelExpired';tournament:Address};
export type ExpectedArcEvent = {kind:'identity';wallet:Address}|{kind:'atomic-entry';usdc:Address;tournament:Address;tournamentId:Hex;agentId:Hex;wallet:Address;configHash:Hex;amountMicroUsdc:bigint}|{kind:'approval';owner:Address;spender:Address;amountMicroUsdc:bigint}|{kind:'transfer';sender:Address;recipient:Address;amountMicroUsdc:bigint}|{kind:'created';tournamentId:Hex}|{kind:'registered';tournamentId:Hex;agentId:Hex;wallet:Address;configHash?:Hex;amountMicroUsdc?:bigint}|{kind:'started'|'finalized'|'cancelled';tournamentId:Hex}|{kind:'paid'|'refunded';tournamentId:Hex;wallet:Address;amountMicroUsdc:bigint};

function address(value:string):Address {if(!isAddress(value))throw new Error('Invalid Arc address');return value as Address;}
function bytes32(value:string):Hex {if(!/^0x[\da-f]{64}$/i.test(value))throw new Error('Invalid bytes32 value');return value as Hex;}
const idempotency=(value:string)=>{if(!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value))throw new Error('Persisted UUIDv4 idempotency key required');};
export function buildArcV2Call(call:ArcV2Call):{contractAddress:Address;callData:Hex}{
  if(call.kind==='identity'){
    if(call.registry.toLowerCase()!==ARC_IDENTITY_REGISTRY.toLowerCase()||!/^https:\/\//.test(call.metadataUri))throw new Error('Official Arc identity registry and HTTPS metadata required');
    return{contractAddress:address(call.registry),callData:encodeFunctionData({abi:identityAbi,functionName:'register',args:[call.metadataUri]})};
  }
  if(call.kind==='atomic-entry'){
    const approve=buildArcV2Call({kind:'approve',usdc:call.usdc,tournament:call.tournament,amountMicroUsdc:call.amountMicroUsdc});
    const enter=buildArcV2Call({kind:'enter',tournament:call.tournament,agentId:call.agentId,configHash:call.configHash,proof:call.proof});
    return{contractAddress:ARC_MULTICALL_FROM,callData:encodeFunctionData({abi:batchFromAbi,functionName:'aggregate3',args:[[approve,enter].map(c=>({target:c.contractAddress,allowFailure:false,callData:c.callData}))]})};
  }
  if(call.kind==='approve'){
    if(call.amountMicroUsdc<=0n)throw new Error('Approval amount must be positive');
    return{contractAddress:address(call.usdc),callData:encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[address(call.tournament),call.amountMicroUsdc]})};
  }
  if(call.kind==='withdraw'){
    if(call.amountMicroUsdc<=0n)throw new Error('Withdrawal amount must be positive');
    return{contractAddress:address(call.usdc),callData:encodeFunctionData({abi:erc20Abi,functionName:'transfer',args:[address(call.recipient),call.amountMicroUsdc]})};
  }
  if(call.kind==='create'){
    [call.id,call.rulesHash,call.rosterRoot,call.seedCommitment].forEach(bytes32);
    if(call.entryFeeMicroUsdc<=0n||call.capacity<2||call.capacity>9||!Number.isSafeInteger(call.capacity)||call.shares.reduce((a,b)=>a+b,0)!==10000)throw new Error('Invalid tournament economics');
    return{contractAddress:address(call.factory),callData:encodeFunctionData({abi:factoryV2Abi,functionName:'createTournament',args:[call.id,call.rulesHash,call.rosterRoot,call.seedCommitment,call.entryFeeMicroUsdc,BigInt(call.capacity),call.closesAt,call.duration,call.grace,call.shares]})};
  }
  if(call.kind==='enter'){
    bytes32(call.agentId);bytes32(call.configHash);call.proof.forEach(bytes32);
    return{contractAddress:address(call.tournament),callData:encodeFunctionData({abi:tournamentV2Abi,functionName:'enter',args:[call.agentId,call.configHash,call.proof]})};
  }
  if(call.kind==='start')return{contractAddress:address(call.tournament),callData:encodeFunctionData({abi:tournamentV2Abi,functionName:'start'})};
  if(call.kind==='finalize'){
    bytes32(call.resultRoot);bytes32(call.replayHash);bytes32(call.seedReveal);
    if(!call.ranking.length||new Set(call.ranking.map(x=>address(x).toLowerCase())).size!==call.ranking.length)throw new Error('Invalid payout ranking');
    return{contractAddress:address(call.tournament),callData:encodeFunctionData({abi:tournamentV2Abi,functionName:'finalize',args:[call.resultRoot,call.replayHash,call.seedReveal,call.ranking]})};
  }
  return{contractAddress:address(call.tournament),callData:encodeFunctionData({abi:tournamentV2Abi,functionName:call.kind})};
}

function arcClient(){const rpc=process.env.ARC_RPC_URL||'https://rpc.testnet.arc.network';return createPublicClient({chain:arcTestnet,transport:http(rpc,{timeout:10000,retryCount:1})});}
export async function requireArcV2Deployment(factory:Address,usdc:Address,operator:Address){
  const client=arcClient();
  if(await client.getChainId()!==5042002)throw new Error('Wrong Arc chain');
  const code=await client.getCode({address:address(factory)});
  if(!code||code==='0x')throw new Error('ArenaFactoryV2 is not deployed');
  const [boundUsdc,boundOperator]=await Promise.all([
    client.readContract({address:factory,abi:factoryV2Abi,functionName:'usdc'}),
    client.readContract({address:factory,abi:factoryV2Abi,functionName:'operator'}),
  ]);
  if(boundUsdc.toLowerCase()!==usdc.toLowerCase()||boundOperator.toLowerCase()!==operator.toLowerCase())throw new Error('Factory binding does not match configured USDC/operator');
  return true;
}

/** Caller must persist this UUID and exact call before submission and reconcile the returned ID on restart. */
export async function submitCircleArcCall(input:{walletId:string;idempotencyKey:string;reference:string;call:ArcV2Call}){
  idempotency(input.idempotencyKey);
  if(!input.walletId)throw new Error('A Circle Arc wallet ID is required');
  const client=circleClient();if(!client)throw new Error('Circle wallet credentials are not configured');
  if(await arcClient().getChainId()!==5042002)throw new Error('Wrong Arc chain');
  const built=buildArcV2Call(input.call);
  const response=await client.createContractExecutionTransaction({walletId:input.walletId,contractAddress:built.contractAddress,callData:built.callData,
    idempotencyKey:input.idempotencyKey,refId:input.reference,fee:{type:'level',config:{feeLevel:'MEDIUM'}}});
  if(!response.data?.id)throw new Error('Circle did not return a transaction ID');
  return {circleTransactionId:response.data.id,state:response.data.state};
}

/** Circle completion and a successful Arc receipt are both required before recording a payout. */
export function hasExpectedArcEvent(logs:readonly {address:Address;data:Hex;topics:readonly Hex[]}[],expectedContract:Address,expected:ExpectedArcEvent):boolean{
  if(expected.kind==='atomic-entry')return expectedContract.toLowerCase()===ARC_MULTICALL_FROM.toLowerCase()
    &&hasExpectedArcEvent(logs,expected.usdc,{kind:'approval',owner:expected.wallet,spender:expected.tournament,amountMicroUsdc:expected.amountMicroUsdc})
    &&hasExpectedArcEvent(logs,expected.tournament,{kind:'registered',tournamentId:expected.tournamentId,agentId:expected.agentId,wallet:expected.wallet,configHash:expected.configHash,amountMicroUsdc:expected.amountMicroUsdc});
  if(expected.kind==='identity')return expectedContract.toLowerCase()===ARC_IDENTITY_REGISTRY.toLowerCase()&&extractIdentityToken(logs,expected.wallet)!==null;
  const eventName={approval:'Approval',transfer:'Transfer',created:'TournamentCreated',registered:'AgentRegistered',started:'TournamentStarted',finalized:'TournamentFinalized',cancelled:'TournamentCancelled',paid:'PrizePaid',refunded:'EntryRefunded'}[expected.kind];
  for(const log of logs){
    if(log.address.toLowerCase()!==expectedContract.toLowerCase())continue;
    try{
      if(!log.topics.length)continue;
      const abi=expected.kind==='approval'||expected.kind==='transfer'?erc20Abi:expected.kind==='created'?factoryV2Abi:tournamentV2Abi;
      const decoded=decodeEventLog({abi,data:log.data,topics:[...log.topics] as [Hex,...Hex[]],strict:true});
      if(decoded.eventName!==eventName)continue;
      const args=decoded.args as Record<string,unknown>;
      if(expected.kind==='approval'){
        if(String(args.owner).toLowerCase()===expected.owner.toLowerCase()&&String(args.spender).toLowerCase()===expected.spender.toLowerCase()&&args.value===expected.amountMicroUsdc)return true;
        continue;
      }
      if(expected.kind==='transfer'){
        if(String(args.from).toLowerCase()===expected.sender.toLowerCase()&&String(args.to).toLowerCase()===expected.recipient.toLowerCase()&&args.value===expected.amountMicroUsdc)return true;
        continue;
      }
      if(String(args.tournamentId).toLowerCase()!==expected.tournamentId.toLowerCase())continue;
      if(expected.kind==='registered'&&(String(args.agentId).toLowerCase()!==expected.agentId.toLowerCase()||String(args.wallet).toLowerCase()!==expected.wallet.toLowerCase()))continue;
      if(expected.kind==='registered'&&((expected.configHash&&args.configHash!==expected.configHash)||(expected.amountMicroUsdc!==undefined&&args.fee!==expected.amountMicroUsdc)))continue;
      if((expected.kind==='paid'||expected.kind==='refunded')&&(String(args.wallet).toLowerCase()!==expected.wallet.toLowerCase()||args.amount!==expected.amountMicroUsdc))continue;
      return true;
    }catch{continue;}
  }
  return false;
}

export function extractIdentityToken(logs:readonly {address:Address;data:Hex;topics:readonly Hex[]}[],wallet:Address):bigint|null{
  for(const log of logs){
    if(log.address.toLowerCase()!==ARC_IDENTITY_REGISTRY.toLowerCase()||!log.topics.length)continue;
    try{const decoded=decodeEventLog({abi:identityAbi,eventName:'Transfer',data:log.data,topics:[...log.topics] as [Hex,...Hex[]],strict:true});
      if(decoded.args.from==='0x0000000000000000000000000000000000000000'&&decoded.args.to.toLowerCase()===wallet.toLowerCase())return decoded.args.tokenId;
    }catch{/* unrelated registry log */}
  }
  return null;
}

export async function confirmCircleArcCall(circleTransactionId:string,expectedContract:Address,expectedEvent:ExpectedArcEvent){
  const circle=circleClient();if(!circle)throw new Error('Circle wallet credentials are not configured');
  const transaction=(await circle.getTransaction({id:circleTransactionId})).data?.transaction;
  if(!transaction)return{state:'PENDING' as const,txHash:null};
  const terminalFailure=['FAILED','CANCELLED','DENIED'].includes(transaction.state);
  if(terminalFailure&&!transaction.txHash)return{state:'FAILED' as const,txHash:null};
  if(!terminalFailure&&(transaction.state!=='COMPLETE'||!transaction.txHash))return{state:'PENDING' as const,txHash:transaction.txHash||null};
  if(transaction.blockchain!=='ARC-TESTNET')throw new Error('Circle transaction targeted a different chain');
  const client=arcClient();if(await client.getChainId()!==5042002)throw new Error('Wrong Arc chain');
  const receipt=await client.getTransactionReceipt({hash:transaction.txHash as Hex});
  if(receipt.status!=='success')return{state:'FAILED' as const,txHash:transaction.txHash as Hex};
  if(receipt.to?.toLowerCase()!==expectedContract.toLowerCase())throw new Error('Arc receipt targeted a different contract; manual review required');
  if(!hasExpectedArcEvent(receipt.logs,expectedContract,expectedEvent))throw new Error('Arc receipt is missing the expected contract event');
  return{state:'CONFIRMED' as const,txHash:transaction.txHash as Hex,receipt};
}
