/** End-to-end testnet run against a live arena server: two throwaway players sign in with NEP-413
 * (implicit accounts), create agents onchain, claim the testnet starter stake, play a 2-seat tournament
 * and settle it. Usage: ARENA_URL=http://localhost:3000 node --import tsx scripts/e2e-testnet.ts */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Account, JsonRpcProvider, KeyPair, actions } from 'near-api-js';
import { nep413Hash } from '../src/server/near/chain';

const BASE = process.env.ARENA_URL || 'http://localhost:3000';
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
async function req<T>(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}): Promise<T> {
  const readOnly = !init.method || init.method === 'GET';
  let r: Response;
  for (let attempt = 0; ; attempt++) {
    try {
      r = await fetch(`${BASE}${path}`, {
        signal: AbortSignal.timeout(readOnly ? 15000 : 90000),
        method: init.method || 'GET',
        headers: { 'content-type': 'application/json', origin: BASE, ...(init.cookie ? { cookie: init.cookie } : {}) },
        body: init.body ? JSON.stringify(init.body) : undefined,
      });
      if (!readOnly || r.status < 500 || attempt >= 3) break;
      await r.body?.cancel();
    } catch (error) {
      if (!readOnly || attempt >= 3) throw error;
    }
    await sleep(1500 * (attempt + 1));
  }
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
  return { accountId, key: kp, cookie: v.__cookie.split(';')[0] };
}
const sleep = (ms: number) => new Promise(f => setTimeout(f, ms));

const { network, models, contractId, rpcUrl, explorer } = await req<{
  network: string;
  models: string[];
  contractId: string;
  rpcUrl: string;
  explorer: string;
}>('/api/config');
assert.equal(network, 'testnet');
assert.ok(models.length && !models.includes('fixture-policy'), 'NEAR AI model must be configured');

const tag = randomBytes(2).toString('hex').toUpperCase();
const players = await Promise.all([player(), player()]);
log(
  'signed in',
  players.map(p => p.accountId.slice(0, 10)),
);
// Use the arena's configured models (NEAR AI Cloud TEE models, or 'fixture-policy' in fixture mode).
log('models', models);
const agents = [];
for (const [i, p] of players.entries()) {
  let a = await req<{ id: string; nearAccount: string; state: string }>('/api/agents', {
    method: 'POST',
    cookie: p.cookie,
    body: {
      name: `E2E ${['ALPHA', 'BRAVO'][i]} ${tag}`,
      strategy: i ? 'Conservative' : 'Aggressive',
      model: models[i % models.length],
      description: 'testnet e2e',
    },
  });
  for (let retry = 0; a.state === 'creating' && retry < 10; retry++) {
    await sleep(3000);
    a = await req(`/api/agents/${a.id}/provision`, { method: 'POST', cookie: p.cookie, body: {} });
  }
  log('agent', a.nearAccount, a.state);
  if (a.state !== 'active') throw new Error('agent not active');
  const claim = () =>
    req<{ state: string; txHash: string; amountYocto: string; explorer: string }>(`/api/agents/${a.id}/sponsor`, {
      method: 'POST',
      cookie: p.cookie,
      body: {},
    });
  let stake = await claim();
  for (let retry = 0; stake.state === 'pending' && retry < 10; retry++) {
    await sleep(3000);
    stake = await claim();
  }
  assert.equal(stake.state, 'confirmed', 'Starter stake must confirm on NEAR');
  const repeated = await claim();
  assert.equal(repeated.txHash, stake.txHash, 'Repeated claim must reuse the original deposit');
  log('starter stake', stake.explorer);
  agents.push({ ...a, stakeYocto: stake.amountYocto });
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
log('launched', t.id, launch.state, launch.explorer);
let last = '';
let terminal: 'settled' | 'cancelled' | undefined;
for (let i = 0; i < 300; i++) {
  const s = await req<{ state: string; handNumber: number; entries: { state: string }[] }>(`/api/tournaments/${t.id}`);
  const line = `${s.state} hands=${s.handNumber} entries=${s.entries.map(e => e.state).join(',')}`;
  if (line !== last) {
    log(line);
    last = line;
  }
  if (s.state === 'settled' || s.state === 'cancelled') {
    terminal = s.state;
    break;
  }
  await sleep(5000);
}
assert.ok(terminal, 'Tournament did not settle or refund before timeout');
const ops = await req<{ method: string; state: string; explorer: string | null; error: string | null }[]>(
  `/api/tournaments/${t.id}/operations`,
);
for (const o of ops) log('tx', o.method, o.state, o.explorer || o.error || '');
if (terminal === 'cancelled') {
  const chain = await req<{ state: string; prize_pool: string; entered: string[]; payouts: unknown[] }>(
    `/api/tournaments/${t.id}/onchain`,
  );
  assert.equal(chain.state, 'Cancelled');
  assert.equal(chain.prize_pool, '0');
  assert.equal(chain.payouts.length, 0);
  assert.equal(chain.entered.length, agents.length);
  for (const a of agents) {
    const w = await req<{ arenaBalanceYocto: string }>(`/api/agents/${a.id}/wallet`);
    assert.equal(w.arenaBalanceYocto, a.stakeYocto, 'Entry fee must be restored in full');
  }
  assert.ok(
    ops.some(o => o.method === 'cancel' && o.state === 'confirmed'),
    'Cancellation must have a final transaction',
  );
  log('full refund confirmed', t.id);
  if (process.env.ALLOW_REFUND !== '1') throw new Error('Verified prize settlement unavailable');
  process.exit(0);
}
const verify = await req<{
  engineReplayVerified: boolean;
  seedCommitmentMatches: boolean;
  settlement: { verifiedByOutLayer: boolean };
  onchain: { state: string; replayHashMatches: boolean; payouts: { agent: string; amount: string }[] };
}>(`/api/tournaments/${t.id}/verification`);
log(
  'verification',
  JSON.stringify({
    engineReplayVerified: verify.engineReplayVerified,
    seedCommitmentMatches: verify.seedCommitmentMatches,
    onchain: verify.onchain,
  }).slice(0, 900),
);
assert.equal(verify.onchain?.state, 'Finalized');
assert.equal(verify.settlement.verifiedByOutLayer, true);
assert.equal(verify.engineReplayVerified, true);
assert.equal(verify.onchain.replayHashMatches, true);
assert.equal(
  verify.onchain.payouts.reduce((sum, p) => sum + BigInt(p.amount), 0n),
  10n ** 24n,
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

const winnerSeat = agents.findIndex(a => a.nearAccount === verify.onchain.payouts[0].agent);
assert.ok(winnerSeat >= 0, 'Winner must be an entered agent');
const winner = agents[winnerSeat];
const owner = players[winnerSeat];
const rpc = new JsonRpcProvider({ url: rpcUrl });
const currentBalance = async () => {
  const record = (await rpc.callFunction({
    contractId,
    method: 'get_agent',
    args: { agent: winner.nearAccount },
    blockQuery: { finality: 'final' },
  })) as { owner: string; balance: string };
  assert.equal(record.owner, owner.accountId);
  return BigInt(record.balance);
};
const beforeWithdrawal = await currentBalance();
const amount = 2n * 10n ** 22n;
const withdrawal = await new Account(winner.nearAccount, rpc, owner.key.toString()).signAndSendTransaction({
  receiverId: contractId,
  waitUntil: 'FINAL',
  actions: [
    actions.functionCall('withdraw', { agent: winner.nearAccount, amount: amount.toString() }, 50_000_000_000_000n, 0n),
  ],
});
assert.ok(typeof withdrawal.status === 'object' && 'SuccessValue' in withdrawal.status);
assert.equal(Buffer.from(withdrawal.status.SuccessValue, 'base64').toString(), 'true');
assert.equal(await currentBalance(), beforeWithdrawal - amount);
const recipient = await rpc.viewAccount({ accountId: owner.accountId, blockQuery: { finality: 'final' } });
assert.equal(BigInt(recipient.amount), amount);
log('withdrawal confirmed', `${explorer}/txns/${withdrawal.transaction_outcome.id}`);
