import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { Account, JsonRpcProvider, KeyPair, PublicKey, actions, baseDecode, type KeyPairString } from 'near-api-js';

/** NEAR network access for the arena. Server keys: the operator key (calls operator-only
 * contract methods) and per-agent function-call keys (can only call enter/withdraw on the arena). */
export const NEAR_NETWORK = (process.env.NEAR_NETWORK || 'testnet') as 'testnet' | 'mainnet';
export const NEAR_RPC_URL =
  process.env.NEAR_RPC_URL ||
  (NEAR_NETWORK === 'mainnet' ? 'https://free.rpc.fastnear.com' : 'https://test.rpc.fastnear.com');
export const NEAR_EXPLORER = NEAR_NETWORK === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io';
export const YOCTO = 10n ** 24n;
export const contractId = () => {
  const v = process.env.ARENA_CONTRACT_ID;
  if (!v) throw new Error('ARENA_CONTRACT_ID is not configured');
  return v;
};
const operatorId = () => {
  const v = process.env.ARENA_OPERATOR_ID;
  if (!v) throw new Error('ARENA_OPERATOR_ID is not configured');
  return v;
};
const operatorKey = () => {
  const v = process.env.ARENA_OPERATOR_PRIVATE_KEY;
  if (!v) throw new Error('ARENA_OPERATOR_PRIVATE_KEY is not configured');
  return v as KeyPairString;
};
export const nearConfigured = () =>
  Boolean(
    process.env.ARENA_CONTRACT_ID &&
    process.env.ARENA_OPERATOR_ID &&
    process.env.ARENA_OPERATOR_PRIVATE_KEY &&
    process.env.AGENT_KEY_SECRET,
  );

export const provider = new JsonRpcProvider({ url: NEAR_RPC_URL });
const GAS = 100_000_000_000_000n; // 100 Tgas
const AGENT_GAS = 30_000_000_000_000n; // 30 Tgas

export async function view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await provider.callFunction({
    contractId: contractId(),
    method,
    args,
    blockQuery: { finality: 'final' },
  })) as T;
}

type TxResult = { value: unknown; txHash: string };
async function call(
  account: Account,
  method: string,
  args: Record<string, unknown>,
  deposit = 0n,
  gas = GAS,
): Promise<TxResult> {
  const outcome = await account.signAndSendTransaction({
    receiverId: contractId(),
    waitUntil: 'FINAL',
    actions: [actions.functionCall(method, args, gas, deposit)],
  });
  const status = outcome.status as { SuccessValue?: string; Failure?: unknown };
  if (status && typeof status === 'object' && 'Failure' in status && status.Failure)
    throw new Error(`NEAR ${method} failed: ${JSON.stringify(status.Failure).slice(0, 300)}`);
  // A receipt deeper in the tree can fail even when the top-level status succeeds.
  const failed = outcome.receipts_outcome?.find(r => 'Failure' in (r.outcome.status as object));
  if (failed)
    throw new Error(
      `NEAR ${method} receipt failed: ${JSON.stringify((failed.outcome.status as { Failure: unknown }).Failure).slice(0, 300)}`,
    );
  const raw = status?.SuccessValue;
  let value: unknown = null;
  if (raw) {
    try {
      value = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    } catch {
      value = null;
    }
  }
  return { value, txHash: outcome.transaction_outcome.id };
}

/** Raw transaction from the relayer account (defaults to the operator). Returns the base64 SuccessValue. */
const relayerId = () => process.env.RELAYER_ID || operatorId();
const relayerKey = () => (process.env.RELAYER_PRIVATE_KEY || operatorKey()) as KeyPairString;
export async function relayerSend(
  receiverId: string,
  txActions: Parameters<Account['signAndSendTransaction']>[0]['actions'],
) {
  const outcome = await new Account(relayerId(), provider, relayerKey()).signAndSendTransaction({
    receiverId,
    actions: txActions,
    waitUntil: 'FINAL',
  });
  const status = outcome.status as { SuccessValue?: string; Failure?: unknown };
  if (status && typeof status === 'object' && 'Failure' in status && status.Failure)
    throw new Error(`Relayed transaction failed: ${JSON.stringify(status.Failure).slice(0, 300)}`);
  return { txHash: outcome.transaction_outcome.id, successValue: status?.SuccessValue ?? null };
}
export function operatorCall(method: string, args: Record<string, unknown>, deposit = 0n, gas = GAS) {
  return call(new Account(operatorId(), provider, operatorKey()), method, args, deposit, gas);
}

// ---------- agent function-call keys ----------

const vaultKey = () => {
  const v = process.env.AGENT_KEY_SECRET;
  if (!v || !/^[0-9a-f]{64}$/i.test(v)) throw new Error('AGENT_KEY_SECRET must be 32 bytes of hex');
  return Buffer.from(v, 'hex');
};
/** AES-256-GCM, bound to the agent account so a ciphertext cannot be swapped between agents. */
export function sealAgentKey(agentAccount: string, secret: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', vaultKey(), iv);
  cipher.setAAD(Buffer.from(agentAccount));
  const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map(b => b.toString('base64')).join('.');
}
export function openAgentKey(agentAccount: string, sealed: string) {
  const [iv, tag, body] = sealed.split('.').map(p => Buffer.from(p, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', vaultKey(), iv);
  decipher.setAAD(Buffer.from(agentAccount));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8') as KeyPairString;
}
export function newAgentKey(agentAccount: string) {
  const pair = KeyPair.fromRandom('ed25519');
  return { publicKey: pair.getPublicKey().toString(), sealed: sealAgentKey(agentAccount, pair.toString()) };
}
/** Signs with the agent's restricted key. The NEAR protocol rejects anything but enter/withdraw on the arena. */
export function agentCall(
  agentAccount: string,
  sealedKey: string,
  method: 'enter' | 'withdraw',
  args: Record<string, unknown>,
) {
  // Agent accounts hold ~0.1 NEAR; NEAR reserves prepaid gas up front, so keep it small (enter uses <10 Tgas).
  return call(new Account(agentAccount, provider, openAgentKey(agentAccount, sealedKey)), method, args, 0n, AGENT_GAS);
}

/**
 * Swaps an agent's restricted server key, signed with the agent owner's full-access key. Only possible when the
 * server holds the owner key, which is true for house agents (their owner keys derive from AGENT_KEY_SECRET).
 * Used when the stored server key is not on the account, for example after the database was recreated.
 */
export async function replaceServerKey(agentAccount: string, ownerSecretKey: string, staleKeys: string[]) {
  const config = await view<{ agent_gas_allowance: string }>('get_config');
  const fresh = newAgentKey(agentAccount);
  const outcome = await new Account(agentAccount, provider, ownerSecretKey as KeyPairString).signAndSendTransaction({
    receiverId: agentAccount,
    waitUntil: 'FINAL',
    actions: [
      ...staleKeys.map(k => actions.deleteKey(PublicKey.from(k))),
      actions.addFunctionCallAccessKey(
        PublicKey.from(fresh.publicKey),
        contractId(),
        ['enter', 'withdraw'],
        BigInt(config.agent_gas_allowance),
      ),
    ],
  });
  const status = outcome.status as { Failure?: unknown };
  if (status && typeof status === 'object' && 'Failure' in status && status.Failure)
    throw new Error(`Server key rotation failed: ${JSON.stringify(status.Failure).slice(0, 300)}`);
  return { ...fresh, txHash: outcome.transaction_outcome.id };
}

export async function accessKeys(accountId: string) {
  const list = await provider.viewAccessKeyList({ accountId, finalityQuery: { finality: 'final' } });
  return list.keys.map(k => ({
    publicKey: String(k.public_key),
    permission:
      k.access_key.permission === 'FullAccess'
        ? 'FullAccess'
        : {
            receiverId: (k.access_key.permission as { FunctionCall: { receiver_id: string } }).FunctionCall.receiver_id,
            methodNames: (k.access_key.permission as { FunctionCall: { method_names: string[] } }).FunctionCall
              .method_names,
            allowance:
              (k.access_key.permission as { FunctionCall: { allowance?: string | null } }).FunctionCall.allowance ??
              null,
          },
  }));
}
export async function accountBalance(accountId: string) {
  const state = await provider.viewAccount({ accountId, blockQuery: { finality: 'final' } });
  return String(state.amount);
}

// ---------- NEP-413 sign-in verification ----------

const NEP413_TAG = 2 ** 31 + 413;
function borshString(value: string) {
  const bytes = Buffer.from(value, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length);
  return Buffer.concat([len, bytes]);
}
/** sha256(borsh(u32 tag) || borsh(Payload{message, nonce[32], recipient, callbackUrl: Option<String>})) */
export function nep413Hash(input: {
  message: string;
  nonce: Uint8Array;
  recipient: string;
  callbackUrl?: string | null;
}) {
  if (input.nonce.length !== 32) throw new Error('NEP-413 nonce must be 32 bytes');
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(NEP413_TAG);
  const callback = input.callbackUrl
    ? Buffer.concat([Buffer.from([1]), borshString(input.callbackUrl)])
    : Buffer.from([0]);
  return createHash('sha256')
    .update(
      Buffer.concat([
        tag,
        borshString(input.message),
        Buffer.from(input.nonce),
        borshString(input.recipient),
        callback,
      ]),
    )
    .digest();
}
export function verifyNep413Signature(input: {
  publicKey: string;
  signature: string;
  message: string;
  nonce: Uint8Array;
  recipient: string;
  callbackUrl?: string | null;
}) {
  if (!input.publicKey.startsWith('ed25519:')) throw new Error('Only ed25519 NEAR keys are supported for sign-in');
  const pk = baseDecode(input.publicKey.slice(8));
  const sig =
    /^[A-Za-z0-9+/=]+$/.test(input.signature) && input.signature.length === 88
      ? Buffer.from(input.signature, 'base64')
      : Buffer.from(baseDecode(input.signature.replace(/^ed25519:/, '')));
  return ed25519.verify(sig, nep413Hash(input), pk);
}
/** The signing key must be a full-access key of the claimed account, or the signature proves nothing. */
/** An implicit account id is the hex of its ed25519 key, so the key proves ownership without an RPC lookup. */
export function isImplicitAccountOf(accountId: string, publicKey: string) {
  return (
    publicKey.startsWith('ed25519:') &&
    /^[0-9a-f]{64}$/.test(accountId) &&
    Buffer.from(baseDecode(publicKey.slice(8))).toString('hex') === accountId
  );
}
export async function isFullAccessKey(accountId: string, publicKey: string) {
  try {
    const key = await provider.viewAccessKey({ accountId, publicKey, finalityQuery: { finality: 'final' } });
    return key.permission === 'FullAccess';
  } catch {
    return false;
  }
}

export const validAccountId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length >= 2 &&
  value.length <= 64 &&
  /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(value);
export const formatNear = (yocto: bigint | string) => {
  const v = BigInt(yocto);
  const whole = v / YOCTO,
    frac = (v % YOCTO).toString().padStart(24, '0').slice(0, 4).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
};
export const parseNear = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d+(\.\d{1,6})?$/.test(value))
    throw new Error('NEAR amount must be positive with at most six decimals');
  const [w, f = ''] = value.split('.');
  const yocto = BigInt(w) * YOCTO + BigInt(f.padEnd(24, '0'));
  if (yocto <= 0n || yocto > 1000n * YOCTO) throw new Error('NEAR amount is outside the supported testnet range');
  return yocto;
};
export const txUrl = (hash: string) => `${NEAR_EXPLORER}/txns/${hash}`;
export const accountUrl = (id: string) => `${NEAR_EXPLORER}/address/${id}`;
