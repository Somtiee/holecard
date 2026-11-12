import { createHash, randomBytes } from 'node:crypto';
import { fixtureDecision, playHand, type DecisionContext, type HandDecision, type HandSeat } from '../../engine/hand';
import { evaluateHand } from '../../engine/poker';

/** Free practice sit-and-go: your strategy against three house bots. No sign-in, no NEAR, no model calls —
 * the built-in rules policy plays every seat, so it is instant and costs nothing. Nothing is stored. */
export const PRACTICE_STRATEGIES = [
  'Aggressive',
  'Conservative',
  'Balanced',
  'Bluff Heavy',
  'Mathematical',
  'Adaptive',
] as const;
const HOUSE: { name: string; strategy: string }[] = [
  { name: 'GRANITE', strategy: 'Conservative' },
  { name: 'VIPER', strategy: 'Aggressive' },
  { name: 'MIRAGE', strategy: 'Bluff Heavy' },
];
const START_STACK = 1000,
  MAX_HANDS = 30,
  LEVEL_EVERY = 5;
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
const RANK_NAME: Record<string, string> = { T: '10', J: 'jack', Q: 'queen', K: 'king', A: 'ace' };
const POSITION_NAME: Record<string, string> = {
  BTN: 'on the button',
  SB: 'in the small blind',
  BB: 'in the big blind',
  UTG: 'under the gun',
  MP: 'in middle position',
  CO: 'in the cutoff',
};

export type PracticeSeat = { id: string; name: string; strategy: string; house: boolean };
export type PracticeHand = {
  handNumber: number;
  button: number;
  smallBlind: number;
  bigBlind: number;
  startStacks: Record<string, number>;
  holeCards: Record<string, string[]>;
  communityCards: string[];
  pot: number;
  endStacks: Record<string, number>;
  decisions: HandDecision[];
  winnerIds: string[];
  payouts: Record<string, number>;
  winningHand: string | null;
};
export type PracticeResult = {
  seed: string;
  policy: string;
  seats: PracticeSeat[];
  hands: PracticeHand[];
  standings: { id: string; name: string; stack: number; place: number }[];
  you: { place: number; net: number; handsWon: number; vpip: number };
};

const rankWord = (r: string) => RANK_NAME[r] || r;
function holding(ctx: DecisionContext) {
  const [a, b] = ctx.holeCards;
  if (!ctx.communityCards.length) {
    if (a[0] === b[0]) return `pocket ${rankWord(a[0])}s`;
    return `${rankWord(a[0])}-${rankWord(b[0])}${a[1] === b[1] ? ' suited' : ''}`;
  }
  return CATEGORY[evaluateHand([...ctx.holeCards, ...ctx.communityCards])[0]] || 'a made hand';
}
/** Practice cards are not secret, so practice decisions get a plain-language explanation of the rule that fired. */
function explain(ctx: DecisionContext, action: string, amount?: number) {
  const where = POSITION_NAME[ctx.position] || 'at the table',
    style = ctx.strategy.toLowerCase(),
    hand = holding(ctx);
  const call = ctx.legalActions.find(x => x.action === 'call')?.max || 0;
  const odds = call
    ? ` Calling ${call} into ${ctx.pot} needs ${Math.round((call / (ctx.pot + call)) * 100)}% equity.`
    : '';
  if (action === 'raise')
    return `${hand[0].toUpperCase()}${hand.slice(1)} ${where}. The ${style} plan raises to ${amount} here.`;
  if (action === 'call')
    return `${hand[0].toUpperCase()}${hand.slice(1)} ${where} is worth a call on the ${style} plan.${odds}`;
  if (action === 'check')
    return `${hand[0].toUpperCase()}${hand.slice(1)} ${where}; nothing to call, so it takes a free card.`;
  if (action === 'all-in') return `${hand[0].toUpperCase()}${hand.slice(1)} ${where}; commits the rest of the stack.`;
  return `${hand[0].toUpperCase()}${hand.slice(1)} ${where} isn't strong enough for the ${style} plan to continue.${odds}`;
}

export function practiceInput(input: Record<string, unknown>) {
  const name = String(input.name || '')
    .trim()
    .toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 _-]{0,19}$/.test(name)) throw new Error('Name your agent with 1–20 letters or numbers');
  if (HOUSE.some(h => h.name === name)) throw new Error('That name belongs to a house bot');
  const strategy = String(input.strategy || '');
  if (!(PRACTICE_STRATEGIES as readonly string[]).includes(strategy))
    throw new Error('Choose one of the listed strategies');
  return { name, strategy };
}

export async function runPractice(input: Record<string, unknown>): Promise<PracticeResult> {
  const { name, strategy } = practiceInput(input);
  const seats: PracticeSeat[] = [
    { id: 'you', name, strategy, house: false },
    ...HOUSE.map((h, i) => ({ id: `house-${i + 1}`, ...h, house: true })),
  ];
  const seed = randomBytes(32).toString('hex');
  const stacks: Record<string, number> = Object.fromEntries(seats.map(s => [s.id, START_STACK]));
  const hands: PracticeHand[] = [];
  for (let n = 1; n <= MAX_HANDS; n++) {
    const alive = seats.filter(s => stacks[s.id] > 0);
    if (alive.length < 2) break;
    const level = 1 + Math.floor((n - 1) / LEVEL_EVERY),
      smallBlind = 10 * level,
      bigBlind = 20 * level;
    const hole: Record<string, string[]> = {},
      reasons: string[] = [];
    const provider = async (ctx: DecisionContext) => {
      hole[ctx.agentId] = ctx.holeCards;
      const d = await fixtureDecision(ctx);
      reasons.push(explain(ctx, d.action, d.amount));
      return d;
    };
    const handSeats: HandSeat[] = alive.map(s => ({
      id: s.id,
      name: s.name,
      strategy: s.strategy,
      model: 'practice-rules',
      stack: stacks[s.id],
    }));
    const startStacks = { ...stacks };
    const hand = await playHand({
      seed: createHash('sha256').update(`practice:${seed}:${n}`).digest('hex'),
      handNumber: n,
      seats: handSeats,
      button: (n - 1) % alive.length,
      smallBlind,
      bigBlind,
      provider,
      timeoutMs: 2000,
      onDecision: d => {
        const why = reasons.shift();
        if (why) d.reason = why;
      },
    });
    for (const p of hand.players) {
      stacks[p.id] = p.stack;
      if (p.holeCards.length) hole[p.id] = p.holeCards;
    }
    const shown = hand.players.filter(p => p.holeCards.length);
    const best =
      shown.length > 1
        ? CATEGORY[
            Math.max(
              ...hand.winnerIds.map(id => {
                const p = hand.players.find(x => x.id === id)!;
                return p.holeCards.length ? evaluateHand([...p.holeCards, ...hand.communityCards])[0] : 0;
              }),
            )
          ]
        : null;
    hands.push({
      handNumber: n,
      button: hand.button,
      smallBlind,
      bigBlind,
      startStacks,
      holeCards: hole,
      communityCards: hand.communityCards,
      pot: hand.pot,
      endStacks: { ...stacks },
      decisions: hand.decisions,
      winnerIds: hand.winnerIds,
      payouts: hand.payouts,
      winningHand: best,
    });
  }
  const standings = seats
    .map(s => ({ id: s.id, name: s.name, stack: stacks[s.id] }))
    .sort((a, b) => b.stack - a.stack || (a.id === 'you' ? -1 : b.id === 'you' ? 1 : 0))
    .map((s, i) => ({ ...s, place: i + 1 }));
  const voluntary = hands.filter(h =>
    h.decisions.some(
      d => d.agentId === 'you' && d.stage === 'preflop' && ['call', 'raise', 'all-in'].includes(d.action),
    ),
  ).length;
  const dealt = hands.filter(h => 'you' in h.startStacks && h.startStacks.you > 0).length;
  return {
    seed,
    policy: 'Built-in rules policy. No model calls and nothing onchain.',
    seats,
    hands,
    standings,
    you: {
      place: standings.find(s => s.id === 'you')!.place,
      net: stacks.you - START_STACK,
      handsWon: hands.filter(h => h.winnerIds.includes('you')).length,
      vpip: dealt ? voluntary / dealt : 0,
    },
  };
}
