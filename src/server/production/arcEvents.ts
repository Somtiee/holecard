import {decodeEventLog,erc20Abi,formatUnits,parseAbiItem,type Address,type Hex,type TransactionReceipt} from 'viem';
import type {PoolClient} from 'pg';
import {arcClient} from '../arc';
import {ARC_CHAIN_ID,ARC_SYSTEM_USDC,ARC_USDC,arcTransactionUrl} from '../../shared/arc';
import {pool,withTx} from './db';

export type NativeTransfer={sender:string;recipient:string;amountNative:bigint;logIndex:number};
/** Consume only Arc's 18-decimal system stream; ERC-20 mirror logs must not be counted again. */
export function nativeTransfers(logs:readonly {address:string;data:Hex;topics:readonly Hex[];logIndex:number|null}[]):NativeTransfer[]{
  const rows:NativeTransfer[]=[];
  for(const log of logs){
    if(log.address.toLowerCase()!==ARC_SYSTEM_USDC||log.logIndex===null||!log.topics.length)continue;
    try{
      const event=decodeEventLog({abi:erc20Abi,eventName:'Transfer',data:log.data,topics:[...log.topics] as [Hex,...Hex[]],strict:true});
      if(event.args.value<=0n)continue;
      rows.push({sender:event.args.from.toLowerCase(),recipient:event.args.to.toLowerCase(),amountNative:event.args.value,logIndex:log.logIndex});
    }catch{/* unrelated system log */}
  }
  return rows;
}
async function persistReceipt(receipt:TransactionReceipt,addresses:Set<string>,client:PoolClient){
  if(receipt.status!=='success')throw new Error('Arc transfer receipt reverted');
  const transfers=nativeTransfers(receipt.logs).filter(t=>addresses.has(t.sender)||addresses.has(t.recipient));
  for(const t of transfers)await client.query(`INSERT INTO arc_transfers(tx_hash,log_index,block_number,sender,recipient,amount_native,gas_native,gas_payer)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tx_hash,log_index) DO NOTHING`,
    [receipt.transactionHash,t.logIndex,receipt.blockNumber.toString(),t.sender,t.recipient,t.amountNative.toString(),(receipt.gasUsed*receipt.effectiveGasPrice).toString(),receipt.from.toLowerCase()]);
  return transfers;
}
export async function verifyAgentFunding(agentId:string,owner:string,hash:unknown){
  if(typeof hash!=='string'||!/^0x[\da-f]{64}$/i.test(hash))throw new Error('Valid Arc transaction hash required');
  const agent=(await pool.query<{owner:string;wallet_address:string}>('SELECT owner,wallet_address FROM arena_agents WHERE id=$1',[agentId])).rows[0];
  if(!agent||agent.owner!==owner||!agent.wallet_address)throw new Error('Agent wallet not found for this owner');
  if(await arcClient.getChainId()!==ARC_CHAIN_ID)throw new Error('Wrong Arc chain');
  const receipt=await arcClient.getTransactionReceipt({hash:hash as Hex});
  const received=nativeTransfers(receipt.logs).filter(t=>t.recipient===agent.wallet_address&&t.sender!==t.recipient);
  if(receipt.status!=='success'||!received.length)throw new Error('Receipt does not contain USDC received by this agent on Arc');
  await withTx(client=>persistReceipt(receipt,new Set([agent.wallet_address]),client));
  return{verified:true,txHash:receipt.transactionHash,receivedUsdc:formatUnits(received.reduce((s,t)=>s+t.amountNative,0n),18),blockNumber:receipt.blockNumber.toString(),explorerUrl:arcTransactionUrl(receipt.transactionHash)};
}
export async function indexArcTransfers(){
  if(await arcClient.getChainId()!==ARC_CHAIN_ID)throw new Error('Wrong Arc chain');
  await withTx(async client=>{
    const locked=await client.query<{locked:boolean}>('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked',['arc-system-events']);
    if(!locked.rows[0].locked)return;
    const tip=await arcClient.getBlockNumber();
    await client.query(`INSERT INTO arc_indexer(name,next_block) VALUES('usdc-system',$1) ON CONFLICT(name) DO NOTHING`,[tip.toString()]);
    const cursor=(await client.query<{next_block:string}>(`SELECT next_block FROM arc_indexer WHERE name='usdc-system' FOR UPDATE`)).rows[0];
    const from=BigInt(cursor.next_block);if(from>tip)return;
    const to=from+1999n<tip?from+1999n:tip;
    const wallets=(await client.query<{wallet_address:string}>('SELECT wallet_address FROM arena_agents WHERE wallet_address IS NOT NULL')).rows.map(r=>r.wallet_address as Address);
    const addresses=new Set(wallets.map(w=>w.toLowerCase()));
    const hashes=new Set<Hex>();
    // Bounded groups keep topic filters within RPC limits as the arena grows.
    for(let i=0;i<wallets.length;i+=50){
      const group=wallets.slice(i,i+50),event=parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 value)');
      const logs=await Promise.all([arcClient.getLogs({address:ARC_SYSTEM_USDC,event,args:{to:group},fromBlock:from,toBlock:to}),arcClient.getLogs({address:ARC_SYSTEM_USDC,event,args:{from:group},fromBlock:from,toBlock:to})]);
      for(const log of logs.flat())if(log.transactionHash)hashes.add(log.transactionHash);
    }
    for(const hash of hashes)await persistReceipt(await arcClient.getTransactionReceipt({hash}),addresses,client);
    await client.query(`UPDATE arc_indexer SET next_block=$1,updated_at=now() WHERE name='usdc-system'`,[(to+1n).toString()]);
  });
}
function publicTransfer(row:Record<string,string>){return{txHash:row.tx_hash,logIndex:Number(row.log_index),blockNumber:row.block_number,sender:row.sender,recipient:row.recipient,amountUsdc:formatUnits(BigInt(row.amount_native),18),gasUsdc:formatUnits(BigInt(row.gas_native),18),gasPayer:row.gas_payer,explorerUrl:arcTransactionUrl(row.tx_hash)};}
export async function agentTransfers(agentId:string){
  const rows=await pool.query(`SELECT t.* FROM arc_transfers t JOIN arena_agents a ON a.id=$1 WHERE t.sender=a.wallet_address OR t.recipient=a.wallet_address ORDER BY t.block_number DESC,t.log_index DESC LIMIT 50`,[agentId]);
  return rows.rows.map(publicTransfer);
}
export async function arcWalletBalance(wallet:Address){
  if(await arcClient.getChainId()!==ARC_CHAIN_ID)throw new Error('Wrong Arc chain');
  const [native,token]=await Promise.all([arcClient.getBalance({address:wallet}),arcClient.readContract({address:ARC_USDC,abi:erc20Abi,functionName:'balanceOf',args:[wallet]})]);
  return{balance:formatUnits(token,6),nativePrecisionBalance:formatUnits(native,18),currency:'USDC',network:'Arc Testnet',walletAddress:wallet,
    accounting:'Native gas and ERC-20 USDC are two views of one balance; they must not be added together.'};
}
export async function arcActivity(){
  const [transfers,operations,cursor]=await Promise.all([
    pool.query('SELECT * FROM arc_transfers ORDER BY block_number DESC,log_index DESC LIMIT 30'),
    pool.query(`SELECT kind,tx_hash,gas_native,block_number,agent_id,tournament_id,updated_at FROM arc_operations WHERE state='confirmed' ORDER BY updated_at DESC LIMIT 30`),
    pool.query(`SELECT next_block,updated_at FROM arc_indexer WHERE name='usdc-system'`),
  ]);
  return{transfers:transfers.rows.map(publicTransfer),operations:operations.rows.map(r=>({...r,gasUsdc:r.gas_native?formatUnits(BigInt(r.gas_native),18):null,explorerUrl:arcTransactionUrl(r.tx_hash)})),indexer:cursor.rows[0]||null};
}
