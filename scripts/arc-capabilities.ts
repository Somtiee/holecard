import '../src/server/env';
import {writeFile} from 'node:fs/promises';
import {encodeFunctionData,erc20Abi} from 'viem';
import {arcClient,arcStatus} from '../src/server/arc';
import {batchFromAbi,identityAbi} from '../src/server/circleArc';
import {ARC_USDC,ARC_MULTICALL_FROM,ARC_IDENTITY_REGISTRY,ARC_EXPLORER} from '../src/shared/arc';
// eth_call only. No private key, signer, broadcasts or persistent approvals.
const account='0x000000000000000000000000000000000000aa01';
const spender='0x000000000000000000000000000000000000aa02';
const report:Record<string,unknown>={checkedAt:new Date().toISOString(),transactionsSubmitted:0,network:await arcStatus()};
try{
  const calls=[{target:ARC_USDC,allowFailure:false,callData:encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[spender,1234567n]})},{target:ARC_USDC,allowFailure:false,callData:encodeFunctionData({abi:erc20Abi,functionName:'allowance',args:[account,spender]})}];
  const result=await arcClient.simulateContract({account,address:ARC_MULTICALL_FROM,abi:batchFromAbi,functionName:'aggregate3',args:[calls]});
  report.senderPreservingBatch={simulationOnly:true,allCallsSucceeded:result.result.every(r=>r.success),allowanceVisibleWithinBatch:BigInt(result.result[1].returnData).toString(),passed:BigInt(result.result[1].returnData)===1234567n};
}catch(error){report.senderPreservingBatch={passed:false,error:(error as Error).message.slice(0,220)};}
try{const r=await arcClient.simulateContract({account,address:ARC_IDENTITY_REGISTRY,abi:identityAbi,functionName:'register',args:['https://agent-arena-production-7923.up.railway.app/api/agents/preflight/identity.json']});report.identityRegistration={simulationOnly:true,passed:true,predictedTokenId:r.result.toString()};}catch(error){report.identityRegistration={passed:false,error:(error as Error).message.slice(0,220)};}
report.explorer=await Promise.all([ARC_USDC,ARC_MULTICALL_FROM,ARC_IDENTITY_REGISTRY].map(async address=>{const url=`${ARC_EXPLORER}/address/${address}`;try{const r=await fetch(url,{signal:AbortSignal.timeout(12000)});await r.body?.cancel();return{url,status:r.status,finalUrl:r.url};}catch{return{url,status:null};}}));
const data=JSON.stringify(report,null,2)+'\n';if(process.argv.includes('--save'))await writeFile('docs/audit/arc-capabilities.json',data);console.log(data);
