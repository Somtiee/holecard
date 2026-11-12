import { describe, it, expect } from 'vitest';
import { playHand, fixtureDecision, type DecisionContext } from '../src/engine/hand';

const seats = [
  { id: 'a', name: 'ALPHA', stack: 1000, strategy: 'Balanced', model: 'fixture' },
  { id: 'b', name: 'BETA', stack: 1000, strategy: 'Aggressive', model: 'fixture' },
  { id: 'c', name: 'GAMMA', stack: 1000, strategy: 'Conservative', model: 'fixture' },
  { id: 'd', name: 'DELTA', stack: 1000, strategy: 'Adaptive', model: 'fixture' },
];
const run = (seed: number, provider = fixtureDecision) =>
  playHand({
    seed,
    handNumber: 1,
    seats,
    button: 0,
    smallBlind: 10,
    bigBlind: 20,
    provider,
    timeoutMs: 20,
    now: (() => {
      let n = 100;
      return () => n++;
    })(),
  });

describe('authoritative Hold’em hand runner', () => {
  it('replays the same hand exactly from its seed', async () => {
    expect(await run(8821)).toEqual(await run(8821));
    expect(await run(8821)).not.toEqual(await run(8822));
  });
  it('conserves all player chips through betting and showdown', async () => {
    const hand = await run(19);
    expect(hand.stage).toBe('showdown');
    expect(hand.communityCards).toHaveLength(5);
    expect(hand.players.reduce((n, p) => n + p.stack, 0)).toBe(4000);
    expect(Object.values(hand.payouts).reduce((a, b) => a + b, 0)).toBe(hand.pot);
    expect(hand.winnerIds.length).toBeGreaterThan(0);
  });
  it('validates model decisions against the engine legal-action set', async () => {
    const hand = await run(37, async (context: DecisionContext) => ({
      action: context.legalActions[0].action as any,
      amount: context.legalActions[0].min,
    }));
    expect(hand.decisions.length).toBeGreaterThan(0);
    expect(hand.decisions.every(d => ['fold', 'check', 'call', 'raise', 'all-in'].includes(d.action))).toBe(true);
    expect(hand.players.reduce((n, p) => n + p.stack, 0)).toBe(4000);
  });
  it('uses check/fold when a provider returns an illegal action', async () => {
    const hand = await run(37, async () => ({ action: 'invented-action' as any }));
    expect(hand.decisions.length).toBeGreaterThan(0);
    expect(hand.decisions.every(d => d.action === 'check' || d.action === 'fold')).toBe(true);
  });
  it('uses check/fold when a provider times out', async () => {
    const hand = await playHand({
      seed: 91,
      handNumber: 1,
      seats,
      button: 0,
      smallBlind: 10,
      bigBlind: 20,
      timeoutMs: 2,
      provider: () => new Promise(() => {}),
    });
    expect(hand.decisions.every(d => d.action === 'check' || d.action === 'fold')).toBe(true);
    expect(hand.players.reduce((n, p) => n + p.stack, 0)).toBe(4000);
  });
  it('runs out the board and splits an all-in pot without losing chips', async () => {
    const hand = await run(111, async () => ({ action: 'all-in' }));
    expect(hand.communityCards).toHaveLength(5);
    expect(hand.players.reduce((n, p) => n + p.stack, 0)).toBe(4000);
    expect(Object.values(hand.payouts).reduce((a, b) => a + b, 0)).toBe(hand.pot);
  });
  it('does not provide hidden opponent cards or unrevealed community cards to the decision provider', async () => {
    let seen: DecisionContext | undefined;
    await run(23, async context => {
      seen ??= context;
      return { action: context.legalActions.some(x => x.action === 'check') ? 'check' : 'fold' };
    });
    expect(seen).toBeDefined();
    expect(seen!.holeCards).toHaveLength(2);
    expect(seen!.communityCards.length).toBeLessThanOrEqual(5);
    expect(seen!.opponents.every(p => !('holeCards' in p))).toBe(true);
    expect(seen).not.toHaveProperty('futureCards');
    expect(seen).not.toHaveProperty('seed');
  });
  it('never reveals folded players’ hole cards in public hand results or decision records', async () => {
    const hand = await run(137, async () => ({ action: 'fold' }));
    expect(hand.players.every(p => p.holeCards.length === 0)).toBe(true);
    expect(hand.decisions.every(d => !('holeCards' in d))).toBe(true);
  });
  it('reveals only live hands at showdown, never folded hands', async () => {
    const hand = await run(231, async context => {
      if (context.legalActions.some(a => a.action === 'check')) return { action: 'check' };
      return context.agentId === 'a' ? { action: 'call' } : { action: 'fold' };
    });
    expect(hand.players.filter(p => p.folded).every(p => p.holeCards.length === 0)).toBe(true);
  });
  it('publishes a live turn without private cards, seed, or model reasoning', async () => {
    const turns: unknown[] = [];
    await playHand({
      seed: 4,
      handNumber: 1,
      seats,
      button: 0,
      smallBlind: 10,
      bigBlind: 20,
      provider: fixtureDecision,
      onTurn: turn => {
        turns.push(turn);
      },
    });
    expect(turns.length).toBeGreaterThan(0);
    for (const turn of turns) {
      expect(turn).toHaveProperty('agentId');
      expect(turn).toHaveProperty('communityCards');
      expect(turn).not.toHaveProperty('holeCards');
      expect(turn).not.toHaveProperty('seed');
      expect(turn).not.toHaveProperty('reason');
    }
  });
});
