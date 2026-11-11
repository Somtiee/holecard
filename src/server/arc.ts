import {createPublicClient,formatUnits,http,parseAbi,type Address} from 'viem';
import {arcTestnet} from 'viem/chains';
import {ARC_CHAIN_ID,ARC_EXPLORER,ARC_IDENTITY_REGISTRY,ARC_MULTICALL_FROM,ARC_REPUTATION_REGISTRY,ARC_USDC} from '../shared/arc';

export const arcClient=createPublicClient({chain:arcTestnet,transport:http(process.env.ARC_RPC_URL||'https://rpc.testnet.arc.network',{timeout:10000,retryCount:1})});
const bindingsAbi=parseAbi(['function usdc() view returns (address)','function operator() view returns (address)']);
let cached:Awaited<ReturnType<typeof readStatus>>|null=null,expires=0;
let pending:Promise<Awaited<ReturnType<typeof readStatus>>>|null=null;
async function readStatus(){
  const deployments=[{key:'usdc',name:'Native USDC',address:ARC_USDC},{key:'identity',name:'ERC-8004 Identity',address:ARC_IDENTITY_REGISTRY},{key:'reputation',name:'ERC-8004 Reputation',address:ARC_REPUTATION_REGISTRY},{key:'batch',name:'Multicall3From',address:ARC_MULTICALL_FROM}];
  const configured=process.env.ARENA_FACTORY_ADDRESS as Address|undefined;
  try{
    const [chainId,block,gasPrice,codes]=await Promise.all([arcClient.getChainId(),arcClient.getBlock(),arcClient.getGasPrice(),Promise.all(deployments.map(async d=>({...d,deployed:Boolean((await arcClient.getCode({address:d.address}))?.replace(/^0x/,''))})))]);
    const older=block.number&&block.number>=5n?await arcClient.getBlock({blockNumber:block.number-5n}):null;
    let factoryVerified=false;
    if(configured&&process.env.ARENA_OPERATOR_ADDRESS){
      const bindings=await Promise.all([arcClient.readContract({address:configured,abi:bindingsAbi,functionName:'usdc'}),arcClient.readContract({address:configured,abi:bindingsAbi,functionName:'operator'})]).catch(()=>null);
      factoryVerified=Boolean(bindings&&bindings[0].toLowerCase()===(process.env.ARC_USDC_ADDRESS||ARC_USDC).toLowerCase()&&bindings[1].toLowerCase()===process.env.ARENA_OPERATOR_ADDRESS.toLowerCase());
    }
    return{reachable:chainId===ARC_CHAIN_ID,chainId,blockNumber:block.number?.toString()||null,blockTimestamp:Number(block.timestamp)*1000,
      observedBlockSeconds:older?Number(block.timestamp-older.timestamp)/5:null,gasPriceNative:gasPrice.toString(),
      simpleTransferGasUsdc:formatUnits(gasPrice*21000n,18),explorer:ARC_EXPLORER,usdcAddress:ARC_USDC,nativeDecimals:18,tokenDecimals:6,
      contracts:codes,contractConfigured:Boolean(configured),factoryAddress:configured||null,settlementEnabled:chainId===ARC_CHAIN_ID&&factoryVerified,
      reason:factoryVerified?'Arc factory USDC and operator bindings verified.':configured?'Factory bindings have not been verified.':'No ArenaFactory deployment configured.',checkedAt:new Date().toISOString()};
  }catch{
    return{reachable:false,chainId:null,blockNumber:null,blockTimestamp:null,observedBlockSeconds:null,gasPriceNative:null,simpleTransferGasUsdc:null,
      explorer:ARC_EXPLORER,usdcAddress:ARC_USDC,nativeDecimals:18,tokenDecimals:6,contracts:deployments.map(d=>({...d,deployed:false})),contractConfigured:Boolean(configured),factoryAddress:configured||null,settlementEnabled:false,
      reason:'Arc RPC could not be reached.',checkedAt:new Date().toISOString()};
  }
}
export async function arcStatus(){
  if(cached&&Date.now()<expires)return cached;
  if(pending)return pending;
  pending=readStatus().then(value=>{cached=value;expires=Date.now()+15000;return value;}).finally(()=>{pending=null;});
  return pending;
}
