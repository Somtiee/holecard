import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  ssl: process.env.DATABASE_SSL === 'require' ? { rejectUnauthorized: true } : undefined,
});

/** Offchain records only. Balances, entries, payouts and commitments are read back from the NEAR contract. */
export async function migrate() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for the arena');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sign_in_challenges (
      nonce text PRIMARY KEY, message text NOT NULL, expires_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash text PRIMARY KEY, account_id text NOT NULL, public_key text NOT NULL, expires_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agents (
      id uuid PRIMARY KEY, owner text NOT NULL, name text NOT NULL UNIQUE,
      strategy text NOT NULL, model text NOT NULL, description text NOT NULL,
      near_account text NOT NULL UNIQUE, server_public_key text NOT NULL, server_key_sealed text NOT NULL,
      state text NOT NULL DEFAULT 'creating', create_tx text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS agents_owner_idx ON agents(owner);
    CREATE TABLE IF NOT EXISTS tournaments (
      id uuid PRIMARY KEY, creator text NOT NULL, name text NOT NULL,
      entry_yocto numeric(40,0) NOT NULL CHECK (entry_yocto > 0),
      starting_stack integer NOT NULL CHECK (starting_stack BETWEEN 100 AND 1000000),
      capacity integer NOT NULL CHECK (capacity BETWEEN 2 AND 9),
      duration_seconds integer NOT NULL CHECK (duration_seconds BETWEEN 300 AND 86400),
      shares jsonb NOT NULL, state text NOT NULL,
      seed_secret text NOT NULL, seed_commitment text NOT NULL,
      rules_hash text, roster_hash text, closes_at timestamptz, started_at timestamptz, ended_at timestamptz,
      hand_number integer NOT NULL DEFAULT 0, button integer NOT NULL DEFAULT 0, blind_level integer NOT NULL DEFAULT 1,
      stacks jsonb NOT NULL DEFAULT '{}'::jsonb, history jsonb NOT NULL DEFAULT '[]'::jsonb,
      result_hash text, replay_hash text, ranking jsonb, winner_id uuid, payouts jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS entries (
      tournament_id uuid NOT NULL REFERENCES tournaments(id),
      agent_id uuid NOT NULL REFERENCES agents(id),
      owner text NOT NULL, config_hash text NOT NULL, state text NOT NULL DEFAULT 'reserved',
      PRIMARY KEY(tournament_id,agent_id), UNIQUE(tournament_id,owner)
    );
    CREATE TABLE IF NOT EXISTS chain_ops (
      operation_key text PRIMARY KEY, kind text NOT NULL,
      tournament_id uuid REFERENCES tournaments(id), agent_id uuid REFERENCES agents(id),
      signer text NOT NULL, method text NOT NULL, state text NOT NULL DEFAULT 'pending',
      tx_hash text, error text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS tee_receipts (
      id bigserial PRIMARY KEY, tournament_id uuid REFERENCES tournaments(id), hand_number integer,
      agent_id uuid REFERENCES agents(id), model text NOT NULL, chat_id text NOT NULL,
      request_hash text NOT NULL, response_hash text NOT NULL,
      signature_kind text, signer text, verified boolean NOT NULL DEFAULT false, detail text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS tee_receipts_tournament_idx ON tee_receipts(tournament_id,hand_number);
    CREATE TABLE IF NOT EXISTS sponsorships (
      owner text PRIMARY KEY, agent text NOT NULL, tx_hash text, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS agents_created_idx ON agents(created_at);
    CREATE INDEX IF NOT EXISTS entries_agent_idx ON entries(agent_id);
    CREATE INDEX IF NOT EXISTS chain_ops_tournament_idx ON chain_ops(tournament_id,created_at);
    CREATE INDEX IF NOT EXISTS tournaments_state_idx ON tournaments(state,created_at);
  `);
}

export async function withTx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
