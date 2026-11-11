import {AppKit,type BridgeResult} from '@circle-fin/app-kit';
import {createViemAdapterFromProvider,resolveChainIdentifier} from '@circle-fin/adapter-viem-v2';
import {formatUnits,type EIP1193Provider} from 'viem';
import {FUNDING_CHAINS} from '../../shared/arc';
import {validateFundingPlan,type FundingPlan} from './plan';
import type {MintRecovery} from './recovery';
export type FundingStep={name:string;state:string;txHash?:string;explorerUrl?:string};
export async function fundingSession(plan:FundingPlan,onStep:(step:FundingStep)=>void){
  validateFundingPlan(plan);
  const provider=(window as Window&{ethereum?:EIP1193Provider}).ethereum;
  if(!provider)throw new Error('Open this page with your connected EVM wallet.');
  const assertOwner=async()=>{const accounts=await provider.request({method:'eth_accounts'});if(accounts[0]?.toLowerCase()!==plan.owner.toLowerCase())throw new Error('Select the creator wallet used to sign in.');};
  await assertOwner();
  const adapter=await createViemAdapterFromProvider({provider,capabilities:{supportedChains:FUNDING_CHAINS.map(chain=>resolveChainIdentifier(chain))}});
  const kit=new AppKit();
  kit.on('*',event=>{const payload=event as unknown as Record<string,unknown>;const value=(payload.values||payload.data) as Record<string,unknown>|undefined;if(value)onStep({name:typeof value.name==='string'?value.name:String(payload.method||payload.type||'Gateway'),state:typeof value.state==='string'?value.state:'pending',txHash:typeof value.txHash==='string'?value.txHash:undefined,explorerUrl:typeof value.explorerUrl==='string'?value.explorerUrl:undefined});});
  const from={adapter,chain:plan.source},to={adapter,chain:'Arc_Testnet' as const,recipientAddress:plan.recipient};
  const send={from,to:plan.recipient,amount:plan.amount,token:'USDC' as const};
  const bridge={from,to,amount:plan.amount,token:'USDC' as const};
  const deposit={from,amount:plan.amount,token:'USDC' as const};
  const spend={from:[{adapter}],to,amount:plan.amount,token:'USDC' as const};
  return{
    async balances(){await assertOwner();return kit.unifiedBalance.getBalances({sources:[{adapter}],networkType:'testnet',includePending:true});},
    async estimate(){
      await assertOwner();
      if(plan.mode==='send'){const gas=await kit.estimateSend(send);return [`Estimated gas: ${formatUnits(BigInt(gas.fee),18)} USDC`];}
      if(plan.mode==='bridge'){const quote=await kit.estimateBridge(bridge);return [...quote.fees.map(f=>`${f.type}: ${f.amount??'unavailable'} ${f.token}`),...quote.gasFees.map(f=>`${f.name} gas: ${f.fees?formatUnits(BigInt(f.fees.fee),18):'unavailable'} ${f.token}`)];}
      if(plan.mode==='deposit'){await kit.unifiedBalance.estimateDeposit(deposit);return ['Gateway deposit estimate available. Review network gas in your wallet.','Deposits need source-chain finality before they become spendable.'];}
      const quote=await kit.unifiedBalance.estimateSpend(spend);return quote.fees.map(f=>`${f.type}: ${f.amount} ${f.token}`);
    },
    async execute(){
      await assertOwner();
      if(plan.mode!=='spend')await adapter.ensureChain(resolveChainIdentifier(plan.source));
      await assertOwner();
      if(plan.mode==='send'){const r=await kit.send(send);onStep(r);return{hash:r.txHash,complete:r.state==='success',bridge:undefined};}
      if(plan.mode==='bridge'){const r=await kit.bridge(bridge);r.steps.forEach(onStep);return{hash:r.steps.filter(s=>/mint/i.test(s.name)&&s.state==='success').at(-1)?.txHash,complete:r.state==='success',bridge:r};}
      if(plan.mode==='deposit'){const r=await kit.unifiedBalance.deposit(deposit);onStep({name:'Gateway deposit',state:'success',txHash:r.txHash,explorerUrl:r.explorerUrl});return{hash:undefined,complete:true,bridge:undefined};}
      const r=await kit.unifiedBalance.spend(spend);return{hash:r.txHash,complete:Boolean(r.txHash),bridge:undefined};
    },
    async retryMint(recovery:MintRecovery){await assertOwner();const r=await kit.unifiedBalance.spend({to,amount:plan.amount,token:'USDC',config:{retry:recovery}});return{hash:r.txHash,complete:Boolean(r.txHash),bridge:undefined};},
    async retry(result:BridgeResult){
      await assertOwner();
      if(result.source.address.toLowerCase()!==plan.owner.toLowerCase()||result.destination.recipientAddress?.toLowerCase()!==plan.recipient.toLowerCase()||result.destination.chain.chain!=='Arc_Testnet'||result.source.chain.chain!==plan.source||result.amount!==plan.amount)throw new Error('Saved bridge does not match this creator and agent.');
      const r=await kit.retryBridge(result,{from:adapter,to:adapter});r.steps.forEach(onStep);return{hash:r.steps.filter(s=>/mint/i.test(s.name)&&s.state==='success').at(-1)?.txHash,complete:r.state==='success',bridge:r};
    },
  };
}
