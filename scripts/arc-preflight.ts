import '../src/server/env';
import { createPublicClient, erc20Abi, http, isAddress, parseAbi, type Address } from 'viem';
import { arcTestnet } from 'viem/chains';
import { writeFile } from 'node:fs/promises';

// Read-only: no wallet client, signer, private key, or transaction submission API.
const rpc=process.env.ARC_RPC_URL||arcTestnet.rpcUrls.default.http[0];
const usdc=(process.env.ARC_USDC_ADDRESS||'0x3600000000000000000000000000000000000000') as Address;
if(!isAddress(usdc))throw new Error('Invalid ARC_USDC_ADDRESS');
const factory=process.env.ARENA_FACTORY_ADDRESS;
const client=createPublicClient({chain:arcTestnet,transport:http(rpc,{timeout:8000,retryCount:0})});
const report:Record<string,unknown>={checkedAt:new Date().toISOString(),rpcOrigin:new URL(rpc).origin,expectedChainId:5042002,usdcAddress:usdc,transactionsSubmitted:0};
try {
  const chainId=await client.getChainId();report.chainId=chainId;
  if(chainId!==5042002)throw new Error('RPC is not Arc Testnet');
  if(process.env.ARC_CHAIN_ID&&process.env.ARC_CHAIN_ID!=='5042002')throw new Error('ARC_CHAIN_ID disagrees with the testnet deployment target');
  const [blockNumber,decimals,symbol,code]=await Promise.all([
    client.getBlockNumber(),client.readContract({address:usdc,abi:erc20Abi,functionName:'decimals'}),
    client.readContract({address:usdc,abi:erc20Abi,functionName:'symbol'}),client.getCode({address:usdc}),
  ]);
  report.blockNumber=blockNumber.toString();report.usdc={decimals,symbol,codeBytes:code?(code.length-2)/2:0,valid:decimals===6&&symbol==='USDC'};
  if(decimals!==6||symbol!=='USDC')throw new Error('Token metadata does not match expected Arc USDC');
  if(factory){
    if(!isAddress(factory))throw new Error('Invalid ARENA_FACTORY_ADDRESS');
    const bytecode=await client.getCode({address:factory});
    if(!bytecode||bytecode==='0x')throw new Error('No contract at ARENA_FACTORY_ADDRESS');
    const abi=parseAbi(['function operator() view returns (address)','function tournamentCount() view returns (uint256)','function usdc() view returns (address)']);
    const [operator,tournamentCount,contractUsdc]=await Promise.all([client.readContract({address:factory,abi,functionName:'operator'}),client.readContract({address:factory,abi,functionName:'tournamentCount'}),client.readContract({address:factory,abi,functionName:'usdc'})]);
    if(contractUsdc.toLowerCase()!==usdc.toLowerCase())throw new Error('Factory uses an unexpected USDC token');
    if(process.env.ARENA_OPERATOR_ADDRESS&&operator.toLowerCase()!==process.env.ARENA_OPERATOR_ADDRESS.toLowerCase())throw new Error('Factory operator differs from configured Circle operator wallet');
    report.factory={address:factory,codePresent:true,operator,tournamentCount:tournamentCount.toString(),usdc:contractUsdc,sourceVerified:false};
  }else report.factory={configured:false};
  report.rpcChecksPassed=true;
}catch{report.rpcChecksPassed=false;report.failure='RPC, network, token, or configured contract validation failed. No secrets or provider request details logged.';}
report.configuration={circleConfigured:Boolean(process.env.CIRCLE_API_KEY&&process.env.CIRCLE_ENTITY_SECRET&&process.env.CIRCLE_WALLET_SET_ID),
  operatorWalletConfigured:Boolean(process.env.ARENA_OPERATOR_WALLET_ID&&process.env.ARENA_OPERATOR_ADDRESS),
  postgresConfigured:Boolean(process.env.DATABASE_URL),modelConfigured:Boolean(process.env.MODEL_API_KEY&&process.env.MODEL_ALLOWED_MODELS),
  creatorAuthImplemented:true,operationJournalImplemented:true};
report.settlementReady=false;
report.remaining=[...(!factory?['Deploy and independently review ArenaFactoryV2']:[]),
  ...(!process.env.CIRCLE_API_KEY?['Configure Circle Developer-Controlled Wallets']:[]),
  ...(!process.env.ARENA_OPERATOR_WALLET_ID?['Configure and fund the Circle Arc operator wallet']:[]),
  ...(!process.env.DATABASE_URL?['Configure Postgres']:[]),
  ...(!process.env.MODEL_API_KEY?['Configure an approved model provider']:[]),
  'Run a live entry, finalization, prize claim, refund and explorer-link test on Arc Testnet'];
report.explorerHttp=await Promise.all(['https://testnet.arcscan.app','https://explorer.testnet.arc.io'].map(async base=>{
  try{const response=await fetch(`${base}/address/${usdc}`,{signal:AbortSignal.timeout(8000)});await response.body?.cancel();return{base,status:response.status,finalUrl:response.url};}
  catch{return{base,status:null};}
}));
const json=JSON.stringify(report,null,2)+'\n';
if(process.argv.includes('--save'))await writeFile('docs/audit/arc-preflight.json',json);
process.stdout.write(json);
if(!report.rpcChecksPassed)process.exitCode=1;
