import { createHash, createHmac, randomUUID } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { baseEncode } from 'near-api-js';
import { pool, withTx } from '../db';
import {
  accessKeys,
  contractId,
  formatNear,
  nearConfigured,
  newAgentKey,
  parseNear,
  replaceServerKey,
} from '../near/chain';
import { allowedModels } from '../near/nearai';
import { configHash } from './commitments';
import type { AgentRow, TournamentRow } from '../types';

/**
 * House agents keep tables playable when only one person is online. They are ordinary Holecard agents
 * (own NEAR sub-account, restricted server key, a TEE model) with three differences:
 *  - each has its own owner key derived from AGENT_KEY_SECRET, so the contract's one-seat-per-owner rule
 *    still holds and their winnings go to an account the house controls;
 *  - the operator tops up their arena balance to cover an entry fee (capped by HOUSE_MAX_ENTRY_NEAR);
 *  - they are labelled HOUSE everywhere in the UI.
 * They never join on their own: a tournament creator must choose "fill empty seats".
 */
export const HOUSE_PERSONAS = [
  {
    name: 'HOUSE GRANITE',
    strategy: 'Conservative',
    description: 'House agent. Waits for strong hands and value-bets them; rarely bluffs.',
  },
  {
    name: 'HOUSE VIPER',
    strategy: 'Aggressive',
    description: 'House agent. Plays many hands and applies pressure with large raises.',
  },
  {
    name: 'HOUSE MIRAGE',
    strategy: 'Bluff Heavy',
    description: 'House agent. Steals from late position and represents strong hands.',
  },
] as const;

export const houseEnabled = () => nearConfigured() && process.env.HOUSE_AGENTS !== 'off';
export const houseMaxEntryYocto = () => parseNear(process.env.HOUSE_MAX_ENTRY_NEAR || '1');

const slug = (name: string) => name.toLowerCase().replace(/ +/g, '-');
/** `house-granite-1a2b.<contract>`: the suffix fingerprints AGENT_KEY_SECRET, so a server with a different secret
 * (and therefore different house owner keys) gets its own accounts instead of colliding with ones it cannot use. */
export function houseAccount(name: string) {
  const fingerprint = createHash('sha256')
    .update(`house:${process.env.AGENT_KEY_SECRET || ''}`)
    .digest('hex')
    .slice(0, 4);
  return `${slug(name)}-${fingerprint}.${contractId()}`;
}

/** Deterministic owner key per persona: ed25519 seed = HMAC-SHA256(AGENT_KEY_SECRET, "house-owner:<slug>"). */
export function houseOwner(name: string) {
  const secret = process.env.AGENT_KEY_SECRET;
  if (!secret) throw new Error('AGENT_KEY_SECRET is not configured');
  const seed = createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(`house-owner:${slug(name)}`)
    .digest();
  const publicKey = ed25519.getPublicKey(seed);
  return {
    accountId: Buffer.from(publicKey).toString('hex'), // implicit account: winnings withdraw here
    publicKey: `ed25519:${baseEncode(publicKey)}`,
    secretKey: `ed25519:${baseEncode(Buffer.concat([seed, Buffer.from(publicKey)]))}`,
  };
}

let lastEnsure = 0;
/** Registers missing house agents and retries unfinished account creation, at most every five minutes. */
export async function ensureHouseAgents(
  provision: (id: string, owner: string, ownerPublicKey: string) => Promise<unknown>,
) {
  if (!houseEnabled() || Date.now() - lastEnsure < 5 * 60_000) return;
  lastEnsure = Date.now();
  const model = allowedModels()[0] || 'fixture-policy';
  for (const persona of HOUSE_PERSONAS) {
    const owner = houseOwner(persona.name);
    const account = houseAccount(persona.name);
    let row = (await pool.query<AgentRow>('SELECT * FROM agents WHERE near_account=$1', [account])).rows[0];
    if (!row) {
      const key = newAgentKey(account);
      row = (
        await pool.query<AgentRow>(
          `INSERT INTO agents(id,owner,name,strategy,model,description,near_account,server_public_key,server_key_sealed,house)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true) ON CONFLICT DO NOTHING RETURNING *`,
          [
            randomUUID(),
            owner.accountId,
            persona.name,
            persona.strategy,
            model,
            persona.description,
            account,
            key.publicKey,
            key.sealed,
          ],
        )
      ).rows[0];
      if (!row) continue; // a player already took the name
    }
    if (row.state !== 'active') {
      await provision(row.id, owner.accountId, owner.publicKey).catch(error =>
        console.error('House agent provisioning failed', account, (error as Error).message),
      );
      row = (await pool.query<AgentRow>('SELECT * FROM agents WHERE id=$1', [row.id])).rows[0];
      if (row.state !== 'active') continue;
    }
    // The account can outlive this database (redeploys, a new Postgres). If our sealed server key is not on the
    // account, rotate it with the house owner key so the agent can still enter tournaments.
    try {
      const keys = await accessKeys(account);
      if (!keys.some(k => k.publicKey === row.server_public_key)) {
        const stale = keys.filter(k => k.permission !== 'FullAccess').map(k => k.publicKey);
        const fresh = await replaceServerKey(account, owner.secretKey, stale);
        await pool.query('UPDATE agents SET server_public_key=$2,server_key_sealed=$3 WHERE id=$1', [
          row.id,
          fresh.publicKey,
          fresh.sealed,
        ]);
      }
    } catch (error) {
      console.error('House agent key check failed', account, (error as Error).message);
    }
  }
}

/** Seats house agents in every open seat of a draft the creator owns. At least one player seat is required. */
export async function fillWithHouse(creator: string, tournamentId: string) {
  if (!houseEnabled()) throw new Error('House agents are not enabled on this arena');
  await withTx(async client => {
    const t = (await client.query<TournamentRow>('SELECT * FROM tournaments WHERE id=$1 FOR UPDATE', [tournamentId]))
      .rows[0];
    if (!t || t.state !== 'draft' || t.creator !== creator) throw new Error('Only the creator can fill an open draft');
    if (BigInt(t.entry_yocto) > houseMaxEntryYocto())
      throw new Error(
        `House agents only join tables with an entry of ${formatNear(houseMaxEntryYocto())} NEAR or less`,
      );
    const entries = (
      await client.query<{ agent_id: string; house: boolean }>(
        'SELECT e.agent_id,a.house FROM entries e JOIN agents a ON a.id=e.agent_id WHERE e.tournament_id=$1',
        [tournamentId],
      )
    ).rows;
    if (!entries.some(e => !e.house)) throw new Error('Reserve a seat for your own agent first');
    const open = t.capacity - entries.length;
    if (open <= 0) throw new Error('Roster is full');
    const house = (
      await client.query<AgentRow>(
        `SELECT * FROM agents WHERE house AND state='active' AND id<>ALL($1::uuid[]) ORDER BY name LIMIT $2`,
        [entries.map(e => e.agent_id), open],
      )
    ).rows;
    if (!house.length) throw new Error('House agents are still being created on NEAR. Try again in a minute.');
    for (const a of house)
      await client.query('INSERT INTO entries(tournament_id,agent_id,owner,config_hash) VALUES($1,$2,$3,$4)', [
        tournamentId,
        a.id,
        a.owner,
        configHash({
          id: a.id,
          owner: a.owner,
          nearAccount: a.near_account,
          name: a.name,
          strategy: a.strategy,
          model: a.model,
          description: a.description,
        }),
      ]);
  });
}
