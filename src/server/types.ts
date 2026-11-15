import type { HandResult } from '../engine/hand';
import { NEAR_NETWORK, accountUrl, contractId, formatNear } from './near/chain';

export type AgentRow = {
  id: string;
  owner: string;
  name: string;
  strategy: string;
  model: string;
  description: string;
  near_account: string;
  server_public_key: string;
  server_key_sealed: string;
  state: string;
  create_tx: string | null;
  created_at: Date;
  house?: boolean;
};
export type TournamentRow = {
  id: string;
  creator: string;
  name: string;
  entry_yocto: string;
  starting_stack: number;
  capacity: number;
  duration_seconds: number;
  shares: number[];
  state: string;
  decision_policy: string | null;
  seed_secret: string;
  seed_commitment: string;
  rules_hash: string | null;
  roster_hash: string | null;
  closes_at: Date | null;
  started_at: Date | null;
  ended_at: Date | null;
  hand_number: number;
  button: number;
  blind_level: number;
  stacks: Record<string, number>;
  history: HandResult[];
  ranking: string[] | null;
  winner_id: string | null;
  result_hash: string | null;
  replay_hash: string | null;
  payouts: { agent: string; amount: string }[] | null;
  created_at: Date;
};
export type EntryRow = {
  tournament_id: string;
  agent_id: string;
  owner: string;
  config_hash: string;
  state: string;
  near_account: string;
  server_key_sealed: string;
  name: string;
  strategy: string;
  model: string;
  description: string;
};

const safeContract = () => {
  try {
    return contractId();
  } catch {
    return null;
  }
};
export function publicAgent(a: AgentRow, stats?: Record<string, unknown>) {
  return {
    id: a.id,
    owner: a.owner,
    name: a.name,
    strategy: a.strategy,
    model: a.model,
    description: a.description,
    nearAccount: a.near_account,
    explorer: accountUrl(a.near_account),
    serverPublicKey: a.server_public_key,
    state: a.state,
    createTx: a.create_tx,
    house: Boolean(a.house),
    createdAt: a.created_at,
    ...stats,
  };
}
export function publicTournament(
  t: TournamentRow,
  entries: { agent_id: string; state: string; near_account?: string }[] = [],
) {
  const last = t.history.at(-1);
  return {
    id: t.id,
    creator: t.creator,
    name: t.name,
    game: 'poker',
    network: `NEAR ${NEAR_NETWORK}`,
    asset: 'NEAR',
    contractId: safeContract(),
    state: t.state,
    decisionPolicy: t.decision_policy,
    entryYocto: t.entry_yocto,
    entryNear: formatNear(t.entry_yocto),
    startingStack: t.starting_stack,
    capacity: t.capacity,
    durationSeconds: t.duration_seconds,
    shares: t.shares,
    closesAt: t.closes_at,
    startedAt: t.started_at,
    endedAt: t.ended_at,
    handNumber: t.hand_number,
    stacks: t.stacks,
    leaderId: t.winner_id,
    ranking: t.ranking,
    payouts: t.payouts,
    entries: entries.map(e => ({ agentId: e.agent_id, state: e.state, nearAccount: e.near_account })),
    potNear:
      t.state === 'cancelled'
        ? '0'
        : formatNear(BigInt(t.entry_yocto) * BigInt(entries.filter(e => e.state === 'entered').length)),
    lastHand: last ? { ...last, seed: undefined, players: last.players.map(p => ({ ...p, holeCards: [] })) } : null,
    resultHash: t.result_hash,
    replayHash: t.replay_hash,
    seedCommitment: t.seed_commitment,
    rosterHash: t.roster_hash,
    rulesHash: t.rules_hash,
  };
}
