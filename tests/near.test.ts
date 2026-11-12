import { randomBytes } from 'node:crypto';
import { describe, expect, it, beforeAll } from 'vitest';
import { KeyPair } from 'near-api-js';
import {
  formatNear,
  nep413Hash,
  newAgentKey,
  openAgentKey,
  parseNear,
  sealAgentKey,
  validAccountId,
  verifyNep413Signature,
} from '../src/server/near/chain';
import { configHash, handSeed, newSeed, rosterHash, seedMatches } from '../src/server/arena/commitments';

beforeAll(() => {
  process.env.AGENT_KEY_SECRET = '11'.repeat(32);
});

describe('NEP-413 sign-in', () => {
  const message = 'Holecard sign-in',
    recipient = 'localhost';
  it('accepts a wallet signature over the NEP-413 payload hash', () => {
    const pair = KeyPair.fromRandom('ed25519'),
      nonce = randomBytes(32);
    const signature = Buffer.from(pair.sign(nep413Hash({ message, nonce, recipient })).signature).toString('base64');
    expect(
      verifyNep413Signature({ publicKey: pair.getPublicKey().toString(), signature, message, nonce, recipient }),
    ).toBe(true);
  });
  it('rejects a different message, nonce, recipient or key', () => {
    const pair = KeyPair.fromRandom('ed25519'),
      other = KeyPair.fromRandom('ed25519'),
      nonce = randomBytes(32);
    const signature = Buffer.from(pair.sign(nep413Hash({ message, nonce, recipient })).signature).toString('base64');
    const pk = pair.getPublicKey().toString();
    expect(verifyNep413Signature({ publicKey: pk, signature, message: 'other', nonce, recipient })).toBe(false);
    expect(verifyNep413Signature({ publicKey: pk, signature, message, nonce: randomBytes(32), recipient })).toBe(false);
    expect(verifyNep413Signature({ publicKey: pk, signature, message, nonce, recipient: 'evil.example' })).toBe(false);
    expect(
      verifyNep413Signature({ publicKey: other.getPublicKey().toString(), signature, message, nonce, recipient }),
    ).toBe(false);
  });
});

describe('agent key vault', () => {
  it('round-trips and binds the ciphertext to the agent account', () => {
    const key = newAgentKey('alpha.arena.testnet');
    expect(key.publicKey.startsWith('ed25519:')).toBe(true);
    const secret = openAgentKey('alpha.arena.testnet', key.sealed);
    expect(KeyPair.fromString(secret).getPublicKey().toString()).toBe(key.publicKey);
    expect(() => openAgentKey('bravo.arena.testnet', key.sealed)).toThrow();
    expect(sealAgentKey('a.testnet', 'x')).not.toBe(sealAgentKey('a.testnet', 'x'));
  });
});

describe('commitments shared with the NEAR contract', () => {
  it('matches the Rust roster_hash for the same roster', () => {
    // Same vector as contracts/near/src/tests.rs::roster_hash_matches_typescript
    const roster = [
      { agent: 'bravo.arena.testnet', config_hash: 'b'.repeat(64) },
      { agent: 'alpha.arena.testnet', config_hash: 'a'.repeat(64) },
    ];
    expect(rosterHash(roster)).toBe(ROSTER_VECTOR);
    expect(rosterHash([...roster].reverse())).toBe(ROSTER_VECTOR);
  });
  it('commits to a seed the contract can check with sha256', () => {
    const seed = newSeed();
    expect(seedMatches(seed.seed, seed.commitment)).toBe(true);
    expect(seedMatches('00'.repeat(32), seed.commitment)).toBe(false);
    expect(handSeed(seed.seed, 't', 1)).not.toBe(handSeed(seed.seed, 't', 2));
  });
  it('changes the config hash when strategy changes', () => {
    const base = {
      id: '1',
      owner: 'alice.testnet',
      nearAccount: 'a.arena.testnet',
      name: 'A',
      strategy: 'Balanced',
      model: 'm',
      description: '',
    };
    expect(configHash(base)).not.toBe(configHash({ ...base, strategy: 'Aggressive' }));
  });
});

describe('amounts and accounts', () => {
  it('parses and formats NEAR without floating point', () => {
    expect(parseNear('1.5')).toBe(1_500_000_000_000_000_000_000_000n);
    expect(formatNear(1_500_000_000_000_000_000_000_000n)).toBe('1.5');
    expect(() => parseNear('0')).toThrow();
    expect(() => parseNear('1e3')).toThrow();
  });
  it('validates NEAR account ids', () => {
    expect(validAccountId('alice.testnet')).toBe(true);
    expect(validAccountId('a'.repeat(64))).toBe(true);
    expect(validAccountId('Alice.testnet')).toBe(false);
    expect(validAccountId('bad..near')).toBe(false);
  });
});
const ROSTER_VECTOR = '6f14f0fd6a316dcd9d482f5b1c58ede47aae619212a4a4aadfb28812af6bbf61';
