import { pool, withTx } from '../db';
import { resolveCall, type PreparedCall } from './chain';

type Operation = { kind: string; tournamentId?: string; agentId?: string; signer: string; method: string };
type JournalRow = {
  state: string;
  tx_hash: string | null;
  signed_tx: string | null;
  sender_account: string | null;
  error: string | null;
};

/** The signed identity is committed before broadcast. Uncertain transactions are only ever retried byte for byte. */
export async function chainOp(key: string, meta: Operation, prepare: (lastNonce: bigint) => Promise<PreparedCall>) {
  const row = await withTx(async client => {
    // Serialize nonce allocation for a signer and journal ownership across processes.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`chain-signer:${meta.signer}`]);
    const existing = (await client.query<JournalRow>('SELECT * FROM chain_ops WHERE operation_key=$1', [key])).rows[0];
    if (existing) return existing;

    const {
      rows: [previous],
    } = await client.query<{ nonce: string | null }>(
      'SELECT max(tx_nonce)::text AS nonce FROM chain_ops WHERE signer=$1',
      [meta.signer],
    );
    const tx = await prepare(BigInt(previous.nonce ?? '0'));
    return (
      await client.query<JournalRow>(
        `INSERT INTO chain_ops(operation_key,kind,tournament_id,agent_id,signer,method,tx_hash,signed_tx,sender_account,tx_nonce)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          key,
          meta.kind,
          meta.tournamentId ?? null,
          meta.agentId ?? null,
          meta.signer,
          meta.method,
          tx.hash,
          tx.bytes,
          tx.sender,
          tx.nonce.toString(),
        ],
      )
    ).rows[0];
  });
  return resolveOperation(key, row);
}

export async function reconcileOperation(key: string) {
  const row = (await pool.query<JournalRow>('SELECT * FROM chain_ops WHERE operation_key=$1', [key])).rows[0];
  return row ? resolveOperation(key, row) : null;
}

async function resolveOperation(key: string, row: JournalRow) {
  if (row.state === 'confirmed') return { state: 'confirmed', txHash: row.tx_hash, value: null };
  if (row.state === 'failed' && row.sender_account) throw new Error(row.error || 'NEAR transaction failed');

  // Old uncertain operations have no immutable ID. A new payment requires operator reconciliation.
  if (!row.tx_hash || !row.signed_tx || !row.sender_account)
    return { state: 'pending', txHash: row.tx_hash, value: null };

  const outcome = await resolveCall({ hash: row.tx_hash, bytes: row.signed_tx, sender: row.sender_account });
  if (outcome.state === 'pending') return { state: 'pending', txHash: row.tx_hash, value: null };
  await pool.query(
    'UPDATE chain_ops SET state=$2,error=$3,signed_tx=NULL,updated_at=now() WHERE operation_key=$1 AND tx_hash=$4',
    [key, outcome.state, outcome.state === 'failed' ? outcome.error : null, row.tx_hash],
  );
  if (outcome.state === 'failed') throw new Error(outcome.error);
  return { state: 'confirmed', txHash: row.tx_hash, value: outcome.value };
}
