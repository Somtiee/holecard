import type {BridgeResult} from '@circle-fin/app-kit';
import {validateFundingPlan,type FundingPlan} from './plan';
export type MintRecovery={attestation:string;signature:string};
export type FundingRecovery={version:1;plan:FundingPlan;hash?:string;bridge?:BridgeResult;mint?:MintRecovery;steps?:{name:string;state:string;txHash?:string;explorerUrl?:string}[]};
export function mintRecovery(error:unknown):MintRecovery|null{
  const trace=(error as {cause?:{trace?:Partial<MintRecovery>}}|null)?.cause?.trace;
  return typeof trace?.attestation==='string'&&typeof trace.signature==='string'&&/^0x[\da-f]+$/i.test(trace.attestation)&&/^0x[\da-f]+$/i.test(trace.signature)?{attestation:trace.attestation,signature:trace.signature}:null;
}
export function serializeRecovery(record:FundingRecovery){return JSON.stringify(record,(_,v)=>typeof v==='bigint'?{arenaBigInt:v.toString()}:v);}
export function parseRecovery(raw:string,owner:string,recipient:string):FundingRecovery{
  const record=JSON.parse(raw,(_,v)=>v&&typeof v==='object'&&Object.keys(v).length===1&&typeof v.arenaBigInt==='string'?BigInt(v.arenaBigInt):v) as FundingRecovery;
  if(record.version!==1||!record.plan)throw new Error('Unrecognized funding recovery record. Inspect wallet activity.');
  validateFundingPlan(record.plan);
  if(record.plan.owner.toLowerCase()!==owner.toLowerCase()||record.plan.recipient.toLowerCase()!==recipient.toLowerCase())throw new Error('Funding record belongs to a different wallet.');
  if(record.bridge&&(record.plan.mode!=='bridge'||record.bridge.amount!==record.plan.amount||record.bridge.source.address.toLowerCase()!==owner.toLowerCase()||record.bridge.source.chain.chain!==record.plan.source||record.bridge.destination.chain.chain!=='Arc_Testnet'||record.bridge.destination.recipientAddress?.toLowerCase()!==recipient.toLowerCase()))throw new Error('Bridge recovery route does not match the funding request.');
  if(record.mint&&(record.plan.mode!=='spend'||!mintRecovery({cause:{trace:record.mint}})))throw new Error('Invalid Gateway recovery data.');
  return record;
}
