import {randomUUID} from 'node:crypto';
import type {Address} from 'viem';
import type {PoolClient} from 'pg';
import {buildArcV2Call,confirmCircleArcCall,submitCircleArcCall,type ArcV2Call,type ExpectedArcEvent} from '../circleArc';
import {pool} from './db';

type OperationInput={key:string;kind:string;tournamentId?:string;agentId?:string;walletId:string;call:ArcV2Call;expected:ExpectedArcEvent;expectedContract:Address};
const json=(value:unknown)=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v);
function reviveCall(value:Record<string,unknown>):ArcV2Call{
  for(const key of ['amountMicroUsdc','entryFeeMicroUsdc','closesAt','duration','grace'])if(value[key]!==undefined)value[key]=BigInt(String(value[key]));
  return value as ArcV2Call;
}
function reviveExpected(value:Record<string,unknown>):ExpectedArcEvent{
  if(value.amountMicroUsdc!==undefined)value.amountMicroUsdc=BigInt(String(value.amountMicroUsdc));
  return value as ExpectedArcEvent;
}

/** The exact call and UUID are committed before a Circle API request. A retry reuses both. */
export async function prepareOperation(input:OperationInput,dbClient?:PoolClient){
  const built=buildArcV2Call(input.call);
  if(built.contractAddress.toLowerCase()!==input.expectedContract.toLowerCase())throw new Error('Expected contract does not match submitted call');
  const id=randomUUID();
  const result=await (dbClient||pool).query(`INSERT INTO arc_operations(id,operation_key,kind,tournament_id,agent_id,wallet_id,call,expected,contract_address)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9) ON CONFLICT(operation_key) DO UPDATE SET operation_key=excluded.operation_key RETURNING *`,
    [id,input.key,input.kind,input.tournamentId||null,input.agentId||null,input.walletId,json(input.call),json(input.expected),input.expectedContract.toLowerCase()]);
  const row=result.rows[0];
  if(row.wallet_id!==input.walletId||buildArcV2Call(reviveCall(row.call)).callData!==built.callData||row.contract_address!==input.expectedContract.toLowerCase())throw new Error('Existing operation key has different transaction parameters');
  return row;
}

export async function advanceOperation(key:string){
  const client=await pool.connect();
  try{
    const lock=await client.query<{locked:boolean}>('SELECT pg_try_advisory_lock(hashtext($1)) AS locked',[key]);
    if(!lock.rows[0]?.locked)return{state:'IN_PROGRESS'};
    try{
      const found=await client.query('SELECT * FROM arc_operations WHERE operation_key=$1',[key]);
      const op=found.rows[0];if(!op)throw new Error('Operation not found');
      if(op.state==='confirmed'||op.state==='failed')return{state:op.state,txHash:op.tx_hash,error:op.error};
      if(op.state==='prepared'){
        const submitted=await submitCircleArcCall({walletId:op.wallet_id,idempotencyKey:op.id,reference:op.operation_key,call:reviveCall(op.call)});
        await client.query(`UPDATE arc_operations SET state='submitted',circle_id=$2,updated_at=now() WHERE id=$1`,[op.id,submitted.circleTransactionId]);
        op.circle_id=submitted.circleTransactionId;
      }
      const result=await confirmCircleArcCall(op.circle_id,op.contract_address,reviveExpected(op.expected));
      if(result.state==='CONFIRMED'){
        await client.query(`UPDATE arc_operations SET state='confirmed',tx_hash=$2,gas_native=$3,block_number=$4,updated_at=now() WHERE id=$1`,[op.id,result.txHash,(result.receipt.gasUsed*result.receipt.effectiveGasPrice).toString(),result.receipt.blockNumber.toString()]);
        return{state:'confirmed',txHash:result.txHash};
      }
      if(result.state==='FAILED'){
        await client.query(`UPDATE arc_operations SET state='failed',tx_hash=$2,error='Circle transaction failed',updated_at=now() WHERE id=$1`,[op.id,result.txHash]);
        return{state:'failed',txHash:result.txHash};
      }
      await client.query('UPDATE arc_operations SET updated_at=now() WHERE id=$1',[op.id]);
      return{state:'submitted',txHash:result.txHash};
    }finally{await client.query('SELECT pg_advisory_unlock(hashtext($1))',[key]);}
  }finally{client.release();}
}

export async function reconcileOperations(){
  const found=await pool.query<{operation_key:string}>('SELECT operation_key FROM arc_operations WHERE state IN ($1,$2) ORDER BY updated_at LIMIT 20',['prepared','submitted']);
  for(const row of found.rows)try{await advanceOperation(row.operation_key);}catch(error){console.error('Arc operation reconciliation failed',row.operation_key,(error as Error).message);}
  const failed=await pool.query(`SELECT * FROM arc_operations WHERE state='failed' AND updated_at<now()-interval '1 minute' ORDER BY created_at DESC LIMIT 30`);
  const seen=new Set<string>();
  for(const row of failed.rows){
    const base=String(row.operation_key).replace(/:retry:\d+$/,'');
    if(seen.has(base))continue;seen.add(base);
    const attempts=await pool.query<{n:string;state:string}>('SELECT count(*)::text AS n,(array_agg(state ORDER BY created_at DESC))[1] AS state FROM arc_operations WHERE operation_key=$1 OR operation_key LIKE $2',[base,`${base}:retry:%`]);
    if(attempts.rows[0].state!=='failed'||Number(attempts.rows[0].n)>=3)continue;
    try{
      const next=Number(attempts.rows[0].n);
      const prepared=await prepareOperation({key:`${base}:retry:${next}`,kind:row.kind,tournamentId:row.tournament_id||undefined,agentId:row.agent_id||undefined,
        walletId:row.wallet_id,call:reviveCall(row.call),expected:reviveExpected(row.expected),expectedContract:row.contract_address});
      await advanceOperation(prepared.operation_key);
    }catch(error){console.error('Arc operation retry failed',base,(error as Error).message);}
  }
}

export async function latestOperation(kind:string,tournamentId:string,agentId?:string){
  const r=await pool.query<{state:string;tx_hash:string|null}>(`SELECT state,tx_hash FROM arc_operations WHERE kind=$1 AND tournament_id=$2 AND agent_id IS NOT DISTINCT FROM $3::uuid ORDER BY created_at DESC LIMIT 1`,[kind,tournamentId,agentId||null]);
  return r.rows[0]||null;
}
