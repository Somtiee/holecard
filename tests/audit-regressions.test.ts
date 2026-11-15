import { describe, expect, it } from 'vitest';
import { playHand, type DecisionContext, type DecisionProvider } from '../src/engine/hand';
import { replayMatches } from '../src/server/arena/verification';
import { createDeck, legalActions, seededRandom, validateAction } from '../src/engine/poker';

const seats = [
  { id: 'a', name: 'A', stack: 100, strategy: 'Balanced', model: 'test' },
  { id: 'b', name: 'B', stack: 100, strategy: 'Balanced', model: 'test' },
];
const run = (provider: DecisionProvider, customSeats = seats) =>
  playHand({
    seed: 42,
    handNumber: 1,
    seats: customSeats,
    button: 0,
    smallBlind: 10,
    bigBlind: 20,
    provider,
    timeoutMs: 50,
  });

describe('audit regression: engine trust boundaries', () => {
  it('rejects a one-chip raise when the last full raise is twenty', () => {
    const player = { id: 'a', name: 'A', stack: 100, contribution: 0, folded: false, holeCards: [] };
    expect(legalActions(player, 20, 20).find(a => a.action === 'raise')?.min).toBe(40);
    expect(() => validateAction(player, 20, { action: 'raise', amount: 21 }, 20)).toThrow();
  });
  it('continues safely after a provider returns null', async () => {
    const result = await run(async () => null as any);
    expect(result.players.reduce((n, p) => n + p.stack, 0)).toBe(200);
    expect(result.decisions.every(d => d.action === 'check' || d.action === 'fold')).toBe(true);
  });
  it('does not ask the sole player with chips to bet or fold against an all-in opponent after matching', async () => {
    const seen: DecisionContext[] = [];
    await run(
      async context => {
        seen.push(context);
        return { action: context.legalActions.some(a => a.action === 'call') ? 'call' : 'check' };
      },
      [
        { ...seats[0], stack: 100 },
        { ...seats[1], stack: 20 },
      ],
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].communityCards).toHaveLength(0);
  });
  it('records the fallback explanation instead of an illegal model action explanation', async () => {
    const result = await run(async () => ({ action: 'raise', amount: -10, reason: 'I raised successfully.' }));
    expect(result.decisions.every(d => !d.reason.includes('raised successfully'))).toBe(true);
  });
  it('does not reopen raising for a player who already acted after a short all-in', async () => {
    let first = true;
    const aTurns: DecisionContext[] = [];
    await run(
      async context => {
        if (context.agentId === 'a' && context.communityCards.length === 0) {
          aTurns.push(context);
          if (first) {
            first = false;
            return { action: 'raise', amount: 100 };
          }
        }
        if (context.agentId === 'b') return { action: 'all-in' };
        return { action: context.legalActions.some(a => a.action === 'check') ? 'check' : 'call' };
      },
      [
        { ...seats[0], stack: 500 },
        { ...seats[1], stack: 150 },
        { ...seats[1], id: 'c', stack: 500 },
      ],
    );
    expect(aTurns).toHaveLength(2);
    expect(aTurns[1].legalActions.map(a => a.action)).toEqual(['fold', 'call']);
  });
  it('checks payout amounts independently of JSON object key order', async () => {
    const hand = await run(async ctx => ({
      action: ctx.legalActions.some(a => a.action === 'check') ? 'check' : 'call',
    }));
    const reversed = Object.fromEntries(Object.entries(hand.payouts).reverse());
    expect(Object.keys(reversed)).not.toEqual(Object.keys(hand.payouts));
    expect(await replayMatches({ ...hand, payouts: reversed })).toBe(true);
    const [agent, payout] = Object.entries(reversed)[0];
    expect(await replayMatches({ ...hand, payouts: { ...reversed, [agent]: payout + 1 } })).toBe(false);
  });
  it('uses the entire 256-bit seed, while preserving legacy numeric replay seeds', () => {
    const seed = 'a'.repeat(64);
    expect(createDeck(seed)).toEqual(createDeck(seed));
    expect(createDeck(seed)).not.toEqual(createDeck(seed.slice(0, 63) + 'b'));
    expect(new Set(createDeck(seed)).size).toBe(52);
    expect(createDeck(42)).toEqual(createDeck(42));
  });
  it('conserves integer chips across 250 adversarial legal action sequences with uneven stacks', async () => {
    for (let seed = 1; seed <= 250; seed++) {
      const random = seededRandom(seed),
        table = Array.from({ length: 2 + (seed % 7) }, (_, i) => ({
          ...seats[0],
          id: String(i),
          stack: 20 + Math.floor(random() * 300),
        }));
      const total = table.reduce((n, p) => n + p.stack, 0);
      const result = await playHand({
        seed,
        handNumber: seed,
        seats: table,
        button: seed % table.length,
        smallBlind: 10,
        bigBlind: 20,
        provider: async ctx => {
          const action = ctx.legalActions[Math.floor(random() * ctx.legalActions.length)];
          return { action: action.action as any, amount: action.min };
        },
      });
      expect(
        result.players.reduce((n, p) => n + p.stack, 0),
        `seed ${seed}`,
      ).toBe(total);
      expect(
        result.players.every(p => Number.isSafeInteger(p.stack) && p.stack >= 0),
        `seed ${seed}`,
      ).toBe(true);
    }
  });
});
