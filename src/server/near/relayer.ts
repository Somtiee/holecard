import { SCHEMA, actions } from 'near-api-js';
import { deserialize } from 'borsh';
import { contractId, operatorBalance, parseNear, relayerSend } from './chain';
import { pool } from '../db';

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
  const args = Buffer.from(input.argsBase64, 'base64');
  const sent = await relayerSend(FASTAUTH_CONTRACT, [actions.functionCall('sign', args, gas, deposit)]);
  return { txHash: sent.txHash, successValue: sent.successValue };
}

/** Testnet starter stake so email/Google players can play without ever buying NEAR. Once per owner. */
export async function sponsorAgent(
  owner: string,
  agentAccount: string,
  deposit: (agent: string, yocto: bigint) => Promise<{ txHash: string }>,
) {
  const amount = process.env.SPONSOR_NEAR
    ? BigInt(Math.round(Number(process.env.SPONSOR_NEAR) * 1e6)) * 10n ** 18n
    : 0n;
  if (amount <= 0n || process.env.NEAR_NETWORK === 'mainnet')
    throw new Error('Starter stake is not offered on this arena');
  // The operator also pays for agent accounts, VRF requests, verified settlements and house-agent entries.
  // Never let starter stakes eat into that reserve, or matches start failing for everyone.
  const reserve = parseNear(process.env.OPERATOR_RESERVE_NEAR || '3');
  if ((await operatorBalance()) - amount < reserve)
    throw new Error('Starter stakes are paused while the arena tops up. Deposit testnet NEAR to this agent instead.');
  // Implicit-account sign-ins cost nothing to create, so "once per owner" alone does not bound the operator's spend.
  const today = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM sponsorships WHERE created_at>now()-interval '1 day'`,
  );
  if (Number(today.rows[0].n) >= Number(process.env.SPONSOR_DAILY_CAP || 25))
    throw new Error('Starter stakes are used up for today. Deposit NEAR to this agent instead.');
  const claimed = await pool.query(
    `INSERT INTO sponsorships(owner,agent) VALUES($1,$2) ON CONFLICT(owner) DO NOTHING RETURNING owner`,
    [owner, agentAccount],
  );
  if (!claimed.rowCount) throw new Error('Starter stake was already claimed by this account');
  try {
    const sent = await deposit(agentAccount, amount);
    await pool.query('UPDATE sponsorships SET tx_hash=$2 WHERE owner=$1', [owner, sent.txHash]);
    return { txHash: sent.txHash, amountYocto: amount.toString() };
  } catch (error) {
    await pool.query('DELETE FROM sponsorships WHERE owner=$1 AND tx_hash IS NULL', [owner]);
    throw error;
  }
}
