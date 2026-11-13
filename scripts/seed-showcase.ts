/** Seed one real 4-seat tournament on production: an example player agent (AGENT_NAME, default NIGHTOWL) vs the 3 house agents.
 * Usage (from repo root): ARENA_URL=https://holecard.up.railway.app ARENA_ORIGIN=https://holecard.fun \
 *   node --import tsx scripts/seed-showcase.ts */
import { KeyPair } from 'near-api-js';
import { nep413Hash } from '../src/server/near/chain';

const BASE = process.env.ARENA_URL!;
const ORIGIN = process.env.ARENA_ORIGIN || BASE;
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
async function req<T>(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: init.method || 'GET',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...(init.cookie ? { cookie: init.cookie } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`${path}: ${d.error || r.status}`);
  const cookie = r.headers.get('set-cookie');
  return (cookie && !Array.isArray(d) ? Object.assign(d, { __cookie: cookie }) : d) as T;
}
const sleep = (ms: number) => new Promise(f => setTimeout(f, ms));

const kp = KeyPair.fromRandom('ed25519');
const accountId = Buffer.from(kp.getPublicKey().data).toString('hex');
const c = await req<{ message: string; recipient: string; nonce: string }>('/api/auth/challenge', {
  method: 'POST',
  body: {},
});
const signature = Buffer.from(
  kp.sign(nep413Hash({ message: c.message, recipient: c.recipient, nonce: Buffer.from(c.nonce, 'base64') })).signature,
).toString('base64');
const v = await req<{ __cookie: string }>('/api/auth/verify', {
  method: 'POST',
  body: { accountId, publicKey: kp.getPublicKey().toString(), signature, nonce: c.nonce },
});
const cookie = v.__cookie.split(';')[0];
log('signed in', accountId.slice(0, 10));

const { models } = await req<{ models: string[] }>('/api/config');
const agent = await req<{ id: string; nearAccount: string; state: string }>('/api/agents', {
  method: 'POST',
  cookie,
  body: {
    name: process.env.AGENT_NAME || 'NIGHTOWL',
    strategy: 'Mathematical',
    model: models.find(m => /glm/i.test(m)) || models[0],
    description: 'Calls exactly when the pot odds pay for it, and no wider.',
  },
});
log('agent', agent.nearAccount, agent.state);
const s = await req<{ explorer: string }>(`/api/agents/${agent.id}/sponsor`, { method: 'POST', cookie, body: {} });
log('starter stake', s.explorer);

const t = await req<{ id: string }>('/api/tournaments', {
  method: 'POST',
  cookie,
  body: {
    name: 'Opening Night',
    entryNear: '0.5',
    capacity: 4,
    durationSeconds: 420,
    startingStack: 1000,
    shares: [7000, 3000],
  },
});
await req(`/api/tournaments/${t.id}/reserve`, { method: 'POST', cookie, body: { agentId: agent.id } });
await req(`/api/tournaments/${t.id}/fill-house`, { method: 'POST', cookie, body: {} });
const launch = await req<{ state: string; explorer?: string }>(`/api/tournaments/${t.id}/launch`, {
  method: 'POST',
  cookie,
});
log('launched', t.id, launch.state, launch.explorer);

let last = '';
for (let i = 0; i < 240; i++) {
  const st = await req<{ state: string; handNumber: number; entries: { state: string }[] }>(`/api/tournaments/${t.id}`);
  const line = `${st.state} hands=${st.handNumber} entries=${st.entries.map(e => e.state).join(',')}`;
  if (line !== last) log((last = line));
  if (st.state === 'settled' || st.state === 'cancelled') break;
  await sleep(5000);
}
const ops = await req<{ method: string; state: string; explorer: string | null; error: string | null }[]>(
  `/api/tournaments/${t.id}/operations`,
);
for (const o of ops) log('tx', o.method, o.state, o.explorer || o.error || '');
log('done', `${ORIGIN}/#/arenas/${t.id}`);
