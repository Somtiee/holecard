import { describe, expect, it } from 'vitest';
import { actionLog, rankEntrants } from '../src/engine/ranking';

const hand = (handNumber: number, players: [string, number, number][], payouts: Record<string, number> = {}) => ({
  handNumber,
  players: players.map(([id, stack, contribution]) => ({
    id,
    stack,
    contribution,
    name: id,
    folded: false,
    holeCards: [],
  })),
  payouts,
});

describe('rankEntrants', () => {
  it('ranks survivors by stack and busted players by when they busted, not by id', () => {
    const start = { a: 100, b: 100, c: 100 };
    const history = [
      hand(
        1,
        [
          ['a', 0, 100],
          ['b', 200, 100],
          ['c', 100, 0],
        ],
        { b: 200 },
      ),
      hand(
        2,
        [
          ['b', 300, 100],
          ['c', 0, 100],
        ],
        { b: 200 },
      ),
    ];
    expect(rankEntrants(start, history)).toEqual(['b', 'c', 'a']);
  });

  it('breaks a same-hand bust by the larger starting stack, then by id', () => {
    const start = { a: 50, b: 100, c: 100, d: 50 };
    const history = [
      hand(
        1,
        [
          ['a', 0, 50],
          ['b', 0, 100],
          ['c', 300, 100],
          ['d', 0, 50],
        ],
        { c: 300 },
      ),
    ];
    expect(rankEntrants(start, history)).toEqual(['c', 'b', 'a', 'd']);
  });

  it('orders equal survivors by id with a plain byte comparison', () => {
    expect(rankEntrants({ b: 100, a: 100 }, [])).toEqual(['a', 'b']);
  });
});

describe('actionLog', () => {
  it('encodes accepted actions compactly, one line per hand', () => {
    const d = (action: string, raiseTarget?: number) => ({ action, raiseTarget }) as never;
    expect(
      actionLog([{ decisions: [d('call'), d('raise', 60), d('fold')] }, { decisions: [d('check'), d('all-in')] }]),
    ).toEqual(['c r60 f', 'k a']);
  });
});
