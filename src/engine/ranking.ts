import type { HandResult } from './hand';

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Final standings: survivors by stack, then busted players by the hand they busted in (later is
 * better), then by the stack they started that hand with, then by id. The OutLayer replay worker
 * (workers/replay/src/lib.rs `rank_players`) applies the same rule, so the two must stay in step. */
export function rankEntrants(
  startingStacks: Record<string, number>,
  history: Pick<HandResult, 'handNumber' | 'players' | 'payouts'>[],
): string[] {
  const stacks = { ...startingStacks };
  const busted = new Map<string, { hand: number; start: number }>();
  for (const hand of history)
    for (const p of hand.players) {
      const start = p.stack + p.contribution - (hand.payouts[p.id] || 0);
      if (p.stack <= 0) busted.set(p.id, { hand: hand.handNumber, start });
      stacks[p.id] = p.stack;
    }
  const ids = Object.keys(stacks);
  const alive = ids.filter(id => stacks[id] > 0).sort((a, b) => stacks[b] - stacks[a] || byId(a, b));
  const out = ids
    .filter(id => stacks[id] <= 0)
    .sort((a, b) => {
      const x = busted.get(a) || { hand: 0, start: 0 },
        y = busted.get(b) || { hand: 0, start: 0 };
      return y.hand - x.hand || y.start - x.start || byId(a, b);
    });
  return [...alive, ...out];
}

const CODES: Record<string, string> = { fold: 'f', check: 'k', call: 'c', 'all-in': 'a' };

/** One line per hand of space-separated accepted actions (`f k c a r<target>`), the log the contract
 * hashes into `replay_hash` and OutLayer replays. */
export function actionLog(history: Pick<HandResult, 'decisions'>[]): string[] {
  return history.map(h =>
    h.decisions.map(d => (d.action === 'raise' ? `r${d.raiseTarget}` : CODES[d.action] || '?')).join(' '),
  );
}
