import {isAddress,parseUnits} from 'viem';
import {FUNDING_CHAINS,type FundingChain} from '../../shared/arc';
export type FundingMode='send'|'bridge'|'deposit'|'spend';
export type FundingPlan={mode:FundingMode;source:FundingChain;amount:string;recipient:string;owner:string};
export function validateFundingPlan(plan:FundingPlan){
  if(!['send','bridge','deposit','spend'].includes(plan.mode)||!FUNDING_CHAINS.includes(plan.source))throw new Error('Only supported testnet funding routes are allowed');
  if(!isAddress(plan.owner)||!isAddress(plan.recipient)||/^0x0{40}$/i.test(plan.recipient))throw new Error('Valid creator and agent wallets required');
  if(!/^(0|[1-9]\d{0,8})(\.\d{1,6})?$/.test(plan.amount)||parseUnits(plan.amount,6)<=0n)throw new Error('Enter a positive USDC amount with at most 6 decimals');
  if(plan.mode==='send'&&plan.source!=='Arc_Testnet')throw new Error('Direct sends must use Arc Testnet');
  if(plan.mode==='bridge'&&plan.source==='Arc_Testnet')throw new Error('Choose a source testnet other than Arc');
  return plan;
}
export function safeExplorer(value?:string){
  if(!value)return undefined;
  try{const url=new URL(value);return url.protocol==='https:'&&['explorer.testnet.arc.io','testnet.arcscan.app','sepolia.basescan.org','sepolia.etherscan.io','sepolia.arbiscan.io'].includes(url.hostname)?url.href:undefined;}catch{return undefined;}
}
