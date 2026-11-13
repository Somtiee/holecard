import { createHash } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { baseDecode, decodeTransaction } from 'near-api-js';
import { isImplicitAccountOf } from './chain';

/** NEAR Auth (FastAuth) sign-in: email, Google or passkey through NEAR Auth's Auth0 tenant, with the user's
 * ed25519 key derived by the MPC network.
 *
 * The published FastAuth SDK can sign NEAR transactions but not NEP-413 messages, so sign-in is proven with a
 * transaction that can never execute: it carries the server's single-use challenge, has nonce 0, a zero block
 * hash and a zero-gas call to a method the arena contract does not have. The user approves it on NEAR Auth's
 * screen, the MPC network signs it, and the server checks the signature against the derived key.
 *
 * Testnet uses NEAR Auth's shared development client, which only accepts callback URLs NEAR Auth has
 * allowlisted. A deployment can set its own FASTAUTH_CLIENT_ID / FASTAUTH_DOMAIN / FASTAUTH_SIGNING_AUDIENCE. */

export const SIGN_IN_METHOD = 'holecard_sign_in';
const SHARED_TESTNET_CLIENT_ID = 'np8paqIpMWmNbzT4xAvOOapZBjsOpptl';
export const fastAuthDomain = () => process.env.FASTAUTH_DOMAIN || 'login.testnet.fast-auth.com';
export const fastAuthClientId = () => process.env.FASTAUTH_CLIENT_ID || SHARED_TESTNET_CLIENT_ID;
export const fastAuthSigningAudience = () => process.env.FASTAUTH_SIGNING_AUDIENCE || null;

/** The browser returns from NEAR Auth to `${origin}${pathname}`; the app uses hash routes, so the path is "/". */
export const fastAuthRedirectUri = () => {
  const origin = (process.env.PUBLIC_ORIGIN || '').replace(/\/$/, '');
  return origin ? `${origin}/` : null;
};

// Whether NEAR Auth accepts this server's callback URL. Checked against the live Auth0 tenant, so email sign-in
// switches on by itself once NEAR Auth allowlists the domain, with no redeploy. Refreshed in the background.
const CALLBACK_TTL_MS = 10 * 60_000;
let callback = { allowed: false, checkedAt: 0, redirect: '' };
let checking: Promise<void> | null = null;
async function checkCallback() {
  const redirect = fastAuthRedirectUri();
  if (!redirect) {
    callback = { allowed: false, checkedAt: Date.now(), redirect: '' };
    return;
  }
  const url = new URL(`https://${fastAuthDomain()}/authorize`);
  url.search = new URLSearchParams({
    client_id: fastAuthClientId(),
    response_type: 'code',
    scope: 'openid',
    redirect_uri: redirect,
    state: 'holecard-callback-check',
    nonce: 'holecard-callback-check',
  }).toString();
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
    // Auth0 redirects into its login page for an allowed callback and answers 403 "Callback URL mismatch" otherwise.
    callback = { allowed: res.status >= 300 && res.status < 400, checkedAt: Date.now(), redirect };
  } catch {
    callback = { ...callback, checkedAt: Date.now(), redirect };
  }
}
export function fastAuthCallbackAllowed() {
  if (Date.now() - callback.checkedAt > CALLBACK_TTL_MS && !checking)
    checking = checkCallback().finally(() => (checking = null));
  return callback.allowed;
}
export const refreshFastAuthCallback = () => checkCallback();

export type FastAuthSignInProof = {
  accountId: string;
  publicKey: string;
  transaction: string; // base64 borsh Transaction exactly as sent to NEAR Auth
  signature: string; // base64 ed25519 signature recovered from the MPC response
  nonce: string; // base64 32-byte sign-in challenge
};

/** Checks that `signature` is the derived key's signature over a never-executable sign-in transaction for
 * this arena and this challenge. Pure: the caller still has to consume the challenge. */
export function checkFastAuthProof(
  proof: Partial<Record<keyof FastAuthSignInProof, unknown>>,
  expected: { receiverId: string; recipient: string },
) {
  const { accountId, publicKey, transaction, signature, nonce } = proof;
  if (
    typeof accountId !== 'string' ||
    typeof publicKey !== 'string' ||
    typeof transaction !== 'string' ||
    typeof signature !== 'string' ||
    typeof nonce !== 'string'
  )
    throw new Error('Account, public key, transaction, signature and nonce required');
  if (!isImplicitAccountOf(accountId, publicKey))
    throw new Error('NEAR Auth sign-in must use the account derived from its key');
  if (Buffer.from(nonce, 'base64').length !== 32) throw new Error('Invalid sign-in nonce');
  const txBytes = Buffer.from(transaction, 'base64');
  if (txBytes.length === 0 || txBytes.length > 2048) throw new Error('Invalid sign-in transaction');
  const sig = Buffer.from(signature, 'base64');
  if (sig.length !== 64) throw new Error('Invalid NEAR Auth signature');

  let tx: ReturnType<typeof decodeTransaction>;
  try {
    tx = decodeTransaction(txBytes);
  } catch {
    throw new Error('Invalid sign-in transaction');
  }
  if (tx.signerId !== accountId || tx.publicKey.toString() !== publicKey)
    throw new Error('Sign-in transaction is for a different account');
  if (tx.receiverId !== expected.receiverId) throw new Error('Sign-in transaction is for a different contract');
  // Never executable: nonce 0, an all-zero block hash and a zero-gas call.
  if (BigInt(tx.nonce) !== 0n || Buffer.from(tx.blockHash).some(b => b !== 0))
    throw new Error('Sign-in transaction must not be executable');
  const call = tx.actions.length === 1 ? tx.actions[0].functionCall : undefined;
  if (!call || call.methodName !== SIGN_IN_METHOD || BigInt(call.gas) !== 0n || BigInt(call.deposit) !== 0n)
    throw new Error('Sign-in transaction must be a single zero-gas sign-in call');
  let args: { recipient?: unknown; nonce?: unknown };
  try {
    args = JSON.parse(Buffer.from(call.args).toString('utf8'));
  } catch {
    throw new Error('Invalid sign-in transaction');
  }
  if (args.recipient !== expected.recipient || args.nonce !== nonce)
    throw new Error('Sign-in transaction does not carry this challenge');

  // NEAR signs sha256(borsh(tx)). Accept a signature over the hash or the raw bytes: both bind the checked tx.
  const key = baseDecode(publicKey.slice('ed25519:'.length));
  const hash = createHash('sha256').update(txBytes).digest();
  if (!ed25519.verify(sig, hash, key) && !ed25519.verify(sig, txBytes, key))
    throw new Error('Invalid NEAR Auth signature');
  return { accountId, publicKey };
}
