import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { PublicKey, actions, baseEncode, createTransaction, encodeTransaction } from 'near-api-js';
import { SIGN_IN_METHOD, checkFastAuthProof } from '../src/server/near/fastauth';

// A local ed25519 key stands in for the MPC-derived key; the browser builds the same bytes with near-api-js v5.
const CONTRACT = 'agent-arena-ad7b13.testnet';
const RECIPIENT = 'holecard.fun';
const expected = { receiverId: CONTRACT, recipient: RECIPIENT };

function setup(
  overrides: {
    receiver?: string;
    txNonce?: bigint;
    blockHash?: Uint8Array;
    gas?: bigint;
    method?: string;
    argsNonce?: string;
    recipient?: string;
    signRaw?: boolean;
    secret?: Uint8Array;
  } = {},
) {
  const secret = overrides.secret ?? ed25519.utils.randomSecretKey();
  const pub = ed25519.getPublicKey(secret);
  const publicKey = `ed25519:${baseEncode(pub)}`;
  const accountId = Buffer.from(pub).toString('hex');
  const nonce = randomBytes(32).toString('base64');
  const args = Buffer.from(
    JSON.stringify({ recipient: overrides.recipient ?? RECIPIENT, nonce: overrides.argsNonce ?? nonce }),
  );
  const tx = createTransaction(
    accountId,
    PublicKey.fromString(publicKey),
    overrides.receiver ?? CONTRACT,
    overrides.txNonce ?? 0n,
    [actions.functionCall(overrides.method ?? SIGN_IN_METHOD, args, overrides.gas ?? 0n, 0n)],
    overrides.blockHash ?? new Uint8Array(32),
  );
  const bytes = Buffer.from(encodeTransaction(tx));
  const signed = overrides.signRaw ? bytes : createHash('sha256').update(bytes).digest();
  const signature = Buffer.from(ed25519.sign(signed, secret)).toString('base64');
  return { accountId, publicKey, transaction: bytes.toString('base64'), signature, nonce, secret, bytes };
}

describe('NEAR Auth sign-in proof', () => {
  it('accepts the derived key signing the sign-in transaction hash', () => {
    const p = setup();
    expect(checkFastAuthProof(p, expected)).toEqual({ accountId: p.accountId, publicKey: p.publicKey });
  });

  it('also accepts a signature over the raw transaction bytes', () => {
    const p = setup({ signRaw: true });
    expect(checkFastAuthProof(p, expected).accountId).toBe(p.accountId);
  });

  it('rejects a transaction carrying a different challenge', () => {
    const p = setup({ argsNonce: randomBytes(32).toString('base64') });
    expect(() => checkFastAuthProof(p, expected)).toThrow(/challenge/);
  });

  it('rejects a transaction made for another site', () => {
    expect(() => checkFastAuthProof(setup({ recipient: 'evil.example' }), expected)).toThrow(/challenge/);
  });

  it('rejects a transaction to another contract', () => {
    expect(() => checkFastAuthProof(setup({ receiver: 'other.testnet' }), expected)).toThrow(/different contract/);
  });

  it('rejects anything that could execute on chain', () => {
    expect(() => checkFastAuthProof(setup({ txNonce: 5n }), expected)).toThrow(/executable/);
    const hash = new Uint8Array(32);
    hash[0] = 1;
    expect(() => checkFastAuthProof(setup({ blockHash: hash }), expected)).toThrow(/executable/);
    expect(() => checkFastAuthProof(setup({ gas: 30_000_000_000_000n }), expected)).toThrow(/zero-gas/);
    expect(() => checkFastAuthProof(setup({ method: 'withdraw' }), expected)).toThrow(/zero-gas/);
  });

  it('rejects a signature from another key', () => {
    const p = setup();
    const other = setup();
    expect(() => checkFastAuthProof({ ...p, signature: other.signature }, expected)).toThrow(/signature/);
  });

  it('rejects a signature that belongs to another sign-in transaction of the same key', () => {
    const secret = ed25519.utils.randomSecretKey();
    const first = setup({ secret }),
      second = setup({ secret });
    expect(() => checkFastAuthProof({ ...second, signature: first.signature }, expected)).toThrow(/signature/);
  });

  it('rejects an account that is not derived from the signing key', () => {
    const p = setup();
    expect(() => checkFastAuthProof({ ...p, accountId: 'alice.testnet' }, expected)).toThrow(/derived/);
  });

  it('rejects a proof missing fields', () => {
    expect(() => checkFastAuthProof({ accountId: 'x' }, expected)).toThrow(/required/);
  });
});
