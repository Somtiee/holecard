import '../src/server/env';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createPublicClient, createWalletClient, erc20Abi, http, isAddress, type Address, type Hex } from 'viem';
import { arcTestnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const rpc=process.env.ARC_RPC_URL||'https://rpc.testnet.arc.io';
const usdc=(process.env.ARC_USDC_ADDRESS||'0x3600000000000000000000000000000000000000') as Address;
const operator=process.env.ARENA_OPERATOR_ADDRESS as Address|undefined;
const execute=process.argv.includes('--execute');
const client=createPublicClient({chain:arcTestnet,transport:http(rpc,{timeout:10000,retryCount:1})});

if(!isAddress(usdc))throw new Error('ARC_USDC_ADDRESS is invalid');
if(operator&&!isAddress(operator))throw new Error('ARENA_OPERATOR_ADDRESS is invalid');
if(await client.getChainId()!==5042002)throw new Error('RPC is not Arc Testnet (5042002)');
const [decimals,symbol]=await Promise.all([
  client.readContract({address:usdc,abi:erc20Abi,functionName:'decimals'}),
  client.readContract({address:usdc,abi:erc20Abi,functionName:'symbol'}),
]);
if(decimals!==6||symbol!=='USDC')throw new Error('Configured token is not Arc Testnet USDC');
const artifact=JSON.parse(await readFile('out/ArenaV2.sol/ArenaFactoryV2.json','utf8')) as {abi:any;bytecode:{object:string}};
const bytecode=(artifact.bytecode.object.startsWith('0x')?artifact.bytecode.object:`0x${artifact.bytecode.object}`) as Hex;
if(bytecode.length<100)throw new Error('Factory bytecode is unavailable; run forge build');

if(!execute){
  process.stdout.write(JSON.stringify({mode:'read-only',chainId:5042002,usdc,usdcDecimals:decimals,operatorConfigured:Boolean(operator),bytecodeBytes:(bytecode.length-2)/2,
    next:'Set ARENA_OPERATOR_ADDRESS to a secured Circle/operator wallet, set ARENA_DEPLOYER_PRIVATE_KEY server-side, then rerun with --execute.'},null,2)+'\n');
}else{
  const key=process.env.ARENA_DEPLOYER_PRIVATE_KEY;
  if(!operator)throw new Error('ARENA_OPERATOR_ADDRESS is required for deployment');
  if(!key||!/^0x[\da-f]{64}$/i.test(key))throw new Error('ARENA_DEPLOYER_PRIVATE_KEY must be a server-side 32-byte hex key');
  const account=privateKeyToAccount(key as Hex);
  const wallet=createWalletClient({account,chain:arcTestnet,transport:http(rpc)});
  const txHash=await wallet.deployContract({abi:artifact.abi,bytecode,args:[usdc,operator]});
  const receipt=await client.waitForTransactionReceipt({hash:txHash,timeout:120000});
  if(receipt.status!=='success'||!receipt.contractAddress)throw new Error('Deployment did not yield a successful factory receipt');
  const factory=receipt.contractAddress;
  const [boundUsdc,boundOperator]=await Promise.all([
    client.readContract({address:factory,abi:artifact.abi,functionName:'usdc'}),
    client.readContract({address:factory,abi:artifact.abi,functionName:'operator'}),
  ]);
  if(String(boundUsdc).toLowerCase()!==usdc.toLowerCase()||String(boundOperator).toLowerCase()!==operator.toLowerCase())throw new Error('Deployed factory configuration does not match the requested addresses');
  const manifest={network:'Arc Testnet',chainId:5042002,factoryVersion:'ArenaFactoryV2',factory,usdc,operator,deployer:account.address,
    deploymentTxHash:txHash,blockNumber:receipt.blockNumber.toString(),explorer:`https://explorer.testnet.arc.io/address/${factory}`,deployedAt:new Date().toISOString()};
  await mkdir('deployments',{recursive:true});
  await writeFile('deployments/arc-testnet-v2.json',JSON.stringify(manifest,null,2)+'\n');
  process.stdout.write(JSON.stringify(manifest,null,2)+'\n');
}
