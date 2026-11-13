import { createHash, createHmac, randomBytes } from 'node:crypto';

/** All commitments are lowercase hex sha256 so the NEAR contract (env::sha256) can recompute them. */
export const sha256Hex = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export type RosterSeat = { agent: string; config_hash: string };
type AgentConfig = {
  id: string;
  owner: string;
  nearAccount: string;
  name: string;
  strategy: string;
  model: string;
  description: string;
};
/** The exact preimage of an entrant's `config_hash`; OutLayer's replay re-hashes it to bind id to account. */
export const configJson = (agent: AgentConfig) =>
  JSON.stringify({
    id: agent.id,
    owner: agent.owner,
    account: agent.nearAccount,
    name: agent.name,
    strategy: agent.strategy,
    model: agent.model,
    description: agent.description,
  });
export const configHash = (agent: AgentConfig) => sha256Hex(configJson(agent));
export function newSeed() {
  const seed = randomBytes(32);
  return { seed: seed.toString('hex'), commitment: sha256Hex(seed) };
}
export const seedMatches = (seedHex: string, commitment: string) =>
  sha256Hex(Buffer.from(seedHex, 'hex')) === commitment;
/** Deck seed per hand. With OutLayer VRF configured, the verified VRF output (unknown to the operator
 * when it committed `seedHex`) is mixed in, so neither the operator nor OutLayer alone chooses the cards. */
export function handSeed(seedHex: string, tournamentId: string, handNumber: number, vrfOutputHex?: string | null) {
  return createHmac('sha256', Buffer.from(seedHex.replace(/^0x/, ''), 'hex'))
    .update(vrfOutputHex ? `${tournamentId}:${handNumber}:${vrfOutputHex}` : `${tournamentId}:${handNumber}`)
    .digest('hex');
}
/** Mirrors `roster_hash` in contracts/near/src/lib.rs: sha256 of sorted `agent|config_hash` lines. */
export function rosterHash(seats: RosterSeat[]) {
  if (seats.length < 2 || seats.length > 9) throw new Error('Roster must contain 2–9 seats');
  if (new Set(seats.map(s => s.agent)).size !== seats.length) throw new Error('Duplicate roster agent');
  return sha256Hex(
    seats
      .map(s => `${s.agent}|${s.config_hash}`)
      .sort()
      .join('\n'),
  );
}
type Rules = {
  id: string;
  entryYocto: string;
  startingStack: number;
  capacity: number;
  durationSeconds: number;
  shares: number[];
};
/** The exact preimage of `rules_hash`, rebuilt at settlement for the replay worker. */
export const rulesJson = (r: Rules) =>
  JSON.stringify({
    id: r.id,
    entryYocto: r.entryYocto,
    startingStack: r.startingStack,
    capacity: r.capacity,
    durationSeconds: r.durationSeconds,
    shares: r.shares,
  });
export function rulesHash(rules: Rules) {
  return sha256Hex(rulesJson(rules));
}
export function resultCommitment(input: unknown) {
  return sha256Hex(JSON.stringify(input));
}
