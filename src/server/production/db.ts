import pg from 'pg';

const {Pool}=pg;

export const pool=new Pool({connectionString:process.env.DATABASE_URL, max:10,
  ssl:process.env.DATABASE_SSL==='require'?{rejectUnauthorized:true}:undefined});

export async function migrate(){
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required for the production arena');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_challenges (
      address text PRIMARY KEY, nonce text NOT NULL, expires_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash text PRIMARY KEY, address text NOT NULL, expires_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS arena_agents (
      id uuid PRIMARY KEY, owner text NOT NULL, name text NOT NULL UNIQUE,
      strategy text NOT NULL, model text NOT NULL, description text NOT NULL,
      wallet_id text UNIQUE, wallet_address text UNIQUE, wallet_key uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS arena_agents_owner_idx ON arena_agents(owner);
    CREATE TABLE IF NOT EXISTS arena_tournaments (
      id uuid PRIMARY KEY, creator text NOT NULL, name text NOT NULL,
      entry_micro bigint NOT NULL CHECK (entry_micro > 0),
      starting_stack integer NOT NULL CHECK (starting_stack BETWEEN 100 AND 1000000),
      capacity integer NOT NULL CHECK (capacity BETWEEN 2 AND 9),
      duration_seconds integer NOT NULL CHECK (duration_seconds BETWEEN 300 AND 86400),
      shares jsonb NOT NULL, state text NOT NULL,
      seed_secret text NOT NULL, seed_commitment text NOT NULL,
      rules_hash text, roster_root text, contract_address text,
      closes_at timestamptz, started_at timestamptz, ended_at timestamptz,
      hand_number integer NOT NULL DEFAULT 0, button integer NOT NULL DEFAULT 0,
      blind_level integer NOT NULL DEFAULT 1,
      stacks jsonb NOT NULL DEFAULT '{}'::jsonb,
      history jsonb NOT NULL DEFAULT '[]'::jsonb,
      result_hash text, replay_hash text, ranking jsonb, winner_id uuid,
      claims_complete boolean NOT NULL DEFAULT false, refunds_complete boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS arena_entries (
      tournament_id uuid NOT NULL REFERENCES arena_tournaments(id),
      agent_id uuid NOT NULL REFERENCES arena_agents(id),
      owner text NOT NULL, config_hash text NOT NULL,
      state text NOT NULL DEFAULT 'reserved',
      proof jsonb NOT NULL DEFAULT '[]'::jsonb,
      PRIMARY KEY(tournament_id,agent_id), UNIQUE(tournament_id,owner)
    );
    CREATE TABLE IF NOT EXISTS arc_operations (
      id uuid PRIMARY KEY, operation_key text NOT NULL UNIQUE,
      kind text NOT NULL, tournament_id uuid REFERENCES arena_tournaments(id),
      agent_id uuid REFERENCES arena_agents(id),
      wallet_id text NOT NULL, call jsonb NOT NULL, expected jsonb NOT NULL,
      contract_address text NOT NULL, circle_id text, tx_hash text,
      state text NOT NULL DEFAULT 'prepared', error text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS arc_operations_pending_idx ON arc_operations(state) WHERE state IN ('prepared','submitted');
    ALTER TABLE arena_tournaments ADD COLUMN IF NOT EXISTS ranking jsonb;
    ALTER TABLE arena_tournaments ADD COLUMN IF NOT EXISTS winner_id uuid;
    ALTER TABLE arena_tournaments ADD COLUMN IF NOT EXISTS claims_complete boolean NOT NULL DEFAULT false;
    ALTER TABLE arena_tournaments ADD COLUMN IF NOT EXISTS refunds_complete boolean NOT NULL DEFAULT false;
    ALTER TABLE arena_agents ADD COLUMN IF NOT EXISTS identity_token_id text;
    ALTER TABLE arena_agents ADD COLUMN IF NOT EXISTS identity_tx_hash text;
    ALTER TABLE arena_agents ADD COLUMN IF NOT EXISTS identity_registry text;
    ALTER TABLE arc_operations ADD COLUMN IF NOT EXISTS gas_native numeric(78,0);
    ALTER TABLE arc_operations ADD COLUMN IF NOT EXISTS block_number bigint;
    CREATE TABLE IF NOT EXISTS arc_indexer (
      name text PRIMARY KEY, next_block bigint NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS arc_transfers (
      tx_hash text NOT NULL, log_index integer NOT NULL, block_number bigint NOT NULL,
      sender text NOT NULL, recipient text NOT NULL, amount_native numeric(78,0) NOT NULL,
      gas_native numeric(78,0) NOT NULL, gas_payer text NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tx_hash,log_index)
    );
    CREATE INDEX IF NOT EXISTS arc_transfers_recipient_idx ON arc_transfers(recipient,block_number DESC);
    CREATE INDEX IF NOT EXISTS arc_transfers_sender_idx ON arc_transfers(sender,block_number DESC);
  `);
}

export async function withTx<T>(fn:(client:pg.PoolClient)=>Promise<T>):Promise<T>{
  const client=await pool.connect();
  try{await client.query('BEGIN');const value=await fn(client);await client.query('COMMIT');return value;}
  catch(error){await client.query('ROLLBACK');throw error;}
  finally{client.release();}
}
