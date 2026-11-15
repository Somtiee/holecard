export type Agent = {
  id: string;
  owner: string;
  name: string;
  strategy: string;
  model: string;
  description: string;
  nearAccount: string;
  state: string;
  createdAt: string;
  reputation?: number;
  tournaments?: number;
  wins?: number;
  profitNear?: string;
  roi?: number;
  hands?: number;
  house?: boolean;
};

export type Entry = { agentId: string; state: string; nearAccount?: string };

export type Decision = {
  agentId: string;
  agent: string;
  action: string;
  amount: number;
  pot: number;
  stage: string;
  position: string;
  reason: string;
  latencyMs: number;
  timestamp: number;
  communityCards: string[];
  tableStacks?: Record<string, number>;
};

export type Thinking = {
  tournamentId: string;
  handNumber: number;
  turn: {
    agentId: string;
    agent: string;
    stage: string;
    position: string;
    communityCards: string[];
    pot: number;
    stack: number;
    timeoutMs: number;
  };
};

export type Hand = {
  handNumber: number;
  communityCards: string[];
  pot: number;
  players: { id: string; name: string; stack: number; holeCards: string[] }[];
  decisions: Decision[];
  winnerIds: string[];
  payouts: Record<string, number>;
};

export type Tournament = {
  decisionPolicy: string | null;
  id: string;
  creator: string;
  name: string;
  state: string;
  entryNear: string;
  startingStack: number;
  capacity: number;
  durationSeconds: number;
  shares: number[];
  contractId: string | null;
  closesAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  handNumber: number;
  stacks: Record<string, number>;
  leaderId: string | null;
  ranking: string[] | null;
  entries: Entry[];
  potNear: string;
  lastHand: Hand | null;
  resultHash: string | null;
  replayHash: string | null;
  seedCommitment: string;
  rosterHash: string | null;
};

export type Ranking = {
  rank: number;
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
};

export type Analytics = {
  hands: number;
  decisions: number;
  vpip: number;
  pfr: number;
  aggression: number;
  averageDecisionMs: number;
  averageBetChips: number;
  showdownWinRate: number;
  biggestPotChips: number;
  bankroll: { hand: number; stack: number }[];
  note: string;
};

export type Operation = {
  kind: string;
  agent_id: string | null;
  signer: string;
  method: string;
  state: string;
  tx_hash: string | null;
  explorer: string | null;
  error: string | null;
  created_at: string;
};

export type Health = {
  nearConfigured: boolean;
  nearAiConfigured: boolean;
  decisionPolicy: string;
  tournamentLaunchReady: boolean;
  operatorTrust: string;
  contract: Record<string, unknown> | null;
};

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...options?.headers },
    credentials: 'same-origin',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data as T;
}

export const short = (value: string | null | undefined) => (value ? `${value.slice(0, 7)}…${value.slice(-5)}` : '—');

export const route = () => location.hash.slice(1) || '/';

export const go = (path: string) => {
  location.hash = path;
  window.scrollTo({ top: 0, behavior: 'instant' });
};

export const timeLeft = (value: string | null) => {
  if (!value) return '—';
  const s = Math.max(0, Math.floor((new Date(value).getTime() - Date.now()) / 1000));
  return `${Math.floor(s / 60)
    .toString()
    .padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
};

export const tournamentClockExpired = (t: Tournament) =>
  t.state === 'running' && Boolean(t.startedAt && Date.now() >= Date.parse(t.startedAt) + t.durationSeconds * 1000);

export const tournamentStatus = (t: Tournament) =>
  tournamentClockExpired(t) ? (t.handNumber ? 'Time expired' : 'Expired · no hands recorded') : t.state;
