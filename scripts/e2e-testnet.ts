/** End-to-end testnet run against a live arena server: two throwaway players sign in with NEP-413
 * (implicit accounts), create agents onchain, claim the testnet starter stake, play a 2-seat tournament
 * and settle it. Usage: ARENA_URL=http://localhost:3000 node --import tsx scripts/e2e-testnet.ts */
import { randomBytes } from 'node:crypto';
import { KeyPair } from 'near-api-js';
import { nep413Hash } from '../src/server/near/chain';

const BASE = process.env.ARENA_URL || 'http://localhost:3000';
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
async function req<T>(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: init.method || 'GET',
    headers: { 'content-type': 'application/json', origin: BASE, ...(init.cookie ? { cookie: init.cookie } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`${path}: ${d.error || r.status}`);
  const cookie = r.headers.get('set-cookie');
  return (cookie && !Array.isArray(d) ? Object.assign(d, { __cookie: cookie }) : d) as T;
}
async function player() {
  const kp = KeyPair.fromRandom('ed25519');
  const accountId = Buffer.from(kp.getPublicKey().data).toString('hex');
  const c = await req<{ message: string; recipient: string; nonce: string }>('/api/auth/challenge', {
    method: 'POST',
    body: {},
  });
  const signature = Buffer.from(
    kp.sign(nep413Hash({ message: c.message, recipient: c.recipient, nonce: Buffer.from(c.nonce, 'base64') }))
      .signature,
  ).toString('base64');
  const v = await req<{ accountId: string; __cookie: string }>('/api/auth/verify', {
    method: 'POST',
    body: { accountId, publicKey: kp.getPublicKey().toString(), signature, nonce: c.nonce },
  });
  return { accountId, cookie: v.__cookie.split(';')[0] };
}
const sleep = (ms: number) => new Promise(f => setTimeout(f, ms));

const tag = randomBytes(2).toString('hex').toUpperCase();
const players = await Promise.all([player(), player()]);
log(
  'signed in',
  players.map(p => p.accountId.slice(0, 10)),
);
const agents = [];
for (const [i, p] of players.entries()) {
  const a = await req<{ id: string; nearAccount: string; state: string }>('/api/agents', {
    method: 'POST',
    cookie: p.cookie,
    body: {
      name: `E2E ${['ALPHA', 'BRAVO'][i]} ${tag}`,
      strategy: i ? 'Conservative' : 'Aggressive',
      model: 'fixture-policy',
      description: 'testnet e2e',
    },
  });
  log('agent', a.nearAccount, a.state);
  if (a.state !== 'active') throw new Error('agent not active');
  const s = await req<{ explorer: string }>(`/api/agents/${a.id}/sponsor`, {
    method: 'POST',
    cookie: p.cookie,
    body: {},
  });
  log('starter stake', s.explorer);
  agents.push(a);
}
const t = await req<{ id: string }>('/api/tournaments', {
  method: 'POST',
  cookie: players[0].cookie,
  body: {
    name: `E2E ${tag}`,
    entryNear: '0.5',
    capacity: 2,
    durationSeconds: 300,
    startingStack: 1000,
    shares: [10000],
  },
});
for (const [i, p] of players.entries())
  await req(`/api/tournaments/${t.id}/reserve`, { method: 'POST', cookie: p.cookie, body: { agentId: agents[i].id } });
const launch = await req<{ state: string; explorer?: string }>(`/api/tournaments/${t.id}/launch`, {
  method: 'POST',
  cookie: players[0].cookie,
});
log('launched', launch.state, launch.explorer);
let last = '';
for (let i = 0; i < 300; i++) {
  const s = await req<{ state: string; handNumber: number; entries: { state: string }[] }>(`/api/tournaments/${t.id}`);
  const line = `${s.state} hands=${s.handNumber} entries=${s.entries.map(e => e.state).join(',')}`;
  if (line !== last) {
    log(line);
    last = line;
  }
  if (s.state === 'settled' || s.state === 'cancelled') break;
  await sleep(5000);
}
const ops = await req<{ method: string; state: string; explorer: string | null; error: string | null }[]>(
  `/api/tournaments/${t.id}/operations`,
);
for (const o of ops) log('tx', o.method, o.state, o.explorer || o.error || '');
const verify = await req<Record<string, unknown>>(`/api/tournaments/${t.id}/verification`);
log(
  'verification',
  JSON.stringify({
    engineReplayVerified: verify.engineReplayVerified,
    seedCommitmentMatches: verify.seedCommitmentMatches,
    onchain: verify.onchain,
  }).slice(0, 900),
);
for (const a of agents) {
  const w = await req<{ arenaBalanceNear: string; trophies: unknown[]; accessKeys: { role: string }[] }>(
    `/api/agents/${a.id}/wallet`,
  );
  log(
    a.nearAccount,
    'balance',
    w.arenaBalanceNear,
    'trophies',
    JSON.stringify(w.trophies),
    'keys',
    w.accessKeys.map(k => k.role).join(' / '),
  );
}
