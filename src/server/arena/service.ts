import { randomUUID } from 'node:crypto';
import { ELO_START, eloRatings } from './rating';
import { fixtureDecision, playHand, type DecisionContext, type HandDecision, type PublicTurn } from '../../engine/hand';
import { replayMatches } from './verification';
import { actionLog, rankEntrants } from '../../engine/ranking';
import {
  accessKeys,
  accountBalance,
  accountUrl,
  prepareAgentCall,
  contractId,
  formatNear,
  nearConfigured,
  newAgentKey,
  prepareOperatorCall,
  parseNear,
  provider,
  txUrl,
  view,
} from '../near/chain';
import { allowedModels, nearAiConfigured, nearAiDecision, verifyReceipt, type TeeReceipt } from '../near/nearai';
import { pool, withTx } from '../db';
import { chainOp, reconcileOperation } from '../near/journal';
import { ensureHouseAgents } from './house';
import {
  configHash,
  configJson,
  handSeed,
  newSeed,
  resultCommitment,
  rosterHash,
  rulesHash,
  rulesJson,
  seedMatches,
  sha256Hex,
} from './commitments';
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
const VRF_FEE = 50_000_000_000_000_000_000_000n,
  VRF_GAS = 300_000_000_000_000n;
/** Returns the verified VRF output, null while it is pending, or undefined when no source is configured. */
async function deckEntropy(
  t: TournamentRow,
  c: ChainTournament,
  config: TournamentVerificationConfig,
): Promise<string | null | undefined> {
  if (c.randomness?.status === 'verified') return c.randomness.output_hex;
  if (!config.randomness_source) return c.randomness ? null : undefined;
  if (!c.randomness) {
    const {
      rows: [pending],
    } = await pool.query<{ operation_key: string }>(
      "SELECT operation_key FROM chain_ops WHERE tournament_id=$1 AND kind='randomness' AND state='pending' ORDER BY created_at LIMIT 1",
      [t.id],
    );
    await chainOp(
      pending?.operation_key ?? `vrf:${t.id}:${Math.floor(Date.now() / 120_000)}`,
      { kind: 'randomness', tournamentId: t.id, signer: 'operator', method: 'request_randomness' },
      prepareOperatorCall('request_randomness', { tournament_id: t.id }, VRF_FEE, VRF_GAS),
    ).catch(error => console.error('VRF request failed', (error as Error).message));
  }
  return null;
}
const chainAgent = (account: string) => view<ChainAgent | null>('get_agent', { agent: account });
export const chainTournament = (id: string) => view<ChainTournament | null>('get_tournament', { id });

export async function listAgents() {
  const r = await pool.query<AgentRow>('SELECT * FROM agents ORDER BY created_at DESC LIMIT 200');
  return r.rows.map(a => publicAgent(a));
}
export async function getAgent(id: string) {
  const r = await pool.query<AgentRow>('SELECT * FROM agents WHERE id=$1', [id]);
  return r.rows[0] || null;
}
/** List view: only the last hand is needed, so the full history never leaves Postgres, and entries come from one query. */
const LIST_COLUMNS = `id,creator,name,entry_yocto,starting_stack,capacity,duration_seconds,shares,state,decision_policy,seed_commitment,rules_hash,roster_hash,closes_at,started_at,ended_at,
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
  if (/^HOUSE[ _-]/.test(name)) throw new Error('Names starting with HOUSE are reserved for house agents');
  if (!ownerPublicKey.startsWith('ed25519:'))
    throw new Error('Sign in with an ed25519 NEAR key to own an agent account');
  const id = await withTx(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['agent-create-quota']);
    const owned = await client.query<{ n: string }>('SELECT count(*)::text AS n FROM agents WHERE owner=$1', [owner]);
    if (Number(owned.rows[0].n) >= 5) throw new Error('Each creator can register up to five agents');
    // Every new agent account is seeded with NEAR from the arena contract, and implicit-account sign-ins are free to mint,
    // so cap arena-wide creation per hour as well as per owner.
    const recent = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM agents WHERE created_at>now()-interval '1 hour'`,
    );
    if (Number(recent.rows[0].n) >= Number(process.env.AGENT_CREATE_HOURLY_CAP || 30))
      throw new Error('Agent registration is at its hourly limit. Try again later.');
    const id = randomUUID(),
      account = `${slugFor(name)}.${contractId()}`;
    if (account.length > 64) throw new Error('Agent name is too long for a NEAR sub-account');
    const key = newAgentKey(account);
    await client.query(
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
    return id;
  });
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
    prepareOperatorCall(
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
    accessKeys(agent.near_account).catch(() => null),
    view<[string, string][]>('mt_tokens_for_owner', { account_id: agent.near_account }).catch(() => null),
  ]);
  return {
    agentId: id,
    nearAccount: agent.near_account,
    explorer: accountUrl(agent.near_account),
    contractId: contractId(),
    arenaBalanceYocto: chain?.balance ?? null,
    arenaBalanceNear: chain ? formatNear(chain.balance) : null,
    accountBalanceNear: balance ? formatNear(balance) : null,
    onchainRecord: chain,
    accessKeys:
      keys?.map(k => ({
        ...k,
        role:
          k.publicKey === agent.server_public_key
            ? 'arena server (restricted)'
            : k.permission === 'FullAccess'
              ? 'full-access key'
              : 'other',
      })) ?? null,
    trophies: trophies?.map(([tokenId, balance]) => ({ tokenId, balance })) ?? null,
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
  const claimed = await pool.query(
    `UPDATE tournaments SET state='launching',rules_hash=$2,roster_hash=$3,decision_policy=$4 WHERE id=$1 AND state='draft'`,
    [id, rules, localRoster, decisionMode()],
  );
  if (!claimed.rowCount) throw new Error('Tournament launch already in progress');
  try {
    const result = await chainOp(
      `create-tournament:${id}`,
      { kind: 'create_tournament', tournamentId: id, signer: 'operator', method: 'create_tournament' },
      prepareOperatorCall('create_tournament', {
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
    await pool.query(`UPDATE tournaments SET state='funding',closes_at=$2 WHERE id=$1 AND state='launching'`, [
      id,
      new Date(chain.registration_deadline_ms),
    ]);
    return { state: 'funding', txHash: result.txHash, explorer: result.txHash ? txUrl(result.txHash) : null };
  } catch (error) {
    if (!(await chainTournament(id).catch(() => null)))
      await pool.query(
        `UPDATE tournaments SET state='draft' WHERE id=$1 AND state='launching'
        AND NOT EXISTS (SELECT 1 FROM chain_ops WHERE operation_key='create-tournament:'||$1::text AND state IN ('confirmed','pending'))`,
        [id],
      );
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
    prepareAgentCall(e.near_account, e.server_key_sealed, 'enter', { tournament_id: id }),
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
      `SELECT e.*,a.near_account,a.house FROM entries e JOIN agents a ON a.id=e.agent_id WHERE e.tournament_id=$1`,
      [t.id],
    )
  ).rows as (EntryRow & { house: boolean })[];
  for (const e of entries) {
    if (chain.entered.includes(e.near_account) && e.state !== 'entered')
      await pool.query(`UPDATE entries SET state='entered' WHERE tournament_id=$1 AND agent_id=$2`, [t.id, e.agent_id]);
    // Auto-enter as soon as an owner's deposit covers the fee.
    else if (
      !chain.entered.includes(e.near_account) &&
      chain.state === 'Registration' &&
      Date.now() < chain.registration_deadline_ms
    ) {
      let agent = await chainAgent(e.near_account).catch(() => null);
      // House agents: the operator tops up exactly the missing part of the entry fee.
      if (agent && e.house && BigInt(agent.balance) < BigInt(t.entry_yocto)) {
        const missing = BigInt(t.entry_yocto) - BigInt(agent.balance);
        await chainOp(
          `house-fund:${t.id}:${e.agent_id}`,
          { kind: 'deposit', tournamentId: t.id, agentId: e.agent_id, signer: 'operator', method: 'deposit' },
          prepareOperatorCall('deposit', { agent: e.near_account }, missing),
        ).catch(error => console.error('House funding failed', e.near_account, (error as Error).message));
        agent = await chainAgent(e.near_account).catch(() => null);
      }
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
    prepareOperatorCall(enough ? 'start' : 'cancel', { tournament_id: t.id }),
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

type SettlementVerifier = { outlayer: string; project_id: string };
type TournamentVerificationConfig = {
  pinned: boolean;
  randomness_source: ChainConfig['randomness_source'];
  settlement_verifier: SettlementVerifier | null;
};
const tournamentVerificationConfig = (id: string) =>
  view<TournamentVerificationConfig | null>('get_tournament_verification_config', { id });
export type SettlementStatus = { verified: boolean; in_flight: boolean; last_rejection: string | null };
let verifierCache: { at: number; value: SettlementVerifier | null } | null = null,
  verifierLoading: Promise<SettlementVerifier | null> | null = null;
/** The OutLayer replay project the contract requires before paying, or null (older contract or unset).
 * Served stale-while-revalidate; settlement itself re-reads it at most a minute late. */
export async function settlementVerifier() {
  if ((!verifierCache || Date.now() - verifierCache.at > 60_000) && !verifierLoading)
    verifierLoading = view<SettlementVerifier | null>('get_settlement_verifier')
      .catch(() => verifierCache?.value ?? null)
      .then(value => {
        verifierCache = { at: Date.now(), value };
        verifierLoading = null;
        return value;
      });
  return verifierCache ? verifierCache.value : verifierLoading!;
}
const settlementStatus = (id: string) =>
  view<SettlementStatus>('get_settlement_status', { tournament_id: id }).catch(() => null);

async function finalize(t: TournamentRow) {
  if (!t.history.length || !t.started_at || Date.now() < t.started_at.getTime() + t.duration_seconds * 1000) return;
  const chain = await chainTournament(t.id);
  if (chain?.state !== 'Running') return;
  const end = chain.started_at_ms + chain.duration_ms;
  const block = await provider.viewBlock({ finality: 'final' });
  if (BigInt(block.header.timestamp_nanosec) / 1_000_000n < BigInt(end)) return;
  const config = await tournamentVerificationConfig(t.id);
  if (!config) return;
  const verifier = config.settlement_verifier;
  const ranking =
    t.ranking || rankEntrants(Object.fromEntries(Object.keys(t.stacks).map(id => [id, t.starting_stack])), t.history);
  const entrants = (
    await pool.query<AgentRow>(
      `SELECT a.* FROM entries e JOIN agents a ON a.id=e.agent_id WHERE e.tournament_id=$1 AND e.state='entered'`,
      [t.id],
    )
  ).rows;
  const accounts = new Map(entrants.map(a => [a.id, a.near_account]));
  const ranked = ranking.map(id => accounts.get(id)).filter(Boolean) as string[];
  if (ranked.length < t.shares.length) throw new Error('Ranking has fewer paid entrants than prize places');
  const hands = actionLog(t.history);
  const result = t.result_hash || resultCommitment({ tournamentId: t.id, ranking, stacks: t.stacks });
  // With OutLayer settlement the contract itself hashes the action log into replay_hash.
  const replay = verifier
    ? sha256Hex(hands.join('\n'))
    : t.replay_hash || resultCommitment({ tournamentId: t.id, history: t.history });
  await pool.query(
    `UPDATE tournaments SET state='finalizing',ranking=$2::jsonb,winner_id=$3,result_hash=$4,replay_hash=$5,ended_at=COALESCE(ended_at,now()) WHERE id=$1 AND state IN ('running','finalizing')`,
    [t.id, JSON.stringify(ranking), ranking[0], result, replay],
  );
  if (verifier) {
    const status = await settlementStatus(t.id);
    const attempts = (
      await pool.query<{ state: string; operation_key: string }>(
        `SELECT state,operation_key FROM chain_ops WHERE tournament_id=$1 AND method='finalize_verified' ORDER BY created_at DESC`,
        [t.id],
      )
    ).rows;
    const pending = attempts.find(op => op.state === 'pending');
    if (!status) return;
    // Retry only transient OutLayer failures; a replay that disagrees is left for review (or refund after grace).
    const retryable = !status?.last_rejection || status.last_rejection === 'OUTLAYER_NO_RESULT';
    if (!status?.in_flight && retryable && (pending || attempts.length < 3)) {
      const rules = rulesJson({
        id: t.id,
        entryYocto: t.entry_yocto,
        startingStack: t.starting_stack,
        capacity: t.capacity,
        durationSeconds: t.duration_seconds,
        shares: t.shares,
      });
      if (sha256Hex(rules) !== t.rules_hash) throw new Error('Rules preimage does not match the onchain rules hash');
      await chainOp(
        pending?.operation_key ?? `finalize-verified:${t.id}:${attempts.length}`,
        { kind: 'finalize', tournamentId: t.id, signer: 'operator', method: 'finalize_verified' },
        prepareOperatorCall(
          'finalize_verified',
          {
            tournament_id: t.id,
            result_hash: result,
            seed_reveal: t.seed_secret,
            ranking: ranked.slice(0, t.shares.length),
            rules,
            configs: entrants.map(a =>
              configJson({
                id: a.id,
                owner: a.owner,
                nearAccount: a.near_account,
                name: a.name,
                strategy: a.strategy,
                model: a.model,
                description: a.description,
              }),
            ),
            hands,
          },
          VRF_FEE,
          VRF_GAS,
        ),
      );
    }
  } else
    await chainOp(
      `finalize:${t.id}`,
      { kind: 'finalize', tournamentId: t.id, signer: 'operator', method: 'finalize' },
      prepareOperatorCall('finalize', {
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
  chain: ChainTournament,
  config: TournamentVerificationConfig,
  onAction?: (action: HandDecision, tournamentId: string, handNumber: number) => void,
  onTurn?: (turn: PublicTurn, tournamentId: string, handNumber: number) => void,
) {
  const client = await pool.connect();
  try {
    const lock = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [
      `hand:${t.id}`,
    ]);
    if (!lock.rows[0]?.locked) return;
    try {
      const latest = (await client.query<TournamentRow>('SELECT * FROM tournaments WHERE id=$1', [t.id])).rows[0];
      if (!latest || latest.state !== 'running') return;
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
      if (Date.now() >= latest.started_at!.getTime() + latest.duration_seconds * 1000) {
        // With no completed hands, leave the match for the contract's expiry/refund path.
        if (latest.history.length) await finalize(latest);
        return;
      }
      if (seats.length < 2) return;
      const entropy = await deckEntropy(latest, chain, config);
      if (entropy === null || Date.now() >= latest.started_at!.getTime() + latest.duration_seconds * 1000) return;
      const receipts: TeeReceipt[] = [];
      // Each model explains its move, but the note can mention hole cards, so it is stored apart from the public
      // hand record and released only after settlement. The call counter ties a note to its own decision even if
      // a timed-out call resolves late.
      const notes: { seq: number; agentId: string; note: string }[] = [];
      let calls = 0,
        pending: { call: number; agentId: string; note?: string } | null = null;
      const policy = latest.decision_policy ?? decisionMode();
      const provider =
        policy === 'fixture'
          ? fixtureDecision
          : async (ctx: DecisionContext) => {
              const call = ++calls;
              const decision = await nearAiDecision(ctx, r => receipts.push(r));
              pending = { call, agentId: ctx.agentId, note: decision.reason };
              return decision;
            };
      let seq = 0;
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
        onTurn: turn => onTurn?.(turn, latest.id, handNumber),
        onDecision: d => {
          const p = pending as { call: number; agentId: string; note?: string } | null;
          if (p && p.call === calls && p.agentId === d.agentId && p.note && !d.reason.startsWith('Fallback'))
            notes.push({ seq, agentId: d.agentId, note: p.note });
          pending = null;
          seq++;
          onAction?.(d, latest.id, handNumber);
        },
      });
      const stacks = { ...latest.stacks };
      for (const p of hand.players) stacks[p.id] = p.stack;
      await client.query('BEGIN');
      try {
        const saved = await client.query(
          `UPDATE tournaments SET history=history||$2::jsonb,stacks=$3::jsonb,hand_number=hand_number+1,button=button+1,
        blind_level=CASE WHEN (hand_number+1)%10=0 THEN blind_level+1 ELSE blind_level END WHERE id=$1 AND hand_number=$4 AND state='running'`,
          [latest.id, JSON.stringify([hand]), JSON.stringify(stacks), latest.hand_number],
        );
        if (!saved.rowCount) {
          await client.query('ROLLBACK');
          return;
        }
        for (const n of notes)
          await client.query(
            `INSERT INTO decision_notes(tournament_id,hand_number,seq,agent_id,note) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
            [latest.id, handNumber, n.seq, n.agentId, n.note],
          );
        for (const r of receipts)
          await client.query(
            `INSERT INTO tee_receipts(tournament_id,hand_number,agent_id,model,chat_id,request_hash,response_hash) VALUES($1,$2,$3,$4,$5,$6,$7)`,
            [latest.id, handNumber, r.agentId, r.model, r.chatId, r.requestHash, r.responseHash],
          );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
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
      `SELECT id,model,chat_id,request_hash,response_hash FROM tee_receipts WHERE NOT signature_checked AND next_check_at<=now() AND
        (detail IS NULL OR detail='Signature not available yet' OR detail LIKE 'Check failed:%')
        AND created_at>now()-interval '1 hour' ORDER BY id LIMIT 5`,
    )
  ).rows;
  for (const r of rows) {
    try {
      const v = await verifyReceipt(r);
      await pool.query(
        `UPDATE tee_receipts SET verified=false,signature_checked=$2,signature_kind=$3,signer=$4,detail=$5,next_check_at=now()+interval '1 minute' WHERE id=$1`,
        [r.id, v.signatureChecked, v.kind, v.signer, v.detail],
      );
    } catch (error) {
      await pool.query(`UPDATE tee_receipts SET detail=$2,next_check_at=now()+interval '1 minute' WHERE id=$1`, [
        r.id,
        `Check failed: ${(error as Error).message}`.slice(0, 300),
      ]);
    }
  }
}

const tableJobs = new Set<string>();
let lastScheduled: string | undefined;
let houseJob: Promise<void> | undefined;

export async function tickArena(
  onAction?: (action: HandDecision, tournamentId: string, handNumber: number) => void,
  onTurn?: (turn: PublicTurn, tournamentId: string, handNumber: number) => void,
) {
  if (!nearConfigured()) return;
  houseJob ??= ensureHouseAgents(provisionAgent)
    .catch(error => console.error('House agents', (error as Error).message))
    .then(() => {})
    .finally(() => {
      houseJob = undefined;
    });
  const rows = (
    await pool.query<TournamentRow>(
      `SELECT * FROM tournaments WHERE state IN ('launching','funding','running','finalizing') ORDER BY created_at`,
    )
  ).rows;
  const cursor = rows.findIndex(t => t.id === lastScheduled) + 1;
  for (const t of [...rows.slice(cursor), ...rows.slice(0, cursor)]) {
    if (tableJobs.size >= 4) break;
    if (tableJobs.has(t.id)) continue;
    tableJobs.add(t.id);
    lastScheduled = t.id;
    void advanceTable(t, onAction, onTurn).finally(() => tableJobs.delete(t.id));
  }
}

async function advanceTable(
  t: TournamentRow,
  onAction?: (action: HandDecision, tournamentId: string, handNumber: number) => void,
  onTurn?: (turn: PublicTurn, tournamentId: string, handNumber: number) => void,
) {
  try {
    if (t.state === 'launching') {
      const c = await chainTournament(t.id);
      if (c)
        await pool.query(`UPDATE tournaments SET state='funding',closes_at=$2 WHERE id=$1 AND state='launching'`, [
          t.id,
          new Date(c.registration_deadline_ms),
        ]);
      else {
        const progress = await reconcileOperation(`create-tournament:${t.id}`).catch(() => null);
        if (progress?.state === 'pending') return;
        await pool.query(
          `UPDATE tournaments SET state='draft' WHERE id=$1 AND state='launching' AND created_at<now()-interval '5 minutes'
             AND NOT EXISTS (SELECT 1 FROM chain_ops WHERE operation_key='create-tournament:'||$1::text AND state='pending')`,
          [t.id],
        );
      }
      return;
    }
    if (t.state === 'funding') {
      await syncFunding(t);
      return;
    }
    const chain = await chainTournament(t.id);
    if (chain?.state === 'Cancelled') {
      await pool.query(`UPDATE tournaments SET state='cancelled',ended_at=now() WHERE id=$1`, [t.id]);
      return;
    }
    if (chain?.state === 'Finalized') {
      await pool.query(`UPDATE tournaments SET state='settled',payouts=$2::jsonb WHERE id=$1`, [
        t.id,
        JSON.stringify(chain.payouts),
      ]);
      return;
    }
    if (chain?.state !== 'Running') return;
    const config = await tournamentVerificationConfig(t.id);
    if (!config) return;
    const end = chain.started_at_ms + chain.duration_ms;
    const noEntropy = config.pinned && config.randomness_source && chain.randomness?.status !== 'verified';
    const refundAfter = noEntropy ? end : end + chain.grace_ms + 1;
    if (Date.now() >= refundAfter) {
      const block = await provider.viewBlock({ finality: 'final' });
      if (BigInt(block.header.timestamp_nanosec) / 1_000_000n < BigInt(refundAfter)) return;
      await chainOp(
        `cancel-expired:${t.id}`,
        { kind: 'cancel', tournamentId: t.id, signer: 'operator', method: 'cancel' },
        prepareOperatorCall('cancel', { tournament_id: t.id }),
      );
      return;
    }
    if (t.state === 'running') await runHand(t, chain, config, onAction, onTurn);
    else if (t.state === 'finalizing') await finalize(t);
  } catch (error) {
    console.error('Arena transition failed', t.id, (error as Error).message);
  }
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
  // A failed attempt that a later retry of the same operation confirmed is noise, not history.
  const superseded = (o: (typeof r.rows)[number], i: number) =>
    o.state === 'failed' &&
    r.rows.some(
      (x, j) =>
        j > i && x.state === 'confirmed' && x.kind === o.kind && x.method === o.method && x.agent_id === o.agent_id,
    );
  return r.rows.filter((o, i) => !superseded(o, i)).map(o => ({ ...o, explorer: o.tx_hash ? txUrl(o.tx_hash) : null }));
}
/** Each model's own explanation of its moves, released only once the tournament has settled onchain. */
export async function decisionNotes(tournamentId: string) {
  const t = (await pool.query<{ state: string }>('SELECT state FROM tournaments WHERE id=$1', [tournamentId])).rows[0];
  if (!t) return null;
  if (t.state !== 'settled') return { sealed: true as const, notes: [] };
  const rows = (
    await pool.query<{ hand_number: number; seq: number; agent_id: string; note: string }>(
      'SELECT hand_number,seq,agent_id,note FROM decision_notes WHERE tournament_id=$1 ORDER BY hand_number,seq',
      [tournamentId],
    )
  ).rows;
  return {
    sealed: false as const,
    notes: rows.map(r => ({ hand: r.hand_number, seq: r.seq, agentId: r.agent_id, note: r.note })),
  };
}

export async function teeReceipts(tournamentId: string) {
  const r = await pool.query(
    `SELECT r.hand_number,r.agent_id,a.name AS agent,r.model,r.chat_id,r.request_hash,r.response_hash,r.signature_kind,r.signer,false AS verified,r.signature_checked,r.detail,r.created_at
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
    (t.state === 'settled' ? t.history : []).map(async h => ({
      handNumber: h.handNumber,
      valid: await replayMatches(h, {
        smallBlind: Math.min(10000, 10 * (Math.floor((h.handNumber - 1) / 10) + 1)),
        bigBlind: Math.min(20000, 20 * (Math.floor((h.handNumber - 1) / 10) + 1)),
      }),
      seedMatches: chain ? handSeed(t.seed_secret, t.id, h.handNumber, vrf) === h.seed : null,
    })),
  );
  const settled = t.state === 'settled';
  const receipts = (
    await pool.query<{ total: string; signature_checked: string }>(
      `SELECT count(*)::text AS total,count(*) FILTER (WHERE signature_checked)::text AS signature_checked FROM tee_receipts WHERE tournament_id=$1`,
      [t.id],
    )
  ).rows[0];
  const roster =
    chain && data.entries.length >= 2
      ? rosterHash(data.entries.map(e => ({ agent: e.near_account, config_hash: e.config_hash })))
      : null;
  const [config, settlement] = await Promise.all([
    tournamentVerificationConfig(t.id).catch(() => null),
    settlementStatus(t.id),
  ]);
  return {
    tournamentId: t.id,
    contractId: nearConfigured() ? contractId() : null,
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
          resultHashMatches:
            settled && t.ranking && chain.result_hash
              ? chain.result_hash === resultCommitment({ tournamentId: t.id, ranking: t.ranking, stacks: t.stacks })
              : null,
          replayHashMatches:
            settled && settlement && chain.replay_hash
              ? chain.replay_hash ===
                (settlement?.verified
                  ? sha256Hex(actionLog(t.history).join('\n'))
                  : resultCommitment({ tournamentId: t.id, history: t.history }))
              : null,
          revealedSeedMatches: settled ? chain.revealed_seed === t.seed_secret : null,
          payouts: chain.payouts,
        }
      : null,
    resultHash: t.result_hash,
    replayHash: t.replay_hash,
    decisionPolicy: t.decision_policy,
    teeReceipts: { total: Number(receipts.total), signatureChecked: Number(receipts.signature_checked) },
    settlement: {
      verifierProject: config?.settlement_verifier?.project_id ?? null,
      verifiedByOutLayer: Boolean(chain?.state === 'Finalized' && settlement?.verified),
      inFlight: Boolean(settlement?.in_flight),
      lastRejection: settlement?.last_rejection ?? null,
    },
    trust:
      settlement?.verified && chain?.state === 'Finalized'
        ? 'The contract accepted the OutLayer replay result before crediting prizes.'
        : chain?.state === 'Finalized'
          ? 'The contract finalized this tournament. OutLayer replay verification is unconfirmed.'
          : 'A finalized result is not currently confirmed by the contract.',
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
  house: boolean;
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
    pool.query<{ id: string; name: string; strategy: string; model: string; near_account: string; house: boolean }>(
      `SELECT id,name,strategy,model,near_account,house FROM agents WHERE state='active'`,
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
      house: a.house,
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
