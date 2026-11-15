import { SCHEMA, actions } from 'near-api-js';
import { deserialize } from 'borsh';
import { contractId, operatorBalance, parseNear, prepareOperatorCall, relayerSend } from './chain';
import { withTx } from '../db';
import { chainOp } from './journal';

/** NEP-366 meta-transaction relayer. Players sign a DelegateAction; the arena pays the gas.
 * Policy: the sender must be the signed-in account, the receiver must be the arena contract, and only
 * `deposit` / `withdraw` calls are relayed. The NEAR deposit itself still comes from the player. */
const RELAYABLE = new Set(['deposit', 'withdraw']);
const MAX_GAS = 100_000_000_000_000n;
type Decoded = {
  delegateAction: {
    senderId: string;
    receiverId: string;
    actions: { functionCall?: { methodName: string; gas: bigint; deposit: bigint } }[];
    maxBlockHeight: bigint;
  };
};

export function checkDelegate(signedDelegateBase64: string, sessionAccount: string) {
  let decoded: Decoded;
  try {
    decoded = deserialize(SCHEMA.SignedDelegate, Buffer.from(signedDelegateBase64, 'base64')) as Decoded;
  } catch {
    throw new Error('Invalid signed delegate action');
  }
  const d = decoded.delegateAction;
  if (d.senderId !== sessionAccount) throw new Error('Delegate action must be signed by the signed-in account');
  if (d.receiverId !== contractId()) throw new Error('Relayer only forwards calls to the arena contract');
  if (!d.actions.length || d.actions.length > 2) throw new Error('Relay one or two actions at a time');
  for (const a of d.actions) {
    if (!a.functionCall || !RELAYABLE.has(a.functionCall.methodName))
      throw new Error('Relayer only forwards deposit and withdraw');
    if (BigInt(a.functionCall.gas) > MAX_GAS) throw new Error('Too much gas requested');
  }
  return decoded;
}

export async function relayDelegate(signedDelegateBase64: string, sessionAccount: string) {
  const decoded = checkDelegate(signedDelegateBase64, sessionAccount);
  const sent = await relayerSend(decoded.delegateAction.senderId, [
    { signedDelegate: decoded } as unknown as ReturnType<typeof actions.transfer>,
  ]);
  return { txHash: sent.txHash };
}

/** NEAR Auth (FastAuth) message signing: the MPC `sign` call must be sent by a funded account. */
export const FASTAUTH_CONTRACT = process.env.FASTAUTH_CONTRACT_ID || 'fast-auth.testnet';
// The sign relay must work before sign-in, so it cannot require a session. Any NEAR Auth user could otherwise route
// their own MPC signing through it at the operator's expense; cap it arena-wide on top of the per-IP limit.
const fastAuthRelays: number[] = [];
function takeFastAuthRelaySlot() {
  const cap = Number(process.env.FASTAUTH_RELAY_HOURLY_CAP || 120),
    hourAgo = Date.now() - 3_600_000;
  while (fastAuthRelays.length && fastAuthRelays[0] < hourAgo) fastAuthRelays.shift();
  if (fastAuthRelays.length >= cap)
    throw new Error('NEAR Auth sign-in is busy right now. Try again later or sign in with a NEAR wallet.');
  fastAuthRelays.push(Date.now());
}

export async function relayFastAuthSign(input: {
  methodName?: unknown;
  argsBase64?: unknown;
  gas?: unknown;
  deposit?: unknown;
}) {
  if (input.methodName !== 'sign' || typeof input.argsBase64 !== 'string' || input.argsBase64.length > 16000)
    throw new Error('Only NEAR Auth sign calls are relayed');
  const gas = BigInt(String(input.gas || '300000000000000')),
    deposit = BigInt(String(input.deposit || '1'));
  if (gas > 300_000_000_000_000n || deposit > 1n) throw new Error('Relayer limits: 300 Tgas, 1 yoctoNEAR');
  takeFastAuthRelaySlot();
  const args = Buffer.from(input.argsBase64, 'base64');
  const sent = await relayerSend(FASTAUTH_CONTRACT, [actions.functionCall('sign', args, gas, deposit)]);
  return { txHash: sent.txHash, successValue: sent.successValue };
}

/** Testnet starter stake so email/Google players can play without ever buying NEAR. Once per owner. */
export async function sponsorAgent(owner: string, agentAccount: string) {
  const configured = process.env.SPONSOR_NEAR;
  if (!configured || Number(configured) <= 0 || process.env.NEAR_NETWORK === 'mainnet')
    throw new Error('Starter stake is not offered on this arena');
  const amount = parseNear(configured);
  const reserve = parseNear(process.env.OPERATOR_RESERVE_NEAR || '3');
  const cap = Number(process.env.SPONSOR_DAILY_CAP || 25);
  if (!Number.isSafeInteger(cap) || cap <= 0) throw new Error('Starter stakes are disabled');

  const claim = await withTx(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['sponsor-budget']);
    const {
      rows: [existing],
    } = await client.query<{ agent: string; amount_yocto: string | null; tx_hash: string | null }>(
      'SELECT agent,amount_yocto,tx_hash FROM sponsorships WHERE owner=$1',
      [owner],
    );
    if (existing) {
      if (existing.agent !== agentAccount || !existing.amount_yocto)
        throw new Error('Starter stake already claimed or awaiting reconciliation');
      return existing;
    }
    const {
      rows: [budget],
    } = await client.query<{ n: string; reserved: string }>(
      `SELECT count(*) FILTER (WHERE created_at>now()-interval '1 day')::text AS n,
       COALESCE(sum(amount_yocto) FILTER (WHERE tx_hash IS NULL),0)::text AS reserved FROM sponsorships`,
    );
    if (Number(budget.n) >= cap) throw new Error('Starter stakes are used up for today');
    if ((await operatorBalance()) - BigInt(budget.reserved) - amount < reserve)
      throw new Error('Starter stakes are paused while the arena tops up');
    await client.query('INSERT INTO sponsorships(owner,agent,amount_yocto) VALUES($1,$2,$3)', [
      owner,
      agentAccount,
      amount.toString(),
    ]);
    return { agent: agentAccount, amount_yocto: amount.toString(), tx_hash: null };
  });
  if (claim.tx_hash) return { state: 'confirmed', txHash: claim.tx_hash, amountYocto: claim.amount_yocto };
  const sent = await chainOp(
    `sponsor:${owner}`,
    { kind: 'sponsor', signer: 'operator', method: 'deposit' },
    prepareOperatorCall('deposit', { agent: claim.agent }, BigInt(claim.amount_yocto!)),
  );
  if (sent.state === 'confirmed')
    await withTx(async client => {
      // Synchronize releasing the reserved spend with quota checks.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['sponsor-budget']);
      await client.query('UPDATE sponsorships SET tx_hash=$2 WHERE owner=$1', [owner, sent.txHash]);
    });
  return { state: sent.state, txHash: sent.txHash, amountYocto: claim.amount_yocto };
}
