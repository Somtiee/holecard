/** NEAR Intents 1Click: quote what it costs to fund an agent's entry fee from another chain.
 * NEAR Intents runs on mainnet only (no testnet), so the arena requests `dry: true` quotes:
 * nothing is executed and no deposit address is issued. See README "NEAR Intents". */
const ONECLICK = (process.env.ONECLICK_BASE_URL || 'https://1click.chaindefuser.com').replace(/\/$/, '');

export const FUNDING_SOURCES = [
  {
    id: 'usdc-base',
    label: 'USDC on Base',
    assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
    decimals: 6,
  },
  {
    id: 'usdc-arb',
    label: 'USDC on Arbitrum',
    assetId: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near',
    decimals: 6,
  },
  {
    id: 'usdc-eth',
    label: 'USDC on Ethereum',
    assetId: 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near',
    decimals: 6,
  },
  {
    id: 'usdc-sol',
    label: 'USDC on Solana',
    assetId: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near',
    decimals: 6,
  },
  { id: 'eth', label: 'ETH on Ethereum', assetId: 'nep141:eth.omft.near', decimals: 18 },
  { id: 'sol', label: 'SOL', assetId: 'nep141:sol.omft.near', decimals: 9 },
  { id: 'btc', label: 'Bitcoin', assetId: 'nep141:btc.omft.near', decimals: 8 },
] as const;
const WNEAR = 'nep141:wrap.near';

export async function fundingQuote(input: { source: unknown; amountYocto: string }) {
  const source = FUNDING_SOURCES.find(s => s.id === input.source);
  if (!source) throw new Error('Unsupported funding source');
  const recipient = process.env.INTENTS_QUOTE_RECIPIENT;
  if (!recipient) throw new Error('Set INTENTS_QUOTE_RECIPIENT to a mainnet NEAR account to request Intents quotes');
  if (!/^\d{1,40}$/.test(input.amountYocto) || BigInt(input.amountYocto) <= 0n) throw new Error('Invalid quote amount');
  const body = {
    dry: true,
    swapType: 'EXACT_OUTPUT',
    slippageTolerance: 100,
    originAsset: source.assetId,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: WNEAR,
    amount: input.amountYocto,
    recipient,
    recipientType: 'DESTINATION_CHAIN',
    refundTo: recipient,
    refundType: 'INTENTS',
    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
  };
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (process.env.ONECLICK_JWT) headers.authorization = `Bearer ${process.env.ONECLICK_JWT}`;
  const res = await fetch(`${ONECLICK}/v0/quote`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const json = (await res.json().catch(() => ({}))) as { quote?: Record<string, string | number>; message?: string };
  if (!res.ok || !json.quote) throw new Error(`1Click quote failed: ${json.message || res.status}`);
  const q = json.quote;
  return {
    source: source.label,
    destination: 'wNEAR on NEAR mainnet',
    dry: true,
    amountIn: q.amountInFormatted,
    amountInUsd: q.amountInUsd,
    amountOut: q.amountOutFormatted,
    timeEstimateSeconds: q.timeEstimate,
    recipient,
    authenticated: Boolean(process.env.ONECLICK_JWT),
    note: 'Dry-run quote from the NEAR Intents 1Click API. Intents settle on mainnet; this arena deployment runs on NEAR testnet, so no swap is executed.',
  };
}
