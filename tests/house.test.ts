import { describe, it, expect, beforeAll } from 'vitest';
import { HOUSE_PERSONAS, houseAccount, houseOwner } from '../src/server/arena/house';
import { isImplicitAccountOf } from '../src/server/near/chain';

describe('house agents', () => {
  beforeAll(() => {
    process.env.AGENT_KEY_SECRET = '11'.repeat(32);
  });
  it('derives a stable, distinct implicit owner for every persona', () => {
    const owners = HOUSE_PERSONAS.map(p => houseOwner(p.name));
    expect(new Set(owners.map(o => o.accountId)).size).toBe(HOUSE_PERSONAS.length);
    for (const o of owners) {
      expect(o.accountId).toMatch(/^[0-9a-f]{64}$/);
      expect(isImplicitAccountOf(o.accountId, o.publicKey)).toBe(true);
    }
    expect(houseOwner('HOUSE VIPER')).toEqual(houseOwner('HOUSE VIPER'));
  });
  it('changes every owner and account name when the secret changes', () => {
    process.env.ARENA_CONTRACT_ID = 'arena.testnet';
    const owner = houseOwner('HOUSE GRANITE').accountId,
      account = houseAccount('HOUSE GRANITE');
    expect(account).toMatch(/^house-granite-[0-9a-f]{4}\.arena\.testnet$/);
    process.env.AGENT_KEY_SECRET = '22'.repeat(32);
    expect(houseOwner('HOUSE GRANITE').accountId).not.toBe(owner);
    expect(houseAccount('HOUSE GRANITE')).not.toBe(account);
  });
});
