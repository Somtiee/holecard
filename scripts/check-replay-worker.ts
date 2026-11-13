/** Differential test for the OutLayer replay worker: plays many tournaments with the real TypeScript
 * engine (fixture policy) exactly the way the arena loop does, then checks the Rust worker reproduces
 * the ranking and every final stack, and rejects a tampered log.
 * Usage: (cd workers/replay && cargo build --release) && node --import tsx scripts/check-replay-worker.ts [count] */
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { fixtureDecision, playHand, type HandResult } from '../src/engine/hand';
import { actionLog, rankEntrants } from '../src/engine/ranking';
import { configHash, configJson, handSeed, newSeed, rulesHash, rulesJson } from '../src/server/arena/commitments';

const BIN = new URL('../workers/replay/target/release/holecard-replay', import.meta.url).pathname;
const runWorker = (input: unknown) => JSON.parse(execFileSync(BIN, { input: JSON.stringify(input) }).toString());
const STRATEGIES = ['Aggressive', 'Conservative', 'Balanced', 'Bluff Heavy', 'Mathematical', 'Adaptive'];
const count = Number(process.argv[2] || 150);
let passed = 0,
  tamperRejected = 0,
  totalHands = 0;

for (let n = 0; n < count; n++) {
  const id = randomUUID(),
    size = 2 + (n % 8),
    places = Math.min(size, 1 + (n % 3)),
    startingStack = [300, 1000, 1500][n % 3];
  const agents = Array.from({ length: size }, (_, i) => ({
    id: randomUUID(),
    owner: `owner${i}.testnet`,
    nearAccount: `a${i}-${n}.arena.testnet`,
    name: `AGENT ${i}`,
    strategy: STRATEGIES[(n + i) % STRATEGIES.length],
    model: 'fixture-policy',
    description: i % 2 ? 'Says "hi" — ünïcode' : '',
  }));
  const rules = {
    id,
    entryYocto: '500000000000000000000000',
    startingStack,
    capacity: size,
    durationSeconds: 600,
    shares: [10000],
  };
  const { seed } = newSeed();
  const vrf = n % 4 ? randomBytes(32).toString('hex') : null;
  const stacks: Record<string, number> = Object.fromEntries(agents.map(a => [a.id, startingStack]));
  const history: HandResult[] = [];
  const maxHands = 5 + ((n * 37) % 120);
  for (let h = 1; h <= maxHands; h++) {
    const seats = agents
      .map(a => a.id)
      .sort()
      .filter(a => stacks[a] > 0)
      .map(a => {
        const g = agents.find(x => x.id === a)!;
        return { id: a, name: g.name, stack: stacks[a], strategy: g.strategy, model: g.model };
      });
    if (seats.length < 2) break;
    const level = Math.floor((h - 1) / 10) + 1;
    const hand = await playHand({
      seed: handSeed(seed, id, h, vrf),
      handNumber: h,
      seats,
      button: (h - 1) % seats.length,
      smallBlind: Math.min(10000, 10 * level),
      bigBlind: Math.min(20000, 20 * level),
      provider: fixtureDecision,
    });
    for (const p of hand.players) stacks[p.id] = p.stack;
    history.push(hand);
  }
  totalHands += history.length;
  const ranking = rankEntrants(Object.fromEntries(agents.map(a => [a.id, startingStack])), history);
  const accountOf = new Map(agents.map(a => [a.id, a.nearAccount]));
  const input = {
    tournament_id: id,
    seed_hex: seed,
    vrf_hex: vrf,
    rules_hash: rulesHash(rules),
    rules: rulesJson(rules),
    roster: agents.map(a => ({ agent: a.nearAccount, config_hash: configHash(a) })),
    entered: agents.map(a => a.nearAccount),
    configs: agents.map(configJson),
    hands: actionLog(history),
    places,
  };
  if (process.env.DUMP_INPUT && n === 0)
    (await import('node:fs')).writeFileSync(process.env.DUMP_INPUT, JSON.stringify(input));
  const out = runWorker(input);
  const expected = ranking.slice(0, places).map(r => accountOf.get(r));
  const stacksMatch = agents.every(a => out.stacks?.[a.nearAccount] === stacks[a.id]);
  if (!out.ok || JSON.stringify(out.ranking) !== JSON.stringify(expected) || !stacksMatch) {
    console.error('MISMATCH', { n, error: out.error, got: out.ranking, expected, hands: history.length });
    process.exit(1);
  }
  passed++;
  // Tamper: flip one non-trivial action. The worker must reject the log or produce a different result.
  const lines = [...input.hands];
  const k = lines.findIndex(l => /\b[kc]\b/.test(l));
  if (k >= 0) {
    lines[k] = lines[k].replace(/\b([kc])\b/, m => (m === 'k' ? 'f' : 'f'));
    const bad = runWorker({ ...input, hands: lines });
    if (
      !bad.ok ||
      JSON.stringify(bad.ranking) !== JSON.stringify(out.ranking) ||
      JSON.stringify(bad.stacks) !== JSON.stringify(out.stacks)
    )
      tamperRejected++;
  }
}
console.log(JSON.stringify({ tournaments: passed, hands: totalHands, tamperedLogsDetected: tamperRejected }));
