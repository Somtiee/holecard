import { randomUUID } from 'node:crypto';
import { ELO_START, eloRatings } from './rating';
import { fixtureDecision, playHand, type DecisionContext, type HandDecision, type PublicTurn } from '../../engine/hand';
import { replayMatches } from './verification';
import {
  accessKeys,
  accountBalance,
  accountUrl,
  agentCall,
  contractId,
  formatNear,
  nearConfigured,
  newAgentKey,
  operatorCall,
  parseNear,
  txUrl,
  view,
} from '../near/chain';
import { allowedModels, nearAiConfigured, nearAiDecision, verifyReceipt, type TeeReceipt } from '../near/nearai';
import { pool, withTx } from '../db';
import { configHash, handSeed, newSeed, resultCommitment, rosterHash, rulesHash, seedMatches } from './commitments';
import { publicAgent, publicTournament, type AgentRow, type EntryRow, type TournamentRow } from '../types';

type ChainAgent = {
  owner: string;
  balance: string;
  created_at_ms: number;
  tournaments: number;
  wins: number;
  winnings: string;
};
type ChainTournament = {
  id: string;
  state: 'Registration' | 'Running' | 'Finalized' | 'Cancelled';
  entered: string[];
  roster_hash: string;
  seed_commitment: string;
  entry_fee: string;
  registration_deadline_ms: number;
  duration_ms: number;
  grace_ms: number;
  started_at_ms: number;
  prize_pool: string;
  result_hash: string | null;
  replay_hash: string | null;
  revealed_seed: string | null;
  payouts: { agent: string; amount: string }[];
  randomness: { status: string; output_hex: string | null; alpha: string | null; signature_hex: string | null } | null;
};
const GRACE_MS = 60 * 60_000,
  REGISTRATION_MS = 15 * 60_000;
/** Without a NEAR AI key the arena can still be run locally with the deterministic fixture policy (clearly labelled). */
const fixtureMode = () => process.env.ARENA_DECISION_POLICY === 'fixture';
export const decisionMode = () => (fixtureMode() ? 'fixture' : 'near-ai-cloud');

type ChainConfig = {
  randomness_source: { outlayer: string; project_id: string; vrf_pubkey_hex: string } | null;
  agent_seed: string;
  operator_funds_agents?: boolean;
};
let configCache: { at: number; value: ChainConfig } | null = null;
export async function chainConfig() {
  if (!configCache || Date.now() - configCache.at > 60_000)
    configCache = { at: Date.now(), value: await view<ChainConfig>('get_config') };
  return configCache.value;
}
const VRF_FEE = 50_000_000_000_000_000_000_000n,
  VRF_GAS = 300_000_000_000_000n;
/** Returns the verified VRF output, null while it is pending, or undefined when no source is configured. */
async function deckEntropy(t: TournamentRow, chain?: ChainTournament | null): Promise<string | null | undefined> {
  if (!(await chainConfig()).randomness_source) return undefined;
  const c = chain || (await chainTournament(t.id));
  if (!c) return null;
  if (c.randomness?.status === 'verified') return c.randomness.output_hex;
  if (!c.randomness)
    await chainOp(
      `vrf:${t.id}:${Math.floor(Date.now() / 120_000)}`,
      { kind: 'randomness', tournamentId: t.id, signer: 'operator', method: 'request_randomness' },
      () => operatorCall('request_randomness', { tournament_id: t.id }, VRF_FEE, VRF_GAS),
    ).catch(error => console.error('VRF request failed', (error as Error).message));
  return null;
}
export const chainAgent = (account: string) => view<ChainAgent | null>('get_agent', { agent: account });
export const chainTournament = (id: string) => view<ChainTournament | null>('get_tournament', { id });

/** Idempotent transaction journal. The contract is the source of truth; callers check chain state first. */
async function chainOp(
  key: string,
  meta: { kind: string; tournamentId?: string; agentId?: string; signer: string; method: string },
  send: () => Promise<{ txHash: string; value: unknown }>,
) {
  const existing = (
    await pool.query<{ state: string; tx_hash: string | null; updated_at: Date }>(
      'SELECT state,tx_hash,updated_at FROM chain_ops WHERE operation_key=$1',
      [key],
    )
  ).rows[0];
  if (existing?.state === 'confirmed') return { state: 'confirmed', txHash: existing.tx_hash, value: null as unknown };
  if (existing?.state === 'pending' && Date.now() - existing.updated_at.getTime() < 120_000)
    return { state: 'pending', txHash: null, value: null as unknown };
  await pool.query(
    `INSERT INTO chain_ops(operation_key,kind,tournament_id,agent_id,signer,method) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(operation_key) DO UPDATE SET state='pending',error=NULL,updated_at=now()`,
    [key, meta.kind, meta.tournamentId || null, meta.agentId || null, meta.signer, meta.method],
  );
  try {
    const result = await send();
    await pool.query(`UPDATE chain_ops SET state='confirmed',tx_hash=$2,updated_at=now() WHERE operation_key=$1`, [
      key,
      result.txHash,
    ]);
    return { state: 'confirmed', txHash: result.txHash, value: result.value };
  } catch (error) {
    await pool.query(`UPDATE chain_ops SET state='failed',error=$2,updated_at=now() WHERE operation_key=$1`, [
      key,
      (error as Error).message.slice(0, 500),
    ]);
    throw error;
  }
}

export async function listAgents() {
  const r = await pool.query<AgentRow>('SELECT * FROM agents ORDER BY created_at DESC LIMIT 200');
  return r.rows.map(a => publicAgent(a));
}
export async function getAgent(id: string) {
  const r = await pool.query<AgentRow>('SELECT * FROM agents WHERE id=$1', [id]);
  return r.rows[0] || null;
}
/** List view: only the last hand is needed, so the full history never leaves Postgres, and entries come from one query. */
const LIST_COLUMNS = `id,creator,name,entry_yocto,starting_stack,capacity,duration_seconds,shares,state,seed_commitment,rules_hash,roster_hash,closes_at,started_at,ended_at,
  hand_number,button,blind_level,stacks,ranking,winner_id,result_hash,replay_hash,payouts,created_at,
  CASE WHEN jsonb_array_length(history)>0 THEN jsonb_build_array(history->-1) ELSE '[]'::jsonb END AS history`;
export async function listTournaments() {
  const rows = (
    await pool.query<TournamentRow>(`SELECT ${LIST_COLUMNS} FROM tournaments ORDER BY created_at DESC LIMIT 100`)
  ).rows;
  if (!rows.length) return [];
  const entries = (
    await pool.query<{ tournament_id: string; agent_id: string; state: string; near_account: string }>(
      'SELECT e.tournament_id,e.agent_id,e.state,a.near_account FROM entries e JOIN agents a ON a.id=e.agent_id WHERE e.tournament_id=ANY($1::uuid[]) ORDER BY e.agent_id',
      [rows.map(t => t.id)],
    )
  ).rows;
  const byTournament = new Map<string, typeof entries>();
  for (const e of entries) {
    const list = byTournament.get(e.tournament_id);
    if (list) list.push(e);
    else byTournament.set(e.tournament_id, [e]);
  }
  return rows.map(t => publicTournament(t, byTournament.get(t.id) || []));
}
export async function getTournament(id: string) {
  const t = (await pool.query<TournamentRow>('SELECT * FROM tournaments WHERE id=$1', [id])).rows[0];
  if (!t) return null;
  const entries = (
    await pool.query<EntryRow>(
      `SELECT e.*,a.near_account,a.server_key_sealed,a.name,a.strategy,a.model,a.description FROM entries e JOIN agents a ON a.id=e.agent_id WHERE e.tournament_id=$1 ORDER BY a.created_at`,
      [id],
    )
  ).rows;
  return { row: t, entries, public: publicTournament(t, entries) };
}

// ---------- agents ----------

const slugFor = (name: string) => name.toLowerCase().replace(/[ ]+/g, '-');
export async function createAgent(owner: string, ownerPublicKey: string, input: Record<string, unknown>) {
  if (!nearConfigured()) throw new Error('NEAR arena contract is not configured');
  const name = String(input.name || '')
      .trim()
      .toUpperCase(),
    strategy = String(input.strategy || '').trim(),
    model = String(input.model || '').trim(),
    description = String(input.description || '').trim();
  if (!/^[A-Z0-9]([A-Z0-9 _-]{0,18}[A-Z0-9])$/.test(name) || /[ _-]{2}/.test(name))
    throw new Error('Agent name must be 2–20 letters or numbers, with single spaces, underscores or hyphens inside');
  if (
    !['Aggressive', 'Conservative', 'Balanced', 'Bluff Heavy', 'Mathematical', 'Adaptive', 'Custom'].includes(strategy)
  )
    throw new Error('Choose a supported strategy');
  if (!fixtureMode() && !allowedModels().includes(model))
    throw new Error('Selected model is not on the NEAR AI Cloud allowlist');
  if (description.length > 500) throw new Error('Strategy description is too long');
  if (!ownerPublicKey.startsWith('ed25519:'))
    throw new Error('Sign in with an ed25519 NEAR key to own an agent account');
  const owned = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM agents WHERE owner=$1', [owner]);
  if (Number(owned.rows[0].n) >= 5) throw new Error('Each creator can register up to five agents');
  // Every new agent account is seeded with NEAR from the arena contract, and implicit-account sign-ins are free to mint,
  // so cap arena-wide creation per hour as well as per owner.
  const recent = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM agents WHERE created_at>now()-interval '1 hour'`,
  );
  if (Number(recent.rows[0].n) >= Number(process.env.AGENT_CREATE_HOURLY_CAP || 30))
    throw new Error('Agent registration is at its hourly limit. Try again later.');
  const id = randomUUID(),
    account = `${slugFor(name)}.${contractId()}`;
  if (account.length > 64) throw new Error('Agent name is too long for a NEAR sub-account');
  const key = newAgentKey(account);
  await pool.query(
    `INSERT INTO agents(id,owner,name,strategy,model,description,near_account,server_public_key,server_key_sealed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      owner,
      name,
      strategy,
      fixtureMode() ? model || 'fixture-policy' : model,
      description,
      account,
      key.publicKey,
      key.sealed,
    ],
  );
  return provisionAgent(id, owner, ownerPublicKey);
}

/** Creates `<name>.<arena>` onchain: owner's wallet key = full access, server key = enter/withdraw only. */
export async function provisionAgent(id: string, owner: string, ownerPublicKey: string) {
  const agent = await getAgent(id);
  if (!agent || agent.owner !== owner) throw new Error('Agent not found for this owner');
  if (agent.state === 'active') return publicAgent(agent);
  if (await chainAgent(agent.near_account)) {
    await pool.query(`UPDATE agents SET state='active' WHERE id=$1`, [id]);
    return publicAgent((await getAgent(id))!);
  }
  // Contracts that report `operator_funds_agents` require the operator to attach the agent seed (so escrowed arena
  // balances never pay for new accounts). Read fresh: agent creation is rare and must match the deployed code.
  const config = await view<ChainConfig>('get_config');
  const seed = config.operator_funds_agents ? BigInt(config.agent_seed) : 0n;
  const result = await chainOp(
    `create-agent:${id}`,
    { kind: 'create_agent', agentId: id, signer: 'operator', method: 'create_agent' },
    () =>
      operatorCall(
        'create_agent',
        {
          name: agent.near_account.split('.')[0],
          owner,
          owner_public_key: ownerPublicKey,
          server_public_key: agent.server_public_key,
        },
        seed,
      ),
  );
  const registered = result.state === 'confirmed' && (await chainAgent(agent.near_account));
  await pool.query(`UPDATE agents SET state=$2,create_tx=COALESCE($3,create_tx) WHERE id=$1`, [
    id,
    registered ? 'active' : result.state === 'pending' ? 'creating' : 'failed',
    result.txHash,
  ]);
  return publicAgent((await getAgent(id))!);
}

export async function agentWallet(id: string) {
  const agent = await getAgent(id);
  if (!agent) return null;
  const [chain, balance, keys, trophies] = await Promise.all([
    chainAgent(agent.near_account).catch(() => null),
    accountBalance(agent.near_account).catch(() => null),
    accessKeys(agent.near_account).catch(() => []),
    view<[string, string][]>('mt_tokens_for_owner', { account_id: agent.near_account }).catch(() => []),
  ]);
  return {
    agentId: id,
    nearAccount: agent.near_account,
    explorer: accountUrl(agent.near_account),
    contractId: contractId(),
    arenaBalanceYocto: chain?.balance ?? '0',
    arenaBalanceNear: formatNear(chain?.balance ?? '0'),
    accountBalanceNear: balance ? formatNear(balance) : null,
    onchainRecord: chain,
    accessKeys: keys.map(k => ({
      ...k,
      role:
        k.publicKey === agent.server_public_key
          ? 'arena server (restricted)'
          : k.permission === 'FullAccess'
            ? 'owner wallet (full access)'
            : 'other',
    })),
    trophies: trophies.map(([tokenId, balance]) => ({ tokenId, balance })),
    createTx: agent.create_tx ? txUrl(agent.create_tx) : null,
  };
}

// ---------- tournaments ----------

export async function createTournament(owner: string, input: Record<string, unknown>) {
  const name = String(input.name || '').trim(),
    entry = parseNear(input.entryNear);
  const capacity = Number(input.capacity),
    duration = Number(input.durationSeconds),
    stack = Number(input.startingStack),
    shares = input.shares;
  if (
    name.length < 3 ||
    name.length > 60 ||
    !Number.isSafeInteger(capacity) ||
    capacity < 2 ||
    capacity > 9 ||
    !Number.isSafeInteger(duration) ||
    duration < 300 ||
    duration > 86400 ||
    !Number.isSafeInteger(stack) ||
    stack < 100 ||
    stack > 1000000
  )
    throw new Error('Invalid tournament settings');
  if (
    !Array.isArray(shares) ||
    shares.length < 1 ||
    shares.length > capacity ||
    shares.some(n => !Number.isInteger(n) || n <= 0) ||
    shares.reduce((a, b) => a + b, 0) !== 10000
  )
    throw new Error('Prize shares must total 10000 basis points');
  const active = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM tournaments WHERE creator=$1 AND state NOT IN ('settled','cancelled')`,
    [owner],
  );
  if (Number(active.rows[0].n) >= 3) throw new Error('Finish an active tournament before creating another');
  const id = randomUUID(),
    seed = newSeed();
  await pool.query(
    `INSERT INTO tournaments(id,creator,name,entry_yocto,starting_stack,capacity,duration_seconds,shares,state,seed_secret,seed_commitment)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'draft',$9,$10)`,
    [id, owner, name, entry.toString(), stack, capacity, duration, JSON.stringify(shares), seed.seed, seed.commitment],
  );
  return (await getTournament(id))!.public;
}

export async function reserveSeat(owner: string, tournamentId: string, agentId: string) {
  await withTx(async client => {
    const t = (await client.query<TournamentRow>('SELECT * FROM tournaments WHERE id=$1 FOR UPDATE', [tournamentId]))
      .rows[0];
    if (!t || t.state !== 'draft') throw new Error('Roster is closed');
    const agent = (await client.query<AgentRow>('SELECT * FROM agents WHERE id=$1', [agentId])).rows[0];
    if (!agent || agent.owner !== owner || agent.state !== 'active')
      throw new Error('An active NEAR agent account owned by you is required');
    const count = await client.query<{ n: string }>('SELECT count(*)::text AS n FROM entries WHERE tournament_id=$1', [
      tournamentId,
    ]);
    if (Number(count.rows[0].n) >= t.capacity) throw new Error('Roster is full');
    await client.query('INSERT INTO entries(tournament_id,agent_id,owner,config_hash) VALUES($1,$2,$3,$4)', [
      tournamentId,
      agentId,
      owner,
      configHash({
        id: agent.id,
        owner: agent.owner,
        nearAccount: agent.near_account,
        name: agent.name,
        strategy: agent.strategy,
        model: agent.model,
        description: agent.description,
      }),
    ]);
  });
  return (await getTournament(tournamentId))!.public;
}

/** Freezes roster, rules and seed commitment into the NEAR contract. Registration then runs 15 minutes. */
export async function launchTournament(owner: string, id: string) {
  if (!nearConfigured()) throw new Error('NEAR arena contract is not configured');
  if (!fixtureMode() && !nearAiConfigured()) throw new Error('NEAR AI Cloud is not configured');
  const data = await getTournament(id);
  const t = data?.row;
  if (!t || t.creator !== owner || t.state !== 'draft') throw new Error('Only the creator can launch an open draft');
  if (data.entries.length !== t.capacity)
    throw new Error('Fill all roster seats before locking the tournament onchain');
  const roster = data.entries.map(e => ({ agent: e.near_account, config_hash: e.config_hash }));
  const rules = rulesHash({
    id,
    entryYocto: t.entry_yocto,
    startingStack: t.starting_stack,
    capacity: t.capacity,
    durationSeconds: t.duration_seconds,
    shares: t.shares,
  });
  const localRoster = rosterHash(roster);
  await pool.query(
    `UPDATE tournaments SET state='launching',rules_hash=$2,roster_hash=$3 WHERE id=$1 AND state='draft'`,
    [id, rules, localRoster],
  );
  try {
    const result = await chainOp(
      `create-tournament:${id}`,
      { kind: 'create_tournament', tournamentId: id, signer: 'operator', method: 'create_tournament' },
      () =>
        operatorCall('create_tournament', {
          id,
          rules_hash: rules,
          seed_commitment: t.seed_commitment,
          entry_fee: t.entry_yocto,
          roster,
          shares: t.shares,
          registration_ms: REGISTRATION_MS,
          duration_ms: t.duration_seconds * 1000,
          grace_ms: GRACE_MS,
        }),
    );
    const chain = await chainTournament(id);
    if (!chain) return { state: result.state, txHash: result.txHash };
    if (chain.roster_hash !== localRoster) throw new Error('Onchain roster commitment differs from the local roster');
    await pool.query(`UPDATE tournaments SET state='funding',closes_at=$2 WHERE id=$1`, [
      id,
      new Date(chain.registration_deadline_ms),
    ]);
    return { state: 'funding', txHash: result.txHash, explorer: result.txHash ? txUrl(result.txHash) : null };
  } catch (error) {
    if (!(await chainTournament(id).catch(() => null)))
      await pool.query(`UPDATE tournaments SET state='draft' WHERE id=$1 AND state='launching'`, [id]);
    throw error;
  }
}

/** The agent's restricted key signs `enter`; the fee comes from its arena balance. No wallet popup. */
export async function submitEntry(owner: string | null, id: string, agentId: string) {
  const data = await getTournament(id);
  if (!data || data.row.state !== 'funding') throw new Error('Registration is not open');
  const e = data.entries.find(x => x.agent_id === agentId && (owner === null || x.owner === owner));
  if (!e) throw new Error('This agent is not in your reserved roster');
  if (e.state === 'entered') return { state: 'entered' };
  const chain = await chainTournament(id);
  if (chain?.entered.includes(e.near_account)) {
    await pool.query(`UPDATE entries SET state='entered' WHERE tournament_id=$1 AND agent_id=$2`, [id, agentId]);
    return { state: 'entered' };
  }
  const agent = await chainAgent(e.near_account);
  if (!agent || BigInt(agent.balance) < BigInt(data.row.entry_yocto))
    throw new Error(`Deposit at least ${formatNear(data.row.entry_yocto)} NEAR to this agent's arena balance first`);
  const result = await chainOp(
    `enter:${id}:${agentId}`,
    { kind: 'enter', tournamentId: id, agentId, signer: e.near_account, method: 'enter' },
    () => agentCall(e.near_account, e.server_key_sealed, 'enter', { tournament_id: id }),
  );
  if (result.state === 'confirmed')
    await pool.query(`UPDATE entries SET state='entered' WHERE tournament_id=$1 AND agent_id=$2`, [id, agentId]);
  return { state: result.state, txHash: result.txHash, explorer: result.txHash ? txUrl(result.txHash) : null };
}

async function syncFunding(t: TournamentRow) {
  const chain = await chainTournament(t.id);
  if (!chain) return;
  const entries = (
    await pool.query<EntryRow>(
      `SELECT e.*,a.near_account FROM entries e JOIN agents a ON a.id=e.agent_id WHERE e.tournament_id=$1`,
      [t.id],
    )
  ).rows;
  for (const e of entries) {
    if (chain.entered.includes(e.near_account) && e.state !== 'entered')
      await pool.query(`UPDATE entries SET state='entered' WHERE tournament_id=$1 AND agent_id=$2`, [t.id, e.agent_id]);
    // Auto-enter as soon as an owner's deposit covers the fee.
    else if (
      !chain.entered.includes(e.near_account) &&
      chain.state === 'Registration' &&
      Date.now() < chain.registration_deadline_ms
    ) {
      const agent = await chainAgent(e.near_account).catch(() => null);
      if (agent && BigInt(agent.balance) >= BigInt(t.entry_yocto))
        await submitEntry(null, t.id, e.agent_id).catch(error =>
          console.error('Auto-entry failed', e.near_account, (error as Error).message),
        );
    }
  }
  const fresh = (await chainTournament(t.id))!;
  if (fresh.state === 'Running') return markRunning(t, fresh);
  if (fresh.state === 'Cancelled') {
    await pool.query(`UPDATE tournaments SET state='cancelled',ended_at=now() WHERE id=$1`, [t.id]);
    return;
  }
  if (Date.now() < fresh.registration_deadline_ms) return;
  const enough = fresh.entered.length >= Math.max(2, t.shares.length);
  await chainOp(
    `${enough ? 'start' : 'cancel'}:${t.id}`,
    { kind: enough ? 'start' : 'cancel', tournamentId: t.id, signer: 'operator', method: enough ? 'start' : 'cancel' },
    () => operatorCall(enough ? 'start' : 'cancel', { tournament_id: t.id }),
  );
  const after = (await chainTournament(t.id))!;
  if (after.state === 'Running') await markRunning(t, after);
  else if (after.state === 'Cancelled')
    await pool.query(`UPDATE tournaments SET state='cancelled',ended_at=now() WHERE id=$1`, [t.id]);
}
async function markRunning(t: TournamentRow, chain: ChainTournament) {
  const entries = (
    await pool.query<{ agent_id: string; near_account: string }>(
      `SELECT e.agent_id,a.near_account FROM entries e JOIN agents a ON a.id=e.agent_id WHERE e.tournament_id=$1 ORDER BY e.agent_id`,
      [t.id],
    )
  ).rows;
  const stacks = Object.fromEntries(
    entries.filter(e => chain.entered.includes(e.near_account)).map(e => [e.agent_id, t.starting_stack]),
  );
  await pool.query(`UPDATE entries SET state='entered' WHERE tournament_id=$1 AND agent_id=ANY($2::uuid[])`, [
    t.id,
    Object.keys(stacks),
  ]);
  await pool.query(
    `UPDATE tournaments SET state='running',started_at=$3,stacks=$2::jsonb WHERE id=$1 AND state='funding'`,
    [t.id, JSON.stringify(stacks), new Date(chain.started_at_ms)],
  );
}

async function finalize(t: TournamentRow) {
  const ranking =
    t.ranking ||
    Object.entries(t.stacks)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(x => x[0]);
  const accounts = new Map(
    (
      await pool.query<{ agent_id: string; near_account: string }>(
        `SELECT e.agent_id,a.near_account FROM entries e JOIN agents a ON a.id=e.agent_id WHERE e.tournament_id=$1 AND e.state='entered'`,
        [t.id],
      )
    ).rows.map(r => [r.agent_id, r.near_account]),
  );
  const ranked = ranking.map(id => accounts.get(id)).filter(Boolean) as string[];
  if (ranked.length < t.shares.length) throw new Error('Ranking has fewer paid entrants than prize places');
  const result = t.result_hash || resultCommitment({ tournamentId: t.id, ranking, stacks: t.stacks });
  const replay = t.replay_hash || resultCommitment({ tournamentId: t.id, history: t.history });
  await pool.query(
    `UPDATE tournaments SET state='finalizing',ranking=$2::jsonb,winner_id=$3,result_hash=$4,replay_hash=$5,ended_at=COALESCE(ended_at,now()) WHERE id=$1 AND state IN ('running','finalizing')`,
    [t.id, JSON.stringify(ranking), ranking[0], result, replay],
  );
  const chain = await chainTournament(t.id);
  if (chain?.state !== 'Finalized')
    await chainOp(
      `finalize:${t.id}`,
      { kind: 'finalize', tournamentId: t.id, signer: 'operator', method: 'finalize' },
      () =>
        operatorCall('finalize', {
          tournament_id: t.id,
          result_hash: result,
          replay_hash: replay,
          seed_reveal: t.seed_secret,
          ranking: ranked.slice(0, t.shares.length),
        }),
    );
  const done = await chainTournament(t.id);
  if (done?.state === 'Finalized')
    await pool.query(`UPDATE tournaments SET state='settled',payouts=$2::jsonb WHERE id=$1`, [
      t.id,
      JSON.stringify(done.payouts),
    ]);
}

async function runHand(
  t: TournamentRow,
  onAction?: (action: HandDecision, tournamentId: string) => void,
  onTurn?: (turn: PublicTurn, tournamentId: string) => void,
) {
  const client = await pool.connect();
  try {
    const lock = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [
      `hand:${t.id}`,
    ]);
    if (!lock.rows[0]?.locked) return;
    try {
      const latest = (await client.query<TournamentRow>('SELECT * FROM tournaments WHERE id=$1', [t.id])).rows[0];
      if (latest.state !== 'running') return;
      const seats = (
        await client.query<EntryRow>(
          `SELECT e.*,a.name,a.strategy,a.model,a.description FROM entries e JOIN agents a ON a.id=e.agent_id WHERE e.tournament_id=$1 AND e.state='entered' ORDER BY e.agent_id`,
          [t.id],
        )
      ).rows
        .filter(e => (latest.stacks[e.agent_id] || 0) > 0)
        .map(e => ({
          id: e.agent_id,
          name: e.name,
          stack: latest.stacks[e.agent_id],
          strategy: e.strategy,
          model: e.model,
          description: e.description,
        }));
      const entropy = await deckEntropy(latest);
      if (entropy === null) return; // wait for OutLayer to deliver verified randomness before dealing
      if (seats.length < 2 || Date.now() >= latest.started_at!.getTime() + latest.duration_seconds * 1000) {
        await finalize(latest);
        return;
      }
      const receipts: TeeReceipt[] = [];
      const provider = fixtureMode()
        ? fixtureDecision
        : (ctx: DecisionContext) => nearAiDecision(ctx, r => receipts.push(r));
      const handNumber = latest.hand_number + 1;
      const hand = await playHand({
        seed: handSeed(latest.seed_secret, latest.id, handNumber, entropy),
        handNumber,
        seats,
        button: latest.button % seats.length,
        smallBlind: Math.min(10000, 10 * latest.blind_level),
        bigBlind: Math.min(20000, 20 * latest.blind_level),
        timeoutMs: Math.min(30000, Math.max(1000, Number(process.env.AGENT_TIMEOUT_MS || 8000) || 8000)),
        provider,
        onTurn: turn => onTurn?.(turn, latest.id),
        onDecision: d => onAction?.(d, latest.id),
      });
      const stacks = { ...latest.stacks };
      for (const p of hand.players) stacks[p.id] = p.stack;
      await client.query(
        `UPDATE tournaments SET history=history||$2::jsonb,stacks=$3::jsonb,hand_number=hand_number+1,button=button+1,
        blind_level=CASE WHEN (hand_number+1)%10=0 THEN blind_level+1 ELSE blind_level END WHERE id=$1 AND hand_number=$4 AND state='running'`,
        [latest.id, JSON.stringify([hand]), JSON.stringify(stacks), latest.hand_number],
      );
      for (const r of receipts)
        await client.query(
          `INSERT INTO tee_receipts(tournament_id,hand_number,agent_id,model,chat_id,request_hash,response_hash) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [latest.id, handNumber, r.agentId, r.model, r.chatId, r.requestHash, r.responseHash],
        );
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`hand:${t.id}`]);
    }
  } finally {
    client.release();
  }
}

/** Checks a few pending TEE signatures per tick (signatures can lag the completion slightly). */
export async function verifyPendingReceipts() {
  if (!nearAiConfigured()) return;
  const rows = (
    await pool.query<{ id: string; model: string; chat_id: string; request_hash: string; response_hash: string }>(
      `SELECT id,model,chat_id,request_hash,response_hash FROM tee_receipts WHERE NOT verified AND (detail IS NULL OR detail='Signature not available yet') AND created_at>now()-interval '1 hour' ORDER BY id LIMIT 5`,
    )
  ).rows;
  for (const r of rows) {
    try {
      const v = await verifyReceipt(r);
      await pool.query('UPDATE tee_receipts SET verified=$2,signature_kind=$3,signer=$4,detail=$5 WHERE id=$1', [
        r.id,
        v.verified,
        v.kind,
        v.signer,
        v.detail,
      ]);
    } catch (error) {
      await pool.query('UPDATE tee_receipts SET detail=$2 WHERE id=$1', [
        r.id,
        `Check failed: ${(error as Error).message}`.slice(0, 300),
      ]);
    }
  }
}

export async function tickArena(
  onAction?: (action: HandDecision, tournamentId: string) => void,
  onTurn?: (turn: PublicTurn, tournamentId: string) => void,
) {
  if (!nearConfigured()) return;
  const rows = (
    await pool.query<TournamentRow>(
      `SELECT * FROM tournaments WHERE state IN ('launching','funding','running','finalizing') ORDER BY created_at`,
    )
  ).rows;
  for (const t of rows)
    try {
      if (t.state === 'launching') {
        const c = await chainTournament(t.id);
        if (c)
          await pool.query(`UPDATE tournaments SET state='funding',closes_at=$2 WHERE id=$1`, [
            t.id,
            new Date(c.registration_deadline_ms),
          ]);
        else
          await pool.query(
            `UPDATE tournaments SET state='draft' WHERE id=$1 AND state='launching' AND created_at<now()-interval '5 minutes'`,
            [t.id],
          );
        continue;
      }
      if (t.state === 'funding') {
        await syncFunding(t);
        continue;
      }
      const chain = await chainTournament(t.id);
      if (chain?.state === 'Cancelled') {
        await pool.query(`UPDATE tournaments SET state='cancelled',ended_at=now() WHERE id=$1`, [t.id]);
        continue;
      }
      if (chain?.state === 'Finalized') {
        await pool.query(`UPDATE tournaments SET state='settled',payouts=$2::jsonb WHERE id=$1`, [
          t.id,
          JSON.stringify(chain.payouts),
        ]);
        continue;
      }
      if (chain && Date.now() > chain.started_at_ms + chain.duration_ms + chain.grace_ms) {
        await chainOp(
          `cancel-expired:${t.id}`,
          { kind: 'cancel', tournamentId: t.id, signer: 'operator', method: 'cancel' },
          () => operatorCall('cancel', { tournament_id: t.id }),
        );
        continue;
      }
      if (t.state === 'running') await runHand(t, onAction, onTurn);
      else if (t.state === 'finalizing') await finalize(t);
    } catch (error) {
      console.error('Arena transition failed', t.id, (error as Error).message);
    }
  await verifyPendingReceipts().catch(error => console.error('TEE receipt check failed', (error as Error).message));
}

export async function operationHistory(tournamentId: string) {
  const r = await pool.query<{
    kind: string;
    agent_id: string | null;
    signer: string;
    method: string;
    state: string;
    tx_hash: string | null;
    error: string | null;
    created_at: Date;
  }>(
    `SELECT kind,agent_id,signer,method,state,tx_hash,error,created_at FROM chain_ops WHERE tournament_id=$1 ORDER BY created_at`,
    [tournamentId],
  );
  return r.rows.map(o => ({ ...o, explorer: o.tx_hash ? txUrl(o.tx_hash) : null }));
}
export async function teeReceipts(tournamentId: string) {
  const r = await pool.query(
    `SELECT r.hand_number,r.agent_id,a.name AS agent,r.model,r.chat_id,r.request_hash,r.response_hash,r.signature_kind,r.signer,r.verified,r.detail,r.created_at
    FROM tee_receipts r LEFT JOIN agents a ON a.id=r.agent_id WHERE r.tournament_id=$1 ORDER BY r.id DESC LIMIT 200`,
    [tournamentId],
  );
  return r.rows;
}
/** One recorded hand. Until settlement the per-hand deck seed is withheld: it would let anyone rebuild the deck and see folded hole cards. */
export async function replayHand(tournamentId: string, handNumber: number) {
  if (!Number.isSafeInteger(handNumber) || handNumber < 1) return null;
  const r = (
    await pool.query<{ state: string; hand: TournamentRow['history'][number] | null }>(
      `SELECT state,(SELECT h FROM jsonb_array_elements(history) h WHERE (h->>'handNumber')::int=$2 LIMIT 1) AS hand FROM tournaments WHERE id=$1`,
      [tournamentId, handNumber],
    )
  ).rows[0];
  if (!r?.hand) return null;
  return r.state === 'settled' ? r.hand : { ...r.hand, seed: undefined };
}

export async function verifyMatch(tournamentId: string) {
  const data = await getTournament(tournamentId);
  const t = data?.row;
  if (!t) return null;
  const chain = await chainTournament(t.id).catch(() => null);
  const vrf = chain?.randomness?.status === 'verified' ? chain.randomness.output_hex : undefined;
  const handChecks = await Promise.all(
    t.history.map(async h => ({
      handNumber: h.handNumber,
      valid: await replayMatches(h, {
        smallBlind: Math.min(10000, 10 * (Math.floor((h.handNumber - 1) / 10) + 1)),
        bigBlind: Math.min(20000, 20 * (Math.floor((h.handNumber - 1) / 10) + 1)),
      }),
      seedMatches: handSeed(t.seed_secret, t.id, h.handNumber, vrf) === h.seed,
    })),
  );
  const settled = t.state === 'settled';
  const receipts = (
    await pool.query<{ total: string; verified: string }>(
      `SELECT count(*)::text AS total,count(*) FILTER (WHERE verified)::text AS verified FROM tee_receipts WHERE tournament_id=$1`,
      [t.id],
    )
  ).rows[0];
  const roster = data.entries.length
    ? rosterHash(data.entries.map(e => ({ agent: e.near_account, config_hash: e.config_hash })))
    : null;
  return {
    tournamentId: t.id,
    contractId: contractId(),
    handChecks,
    engineReplayVerified: handChecks.length > 0 && handChecks.every(h => h.valid && h.seedMatches),
    seedCommitment: t.seed_commitment,
    seedReveal: settled ? t.seed_secret : null,
    seedCommitmentMatches: seedMatches(t.seed_secret, t.seed_commitment),
    onchain: chain
      ? {
          state: chain.state,
          rosterHashMatches: chain.roster_hash === roster,
          seedCommitmentMatches: chain.seed_commitment === t.seed_commitment,
          randomness: chain.randomness,
          resultHashMatches: settled ? chain.result_hash === t.result_hash : null,
          replayHashMatches: settled ? chain.replay_hash === t.replay_hash : null,
          revealedSeedMatches: settled ? chain.revealed_seed === t.seed_secret : null,
          payouts: chain.payouts,
        }
      : null,
    resultHash: t.result_hash,
    replayHash: t.replay_hash,
    decisionPolicy: decisionMode(),
    teeReceipts: { total: Number(receipts.total), verified: Number(receipts.verified) },
    trust:
      'Deck seeds mix the operator seed (committed onchain before entry) with the OutLayer VRF output when configured. The operator asserts the ranking. The NEAR contract enforces entrants, frozen shares, the seed reveal and exact payouts. Replay proves deterministic execution, not unbiased randomness.',
  };
}

type LeaderRow = {
  id: string;
  name: string;
  strategy: string;
  model: string;
  nearAccount: string;
  tournaments: number;
  wins: number;
  hands: number;
  profitYocto: string;
  profitNear: string;
  winningsNear: string;
  feesNear: string;
  roi: number;
  winRate: number;
  reputation: number;
  rating: number;
  rank: number;
};
let leaderCache: { at: number; value: Promise<LeaderRow[]> } | null = null;
/** Ranked by net NEAR profit from settled tournaments. Aggregated in SQL (hand counts included) and cached briefly:
 * every client polls it, and it only changes when a tournament settles. */
export function leaderboard(): Promise<LeaderRow[]> {
  if (leaderCache && Date.now() - leaderCache.at < 5_000) return leaderCache.value;
  const value = computeLeaderboard();
  leaderCache = { at: Date.now(), value };
  value.catch(() => {
    leaderCache = null;
  });
  return value;
}
async function computeLeaderboard(): Promise<LeaderRow[]> {
  const [agents, played, handCounts, finishes] = await Promise.all([
    pool.query<{ id: string; name: string; strategy: string; model: string; near_account: string }>(
      `SELECT id,name,strategy,model,near_account FROM agents WHERE state='active'`,
    ),
    pool.query<{
      agent_id: string;
      entry_yocto: string;
      winner_id: string | null;
      payouts: { agent: string; amount: string }[] | null;
    }>(
      `SELECT e.agent_id,t.entry_yocto::text AS entry_yocto,t.winner_id,t.payouts FROM entries e JOIN tournaments t ON t.id=e.tournament_id WHERE e.state='entered' AND t.state='settled'`,
    ),
    pool.query<{
      agent_id: string;
      hands: number;
    }>(`SELECT p->>'id' AS agent_id,count(*)::int AS hands FROM tournaments t
      CROSS JOIN LATERAL jsonb_array_elements(t.history) h CROSS JOIN LATERAL jsonb_array_elements(h->'players') p WHERE t.state='settled' GROUP BY 1`),
    pool.query<{ ranking: string[] }>(
      `SELECT ranking FROM tournaments WHERE state='settled' AND ranking IS NOT NULL ORDER BY ended_at,created_at`,
    ),
  ]);
  const ratings = eloRatings(finishes.rows.map(r => r.ranking));
  const byAgent = new Map<string, typeof played.rows>();
  for (const row of played.rows) {
    const list = byAgent.get(row.agent_id);
    if (list) list.push(row);
    else byAgent.set(row.agent_id, [row]);
  }
  const hands = new Map(handCounts.rows.map(r => [r.agent_id, r.hands]));
  const rows = agents.rows.map(a => {
    const games = byAgent.get(a.id) || [];
    const fees = games.reduce((s, t) => s + BigInt(t.entry_yocto), 0n);
    const winnings = games.reduce(
      (s, t) =>
        s + (t.payouts || []).filter(p => p.agent === a.near_account).reduce((n, p) => n + BigInt(p.amount), 0n),
      0n,
    );
    const profit = winnings - fees,
      wins = games.filter(t => t.winner_id === a.id).length;
    const roi = fees > 0n ? Number((profit * 10000n) / fees) / 100 : 0;
    return {
      id: a.id,
      name: a.name,
      strategy: a.strategy,
      model: a.model,
      nearAccount: a.near_account,
      tournaments: games.length,
      wins,
      hands: hands.get(a.id) || 0,
      profitYocto: profit.toString(),
      profitNear: (profit < 0n ? '-' : '') + formatNear(profit < 0n ? -profit : profit),
      winningsNear: formatNear(winnings),
      feesNear: formatNear(fees),
      roi,
      winRate: games.length ? wins / games.length : 0,
      reputation: Math.min(1000, wins * 100 + games.length * 5 + Math.max(0, Math.floor(roi))),
      rating: ratings.get(a.id) ?? ELO_START,
    };
  });
  rows.sort((a, b) =>
    BigInt(b.profitYocto) > BigInt(a.profitYocto)
      ? 1
      : BigInt(b.profitYocto) < BigInt(a.profitYocto)
        ? -1
        : b.wins - a.wins,
  );
  return rows.map((r, i) => ({ rank: i + 1, ...r }));
}

export async function agentAnalytics(agentId: string) {
  const agent = await getAgent(agentId);
  if (!agent) return null;
  const tournaments = (
    await pool.query<TournamentRow>(
      `SELECT t.* FROM tournaments t JOIN entries e ON e.tournament_id=t.id WHERE e.agent_id=$1 ORDER BY t.created_at`,
      [agentId],
    )
  ).rows;
  const tagged = tournaments.flatMap(t =>
    t.history.filter(h => h.players.some(p => p.id === agentId)).map(h => ({ h, tournamentId: t.id })),
  );
  const hands = tagged.map(x => x.h);
  const decisions = hands.flatMap(h => h.decisions.filter(d => d.agentId === agentId));
  const count = (action: string) => decisions.filter(d => d.action === action).length;
  const voluntary = hands.filter(h =>
    h.decisions.some(
      d => d.agentId === agentId && d.stage === 'preflop' && ['call', 'raise', 'all-in'].includes(d.action),
    ),
  ).length;
  const preflopRaises = hands.filter(h =>
    h.decisions.some(d => d.agentId === agentId && d.stage === 'preflop' && ['raise', 'all-in'].includes(d.action)),
  ).length;
  const showdowns = hands.filter(h => h.players.filter(p => !p.folded).length > 1);
  const wonShowdowns = showdowns.filter(h => h.winnerIds.includes(agentId)).length;
  const potsWon = hands.map(h => h.payouts[agentId] || 0);
  const bankroll = tagged.map(({ h, tournamentId }) => ({
    hand: h.handNumber,
    tournamentId,
    stack: h.players.find(p => p.id === agentId)?.stack || 0,
  }));
  const finished = tournaments
    .filter(t => t.state === 'settled')
    .map(t => ({
      tournamentId: t.id,
      name: t.name,
      finish: (t.ranking || []).indexOf(agentId) + 1,
      entrants: Object.keys(t.stacks).length,
    }));
  return {
    agentId,
    hands: hands.length,
    decisions: decisions.length,
    vpip: hands.length ? voluntary / hands.length : 0,
    pfr: hands.length ? preflopRaises / hands.length : 0,
    aggression: count('call') ? (count('raise') + count('all-in')) / count('call') : count('raise') + count('all-in'),
    averageDecisionMs: decisions.length
      ? Math.round(decisions.reduce((n, d) => n + d.latencyMs, 0) / decisions.length)
      : 0,
    averageBetChips: decisions.length ? Math.round(decisions.reduce((n, d) => n + d.amount, 0) / decisions.length) : 0,
    showdownWinRate: showdowns.length ? wonShowdowns / showdowns.length : 0,
    biggestPotChips: Math.max(0, ...potsWon),
    bankroll,
    finishes: finished,
    actionCounts: {
      raises: count('raise'),
      calls: count('call'),
      folds: count('fold'),
      checks: count('check'),
      allIns: count('all-in'),
    },
    note: 'VPIP and PFR are measured from recorded preflop actions.',
  };
}
