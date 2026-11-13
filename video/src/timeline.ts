/**
 * One timing file for pictures and sound. Frames at 30 fps; a bar (2 s at 120 BPM) is 60 frames and
 * every scene starts on a bar. Scene-local constants are used by the scene components, and the same
 * numbers build the sound-cue table that scripts/soundtrack.ts renders.
 */
export const BAR = 60;

export const SCENES = [
  { id: 'cover', bars: 3 },
  { id: 'hook', bars: 4 },
  { id: 'practice', bars: 7 },
  { id: 'signin', bars: 6 },
  { id: 'keys', bars: 7 },
  { id: 'fund', bars: 6 },
  { id: 'lock', bars: 6 },
  { id: 'shuffle', bars: 6 },
  { id: 'private', bars: 8 },
  { id: 'result', bars: 9 },
  { id: 'trophies', bars: 4 },
  { id: 'withdraw', bars: 3 },
  { id: 'stack', bars: 3 },
  { id: 'close', bars: 3 },
] as const;
export type SceneId = (typeof SCENES)[number]['id'];

export const START: Record<SceneId, number> = {} as Record<SceneId, number>;
export const LEN: Record<SceneId, number> = {} as Record<SceneId, number>;
{
  let f = 0;
  for (const s of SCENES) {
    START[s.id] = f;
    LEN[s.id] = s.bars * BAR;
    f += s.bars * BAR;
  }
}
export const MAIN_FRAMES = SCENES.reduce((n, s) => n + s.bars * BAR, 0);

/* ---------- scene-local timings ---------- */

export const T = {
  cover: { erode: 30, reform: 100, out: 160 },
  hook: { q: [60, 120, 180] as const, out: 225 },
  practice: {
    clickPractice: 32,
    setup: 45,
    typeName: 60,
    pickStrategy: 100,
    deal: 122,
    table: 135,
    d0: 150,
    step: 17,
    // result/flip time is computed from the hand's decision count in the scene
    results: 352,
    makeReal: 396,
  },
  signin: { click: 26, picker: 36, pickWallet: 112, sheet: 140, sign: 226, signed: 236, inset: 270 },
  keys: { model: 52, create: 96, page: 120, keysOn: 200, keyStep: 26, push: 262 },
  fund: { claim: 66, quotePick: 168, quote: 192, quoteShown: 204 },
  lock: { card: 0, page: 54, fill: 96, seatStep: 10, lock: 150, frozen: 165, txs: 236, txStep: 13 },
  shuffle: { request: 8, yieldAt: 26, tee: 44, back: 74, verify: 92, page: 126 },
  private: { d0: 18, step: 22, receipts: 120, rcStep: 7, nearPage: 236, verify: 266, attest: 282, attStep: 12 },
  result: { tee: 30, back: 76, page: 116, rows: 136, rowStep: 22, paid: 276, again: 330, again2: 342, tx: 420 },
  trophies: { rows: 12, rowStep: 12, modal: 116, unseal: 160 },
  withdraw: { click: 40, done: 60 },
  stack: { first: 12, step: 7.5 },
  close: {},
};

/* ---------- sound cues (global frames) ---------- */

export type Cue = { f: number; kind: 'deal' | 'chip' | 'seal' | 'key' | 'stamp' | 'coin' | 'pulse' | 'click' | 'whoosh' | 'type' };

export function cues(practiceDecisions: number, practiceChipAt: number[]): Cue[] {
  const out: Cue[] = [];
  const at = (scene: SceneId, f: number, kind: Cue['kind']) => out.push({ f: START[scene] + f, kind });
  // hook: one stamp per question
  T.hook.q.forEach(f => at('hook', f, 'stamp'));
  // practice
  const p = T.practice;
  at('practice', p.clickPractice, 'click');
  for (let i = 0; i < 8; i++) at('practice', p.typeName + i * 3, 'type');
  at('practice', p.pickStrategy, 'click');
  at('practice', p.deal, 'click');
  for (let i = 0; i < 8; i++) at('practice', p.table + 2 + i * 2, 'deal');
  for (let i = 0; i < practiceDecisions; i++) at('practice', p.d0 + i * p.step, practiceChipAt.includes(i) ? 'chip' : 'click');
  at('practice', p.d0 + practiceDecisions * p.step + 6, 'deal');
  at('practice', p.results, 'click');
  at('practice', p.makeReal, 'click');
  // sign in
  const s = T.signin;
  at('signin', s.click, 'click');
  at('signin', s.pickWallet, 'click');
  at('signin', s.sign, 'click');
  at('signin', s.signed, 'seal');
  at('signin', s.inset, 'whoosh');
  // keys
  const k = T.keys;
  at('keys', k.model, 'click');
  at('keys', k.create, 'click');
  at('keys', k.keysOn, 'key');
  at('keys', k.keysOn + k.keyStep, 'key');
  at('keys', k.push, 'whoosh');
  // fund
  at('fund', T.fund.claim, 'click');
  at('fund', T.fund.claim + 14, 'coin');
  at('fund', T.fund.quote, 'click');
  at('fund', T.fund.quoteShown, 'seal');
  // lock
  const l = T.lock;
  at('lock', l.fill, 'click');
  for (let i = 0; i < 3; i++) at('lock', l.fill + 8 + i * l.seatStep, 'chip');
  at('lock', l.lock, 'click');
  at('lock', l.frozen, 'stamp');
  for (let i = 0; i < 9; i++) at('lock', l.txs + i * l.txStep, 'key');
  // shuffle: low pulse for yield/resume
  const v = T.shuffle;
  at('shuffle', v.request, 'pulse');
  at('shuffle', v.yieldAt, 'pulse');
  at('shuffle', v.back, 'pulse');
  at('shuffle', v.verify, 'stamp');
  // private
  const pr = T.private;
  for (let i = 0; i < 5; i++) at('private', pr.d0 + i * pr.step, 'chip');
  for (let i = 0; i < 10; i++) at('private', pr.receipts + 10 + i * pr.rcStep, 'seal');
  at('private', pr.verify, 'click');
  for (let i = 0; i < 5; i++) at('private', pr.attest + i * pr.attStep, 'stamp');
  // result
  const r = T.result;
  at('result', 4, 'pulse');
  at('result', r.tee, 'pulse');
  at('result', r.back, 'pulse');
  for (let i = 0; i < 6; i++) at('result', r.rows + i * r.rowStep, 'stamp');
  at('result', r.paid, 'coin');
  at('result', r.paid + 10, 'coin');
  at('result', r.again, 'click');
  for (let i = 0; i < 6; i++) at('result', r.again2 + 8 + i * 6, 'stamp');
  at('result', r.tx, 'click');
  // trophies
  for (let i = 0; i < 3; i++) at('trophies', T.trophies.rows + i * T.trophies.rowStep, 'coin');
  at('trophies', T.trophies.unseal, 'seal');
  // withdraw
  at('withdraw', T.withdraw.click, 'click');
  at('withdraw', T.withdraw.done, 'coin');
  // stack: one key click per tag, on the beat
  for (let i = 0; i < 12; i++) at('stack', Math.round(T.stack.first + i * T.stack.step), 'key');
  return out.sort((a, b) => a.f - b.f);
}
