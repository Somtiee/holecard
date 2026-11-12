import { evaluateHand, seededRandom } from './poker';
import type { AgentDecision, DecisionContext } from './hand';

/**
 * Built-in rules player used by the practice table. It estimates its chance of winning by Monte Carlo
 * simulation against the live opponents, compares that with the price of calling, and then applies a
 * style. Pure and deterministic: the same decision context always produces the same decision.
 */
export type Style = {
  /** How wide it continues: 0 = only with a clear edge, 1 = calls almost any price. */
  looseness: number;
  /** How often a strong hand bets or raises instead of calling. */
  aggression: number;
  /** Chance of raising a weak hand from late position. */
  bluff: number;
  /** Plays strictly by pot odds (no looseness discount). */
  math?: boolean;
  /** Adjusts to stack depth: shoves or folds when short, tightens when deep and out of position. */
  adaptive?: boolean;
};

export const STYLES: Record<string, Style> = {
  Aggressive: { looseness: 0.55, aggression: 0.75, bluff: 0.14 },
  Conservative: { looseness: 0.15, aggression: 0.45, bluff: 0.02 },
  Balanced: { looseness: 0.35, aggression: 0.55, bluff: 0.07 },
  'Bluff Heavy': { looseness: 0.45, aggression: 0.65, bluff: 0.32 },
  Mathematical: { looseness: 0.1, aggression: 0.5, bluff: 0.03, math: true },
  Adaptive: { looseness: 0.3, aggression: 0.6, bluff: 0.08, adaptive: true },
};

const RANKS = '23456789TJQKA';
const SUITS = 'shdc';
const FULL_DECK = [...RANKS].flatMap(r => [...SUITS].map(s => r + s));
const CATEGORY = [
  'high card',
  'one pair',
  'two pair',
  'three of a kind',
  'a straight',
  'a flush',
  'a full house',
  'four of a kind',
  'a straight flush',
];
const RANK_WORD: Record<string, string> = { T: '10', J: 'jack', Q: 'queen', K: 'king', A: 'ace' };
const POSITION: Record<string, string> = {
  BTN: 'on the button',
  SB: 'in the small blind',
  BB: 'in the big blind',
  UTG: 'under the gun',
  MP: 'in middle position',
  CO: 'in the cutoff',
};
const LATE = new Set(['BTN', 'CO']);

function hashSeed(text: string) {
  let n = 2166136261;
  for (const c of text) n = Math.imul(n ^ c.charCodeAt(0), 16777619) >>> 0;
  return n;
}

const RANK_VALUE: Record<string, number> = Object.fromEntries([...RANKS].map((r, i) => [r, i + 2]));
const encode = (card: string) => RANK_VALUE[card[0]] * 4 + SUITS.indexOf(card[1]);

/** Fast 7-card score for simulation: one integer, higher is better (category, then up to five kickers). */
export function score7(cards: number[]) {
  const counts = new Array<number>(15).fill(0),
    suitMask = [0, 0, 0, 0],
    suitCount = [0, 0, 0, 0];
  let all = 0;
  for (const c of cards) {
    const r = c >> 2,
      su = c & 3;
    counts[r]++;
    suitMask[su] |= 1 << r;
    suitCount[su]++;
    all |= 1 << r;
  }
  const pack = (category: number, kickers: number[]) =>
    kickers.slice(0, 5).reduce((n, k, i) => n + k * 16 ** (4 - i), category * 16 ** 5);
  const straightHigh = (mask: number) => {
    if (mask & (1 << 14)) mask |= 1 << 1;
    for (let hi = 14; hi >= 5; hi--) if (((mask >> (hi - 4)) & 31) === 31) return hi;
    return 0;
  };
  const top = (mask: number, n: number) => {
    const out: number[] = [];
    for (let r = 14; r >= 2 && out.length < n; r--) if (mask & (1 << r)) out.push(r);
    return out;
  };
  const flushSuit = suitCount.findIndex(n => n >= 5);
  if (flushSuit >= 0) {
    const sf = straightHigh(suitMask[flushSuit]);
    if (sf) return pack(8, [sf]);
  }
  const quads: number[] = [],
    trips: number[] = [],
    pairs: number[] = [];
  for (let r = 14; r >= 2; r--) {
    if (counts[r] === 4) quads.push(r);
    else if (counts[r] === 3) trips.push(r);
    else if (counts[r] === 2) pairs.push(r);
  }
  if (quads.length) return pack(7, [quads[0], ...top(all & ~(1 << quads[0]), 1)]);
  if (trips.length && (trips.length > 1 || pairs.length))
    return pack(6, [trips[0], Math.max(trips[1] || 0, pairs[0] || 0)]);
  if (flushSuit >= 0) return pack(5, top(suitMask[flushSuit], 5));
  const st = straightHigh(all);
  if (st) return pack(4, [st]);
  if (trips.length) return pack(3, [trips[0], ...top(all & ~(1 << trips[0]), 2)]);
  if (pairs.length >= 2) return pack(2, [pairs[0], pairs[1], ...top(all & ~(1 << pairs[0]) & ~(1 << pairs[1]), 1)]);
  if (pairs.length) return pack(1, [pairs[0], ...top(all & ~(1 << pairs[0]), 3)]);
  return pack(0, top(all, 5));
}

/** Share of the pot this hand wins on average against `opponents` random hands (ties split). */
export function estimateEquity(hole: string[], board: string[], opponents: number, samples: number, seed: number) {
  const known = new Set([...hole, ...board]);
  const deck = FULL_DECK.filter(c => !known.has(c)).map(encode);
  const mineFixed = hole.map(encode),
    boardFixed = board.map(encode);
  const need = 5 - board.length + opponents * 2;
  const random = seededRandom(seed);
  const runout = new Array<number>(5),
    hand = new Array<number>(7);
  let won = 0;
  for (let n = 0; n < samples; n++) {
    // Partial Fisher-Yates: only the cards this sample needs.
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(random() * (deck.length - i));
      const t = deck[i];
      deck[i] = deck[j];
      deck[j] = t;
    }
    for (let i = 0; i < 5; i++) runout[i] = i < boardFixed.length ? boardFixed[i] : deck[i - boardFixed.length];
    for (let i = 0; i < 5; i++) hand[i] = runout[i];
    hand[5] = mineFixed[0];
    hand[6] = mineFixed[1];
    const mine = score7(hand);
    let share = 1,
      tied = 1;
    for (let o = 0; o < opponents; o++) {
      const offset = 5 - boardFixed.length + o * 2;
      hand[5] = deck[offset];
      hand[6] = deck[offset + 1];
      const theirs = score7(hand);
      if (theirs > mine) {
        share = 0;
        break;
      }
      if (theirs === mine) tied++;
    }
    won += share / tied;
  }
  return won / samples;
}

/** Preflop equity depends only on the starting-hand class (e.g. "AKs", "77") and the number of opponents,
 * so it is computed once per class with a fixed seed and cached. */
const preflopCache = new Map<string, number>();
export function preflopEquity(hole: string[], opponents: number) {
  const [a, b] = [...hole].sort((x, y) => RANKS.indexOf(y[0]) - RANKS.indexOf(x[0]));
  const key = `${a[0]}${b[0]}${a[0] === b[0] ? '' : a[1] === b[1] ? 's' : 'o'}:${opponents}`;
  let equity = preflopCache.get(key);
  if (equity === undefined) {
    const canonical = [`${a[0]}s`, `${b[0]}${a[1] === b[1] ? 's' : 'h'}`];
    equity = estimateEquity(canonical, [], opponents, 1500, hashSeed(key));
    preflopCache.set(key, equity);
  }
  return equity;
}

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);
function holding(ctx: DecisionContext) {
  const [a, b] = [...ctx.holeCards].sort((x, y) => RANKS.indexOf(y[0]) - RANKS.indexOf(x[0]));
  if (!ctx.communityCards.length) {
    if (a[0] === b[0]) return `pocket ${RANK_WORD[a[0]] || a[0]}s`;
    return `${RANK_WORD[a[0]] || a[0]}-${RANK_WORD[b[0]] || b[0]}${a[1] === b[1] ? ' suited' : ''}`;
  }
  return CATEGORY[evaluateHand([...ctx.holeCards, ...ctx.communityCards])[0]] || 'a made hand';
}

/** Decide one action and explain it in one sentence. */
export function styledDecision(ctx: DecisionContext, style: Style, bigBlind: number): AgentDecision {
  const live = ctx.opponents.filter(o => !o.folded).length || 1;
  const seed = hashSeed(
    `${ctx.agentId}|${ctx.holeCards.join('')}|${ctx.communityCards.join('')}|${ctx.pot}|${ctx.stack}`,
  );
  const equity = ctx.communityCards.length
    ? estimateEquity(ctx.holeCards, ctx.communityCards, Math.min(live, 5), 150, seed)
    : preflopEquity(ctx.holeCards, Math.min(live, 5));
  const roll = seededRandom(seed ^ 0x9e3779b9)();
  const fair = 1 / (live + 1);
  const call = ctx.legalActions.find(a => a.action === 'call');
  const raise = ctx.legalActions.find(a => a.action === 'raise');
  const allIn = ctx.legalActions.find(a => a.action === 'all-in');
  const canCheck = ctx.legalActions.some(a => a.action === 'check');
  const toCall = call?.max ?? 0;
  const price = toCall ? toCall / (ctx.pot + toCall) : 0;
  const late = LATE.has(ctx.position);
  const depth = ctx.stack / Math.max(1, bigBlind);

  let looseness = style.looseness,
    aggression = style.aggression,
    bluff = style.bluff;
  if (style.adaptive) {
    if (depth < 12) ((aggression = 0.9), (looseness = 0.2));
    else if (!late && depth > 40) looseness = 0.15;
    if (late && live <= 2) bluff = 0.18;
  }

  const pct = `${Math.round(equity * 100)}%`;
  const where = POSITION[ctx.position] || 'at the table';
  const opponents = `${live} opponent${live === 1 ? '' : 's'}`;
  const head = `${capitalize(holding(ctx))} ${where}, about ${pct} to win against ${opponents}.`;

  // Short stack with a decent hand: commit now rather than bleed blinds.
  if (allIn && depth < 10 && equity > fair * (1.25 - aggression * 0.3))
    return { action: 'all-in', amount: allIn.max, reason: `${head} Short stack, so it moves all in.` };

  const strong = equity > fair * (1.75 - aggression * 0.55);
  const bluffing = !strong && late && roll < bluff && (!toCall || toCall <= bigBlind * 3);
  if (raise && (strong || bluffing) && roll < 0.35 + aggression * 0.6) {
    const size = Math.floor((ctx.pot + toCall) * (0.5 + aggression * 0.5));
    const target = Math.min(raise.max ?? raise.min!, Math.max(raise.min!, raise.min! + size));
    return {
      action: 'raise',
      amount: target,
      reason: bluffing
        ? `${head} Raises to ${target} as a bluff from late position.`
        : `${head} Raises to ${target} for value.`,
    };
  }
  if (canCheck) return { action: 'check', reason: `${head} Checks.` };
  const needed = style.math ? price : price * (1.15 - looseness * 0.75);
  if (call && equity >= needed)
    return {
      action: 'call',
      reason:
        equity >= price
          ? `${head} Calling ${toCall} into ${ctx.pot} needs ${Math.round(price * 100)}%, so it calls.`
          : `${head} Calling ${toCall} into ${ctx.pot} needs ${Math.round(price * 100)}%; it calls anyway, betting on playing the hand well later.`,
    };
  return {
    action: 'fold',
    reason: `${head} Calling ${toCall} into ${ctx.pot} needs ${Math.round(price * 100)}%, so it folds.`,
  };
}
