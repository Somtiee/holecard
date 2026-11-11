import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { isAddress } from 'viem';

export function circleClient() {
  const { CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_WALLET_SET_ID } = process.env;
  if (!CIRCLE_API_KEY || !CIRCLE_ENTITY_SECRET || !CIRCLE_WALLET_SET_ID) return null;
  return initiateDeveloperControlledWalletsClient({ apiKey:CIRCLE_API_KEY, entitySecret:CIRCLE_ENTITY_SECRET });
}

/** Provisions a server-managed Arc Testnet EOA; Circle never returns private keys to this app. */
export async function provisionCircleWallet(agentId:string, name:string, idempotencyKey:string) {
  if(!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(idempotencyKey))throw new Error('A persisted UUID v4 is required for wallet provisioning');
  const client=circleClient();
  const walletSetId=process.env.CIRCLE_WALLET_SET_ID;
  if (!client || !walletSetId) throw new Error('Circle wallets are not configured. Set CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET and CIRCLE_WALLET_SET_ID on the server.');
  const response=await client.createWallets({
    walletSetId, blockchains:['ARC-TESTNET'], count:1, accountType:'EOA',
    idempotencyKey,
    metadata:[{name:`Agent Arena: ${name}`,refId:agentId}],
  });
  const wallet=response.data?.wallets?.[0];
  if (!wallet?.id || !isAddress(wallet.address) || wallet.blockchain!=='ARC-TESTNET' || wallet.walletSetId!==walletSetId) throw new Error('Circle did not return a valid wallet in the requested Arc Testnet wallet set.');
  return {id:wallet.id,address:wallet.address};
}

export async function getCircleUsdcBalance(walletId:string) {
  const client=circleClient();
  if (!client) throw new Error('Circle wallets are not configured.');
  const response=await client.getWalletTokenBalance({id:walletId,includeAll:true,tokenAddresses:[process.env.ARC_USDC_ADDRESS||'0x3600000000000000000000000000000000000000']});
  const token=response.data?.tokenBalances?.find((item:any)=>item.token?.symbol?.toUpperCase()==='USDC');
  return token?.amount ?? '0';
}

export function circleConfigured() {
  return Boolean(process.env.CIRCLE_API_KEY && process.env.CIRCLE_ENTITY_SECRET && process.env.CIRCLE_WALLET_SET_ID);
}
