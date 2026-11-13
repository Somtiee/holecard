import { useEffect, useState } from 'react';
import { ArrowRight, Award, Cpu, Dices, ExternalLink, Gift, KeyRound, Repeat, ShieldCheck, Wallet } from 'lucide-react';
import { depositToAgent, nearToYocto, withdrawFromAgent } from '../wallet/near';

export type NearConfig = {
  network: 'testnet' | 'mainnet';
  rpcUrl: string;
  explorer: string;
  contractId: string | null;
  models: string[];
  decisionPolicy: string;
  nearAiReady: boolean;
  nearReady: boolean;
  fundingSources: { id: string; label: string }[];
  intentsReady: boolean;
  fastAuth: { contractId: string; mpcContractId: string; clientId: string | null };
  sponsorNear: number;
  agentMarket: {
    enabled: boolean;
    lastPollAt: string | null;
    lastError: string | null;
    delivered: number;
    listing: string | null;
  };
  house: { enabled: boolean; maxEntryNear: string | null; agents: { name: string; strategy: string }[] };
  settlementVerifier: string | null;
};

export type AccessKey = {
  publicKey: string;
  role: string;
  permission: 'FullAccess' | { receiverId: string; methodNames: string[]; allowance: string | null };
};

export type AgentWallet = {
  trophies: { tokenId: string; balance: string }[];
  nearAccount: string;
  explorer: string;
  contractId: string;
  arenaBalanceNear: string;
  accountBalanceNear: string | null;
  accessKeys: AccessKey[];
  createTx: string | null;
  onchainRecord: { owner: string; tournaments: number; wins: number } | null;
};

export type Quote = {
  source: string;
  amountIn: string;
  amountInUsd: string;
  amountOut: string;
  timeEstimateSeconds: number;
  note: string;
};

export type Attestation = {
  model: string;
  nonce: string;
  checkedAt: string;
  nonceEchoed: boolean;
  modelSigners: string[];
  gatewaySigners: string[];
  gpu: { overallResult: boolean; nonceMatch: boolean | null; gpus: { key: string; hwmodel: string | null }[] } | null;
  intelQuotePresent: boolean;
  verified: boolean;
  notes: string[];
};

export type Receipt = {
  hand_number: number;
  agent: string;
  model: string;
  chat_id: string;
  signature_kind: string | null;
  signer: string | null;
  verified: boolean;
  detail: string | null;
};

export async function get<T>(path: string): Promise<T> {
  const r = await fetch(path, { credentials: 'same-origin' });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d as T;
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d as T;
}

export const shortId = (v: string | null | undefined, n = 8) =>
  v ? (v.length > 2 * n + 1 ? `${v.slice(0, n)}…${v.slice(-n + 2)}` : v) : '—';

const yoctoNear = (v: string) => {
  const b = BigInt(v);
  return `${b / 10n ** 24n}.${(b % 10n ** 24n).toString().padStart(24, '0').slice(0, 3)}`;
};

/** Agent account panel: arena balance, the two access keys (and what each may do), deposit/withdraw, Intents quote. */

export function AgentNearPanel({
  agentId,
  owned,
  config,
  notify,
}: {
  agentId: string;
  owned: boolean;
  config: NearConfig | null;
  notify: (m: string) => void;
}) {
  const [wallet, setWallet] = useState<AgentWallet | null>(null),
    [amount, setAmount] = useState('1'),
    [busy, setBusy] = useState(false),
    [source, setSource] = useState('usdc-base'),
    [quote, setQuote] = useState<Quote | null>(null);
  const load = () =>
    void get<AgentWallet>(`/api/agents/${agentId}/wallet`)
      .then(setWallet)
      .catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 8000);
    return () => clearInterval(t);
  }, [agentId]);
  const act = async (kind: 'deposit' | 'withdraw') => {
    if (!config?.contractId || !wallet) return;
    setBusy(true);
    try {
      const via = await (kind === 'deposit' ? depositToAgent : withdrawFromAgent)(
        config.network,
        config.contractId,
        wallet.nearAccount,
        amount,
      );
      notify(
        `${kind === 'deposit' ? 'Deposit confirmed onchain' : 'Withdrawal sent to your wallet'}${via === 'relayed' ? ' · gas paid by the arena relayer' : ''}.`,
      );
      load();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const sponsor = async () => {
    setBusy(true);
    try {
      await post(`/api/agents/${agentId}/sponsor`, {});
      notify(`Starter stake of ${config?.sponsorNear} testnet NEAR deposited by the arena.`);
      load();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const askQuote = async () => {
    setBusy(true);
    try {
      setQuote(await post<Quote>('/api/intents/quote', { source, amountYocto: nearToYocto(amount) }));
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!wallet)
    return (
      <section className="content-panel">
        <div className="panel-heading">
          <span>NEAR AGENT ACCOUNT</span>
          <Wallet size={18} />
        </div>
        <p>Loading account…</p>
      </section>
    );
  return (
    <section className="content-panel near-panel">
      <div className="panel-heading">
        <span>NEAR AGENT ACCOUNT</span>
        <Wallet size={18} />
      </div>
      <p>
        This agent is its own NEAR account, a sub-account of the arena contract. Its owner holds the full-access key;
        the arena server holds only a restricted key.
      </p>
      <div className="wallet-balance">
        <small>ARENA BALANCE (ESCROWED IN CONTRACT)</small>
        <strong>{wallet.arenaBalanceNear}</strong>
        <span>NEAR</span>
      </div>
      <div className="address-line">
        <span>{wallet.nearAccount}</span>
      </div>
      <a className="text-link" href={wallet.explorer} target="_blank" rel="noreferrer">
        VIEW ON NEARBLOCKS <ExternalLink size={16} />
      </a>
      {wallet.createTx && (
        <a className="text-link" href={wallet.createTx} target="_blank" rel="noreferrer">
          ACCOUNT CREATION TX <ExternalLink size={16} />
        </a>
      )}
      <div className="key-list">
        <small>
          <KeyRound size={13} /> ACCESS KEYS (READ FROM CHAIN)
        </small>
        {wallet.accessKeys.map(k => (
          <div className="key-row" key={k.publicKey}>
            <b>{k.role.toUpperCase()}</b>
            <code>{shortId(k.publicKey, 12)}</code>
            <span>
              {k.permission === 'FullAccess'
                ? 'Full access'
                : `Only ${k.permission.methodNames.join(', ')} on ${k.permission.receiverId}${k.permission.allowance ? ` · gas cap ${yoctoNear(k.permission.allowance)} NEAR` : ''} · cannot attach deposits`}
            </span>
          </div>
        ))}
      </div>
      {owned && (
        <>
          <div className="form-row">
            <input
              aria-label="Amount in NEAR"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="NEAR"
            />
            <button disabled={busy} onClick={() => void act('deposit')}>
              DEPOSIT <ArrowRight size={15} />
            </button>
            <button disabled={busy} onClick={() => void act('withdraw')}>
              WITHDRAW
            </button>
          </div>
          <p className="fund-hint">
            Deposit and withdraw are signed by your own wallet; when your wallet supports NEP-366 delegate actions the
            arena relayer pays the gas. Withdrawals always pay the owner account recorded in the contract.
          </p>
          {Boolean(config?.sponsorNear) && (
            <button className="quiet-link" disabled={busy} onClick={() => void sponsor()}>
              <Gift size={14} /> CLAIM {config?.sponsorNear} NEAR TESTNET STARTER STAKE
            </button>
          )}
        </>
      )}
      <div className="key-list">
        <small>
          <Award size={13} /> TROPHIES · NEP-245 (SOULBOUND)
        </small>
        {wallet.trophies.length ? (
          wallet.trophies.map(t => (
            <div className="key-row" key={t.tokenId}>
              <b>{t.tokenId.startsWith('trophy:') ? 'CHAMPION TROPHY' : t.tokenId.toUpperCase()}</b>
              <span>
                {t.tokenId.startsWith('trophy:') ? `Tournament ${t.tokenId.slice(7, 15)}…` : `× ${t.balance}`}
              </span>
            </div>
          ))
        ) : (
          <span className="fund-hint">
            Trophies are minted by the arena contract when this agent finishes in the money.
          </span>
        )}
      </div>
      <div className="intents-box">
        <small>
          <Repeat size={13} /> FUND FROM ANY CHAIN · NEAR INTENTS
        </small>
        <div className="form-row">
          <select value={source} onChange={e => setSource(e.target.value)}>
            {config?.fundingSources.map(s => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <button disabled={busy || !config?.intentsReady} onClick={() => void askQuote()}>
            QUOTE {amount} NEAR
          </button>
        </div>
        {!config?.intentsReady && (
          <p className="fund-hint">NEAR Intents quotes are turned off on this server.</p>
        )}
        {quote && (
          <div className="quote">
            <b>
              {quote.amountIn} {quote.source}
            </b>
            <span>
              ≈ ${Number(quote.amountInUsd).toFixed(2)} → {quote.amountOut} NEAR · ~{quote.timeEstimateSeconds}s
            </span>
            <small>{quote.note}</small>
          </div>
        )}
      </div>
    </section>
  );
}

/** Per-tournament privacy evidence: one signed TEE receipt per model decision. */

export function TeeReceiptsPanel({ tournamentId, policy }: { tournamentId: string; policy: string | undefined }) {
  const [rows, setRows] = useState<Receipt[]>([]);
  useEffect(() => {
    const load = () =>
      void get<Receipt[]>(`/api/tournaments/${tournamentId}/tee-receipts`)
        .then(setRows)
        .catch(() => {});
    load();
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 6000);
    return () => clearInterval(t);
  }, [tournamentId]);
  const verified = rows.filter(r => r.verified).length;
  return (
    <section className="content-panel tx-panel">
      <div className="panel-heading">
        <span>PRIVATE INFERENCE RECEIPTS</span>
        <span>{policy === 'fixture' ? 'FIXTURE POLICY (NO MODEL)' : `${verified}/${rows.length} TEE-SIGNED`}</span>
      </div>
      <p>
        Each decision prompt holds that agent's private hole cards. It is sent only to a NEAR AI Cloud model running in
        a TEE. The arena keeps the sha256 of the exact request and response, then checks the enclave's signature over
        them against the attested signing key. The prompt itself is not stored.
      </p>
      {rows.slice(0, 12).map((r, i) => (
        <div className="tx-row" key={`${r.chat_id}-${i}`}>
          <span className="tx-icon">
            <Cpu size={15} />
          </span>
          <div>
            <b>
              HAND {r.hand_number} · {r.agent}
            </b>
            <small>
              {r.model} · {shortId(r.chat_id, 10)}
            </small>
          </div>
          <span className={`tag ${r.verified ? 'mint' : ''}`}>
            {r.verified ? 'TEE VERIFIED' : r.detail ? 'UNVERIFIED' : 'CHECKING'}
          </span>
          <small title={r.detail || ''}>
            {r.signer ? `${r.signature_kind} ${shortId(r.signer, 6)}` : r.detail || ''}
          </small>
        </div>
      ))}
      {!rows.length && (
        <p>
          {policy === 'fixture'
            ? 'This arena runs the deterministic fixture policy, so no model is called.'
            : 'Receipts appear as soon as agents make decisions.'}
        </p>
      )}
    </section>
  );
}

/** Deck entropy: OutLayer VRF requested by the contract and verified with ed25519_verify onchain. */

export function RandomnessPanel({ tournamentId }: { tournamentId: string }) {
  const [r, setR] = useState<{ status: string; output_hex: string | null; alpha: string | null } | null | undefined>(
    undefined,
  );
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    void get<{ contract: { randomness_source?: unknown } | null }>('/api/health')
      .then(h => setConfigured(Boolean(h.contract?.randomness_source)))
      .catch(() => {});
  }, []);
  useEffect(() => {
    const load = () =>
      void get<{ randomness: typeof r } | null>(`/api/tournaments/${tournamentId}/onchain`)
        .then(t => setR(t?.randomness ?? null))
        .catch(() => {});
    load();
    const i = setInterval(() => {
      if (!document.hidden) load();
    }, 6000);
    return () => clearInterval(i);
  }, [tournamentId]);
  return (
    <section className="content-panel">
      <div className="panel-heading">
        <span>VERIFIABLE SHUFFLE</span>
        <Dices size={17} />
      </div>
      {r?.status === 'verified' ? (
        <>
          <span className="tag mint">VRF VERIFIED ONCHAIN</span>
          <p>
            OutLayer's TEE produced this value; the arena contract checked its Ed25519 proof before storing it. Every
            deck mixes it with the operator's pre-committed seed.
          </p>
          <div className="address-line">
            <span>{shortId(r.output_hex, 14)}</span>
          </div>
          <small>{r.alpha}</small>
        </>
      ) : r?.status === 'requested' ? (
        <p>Waiting for OutLayer to return verifiable randomness. Dealing starts once the contract verifies it.</p>
      ) : configured === false ? (
        <p>
          No OutLayer VRF source is set on this contract, so decks use only the operator's pre-committed seed (revealed
          and checked at settlement).
        </p>
      ) : (
        <p>Requested from OutLayer when the match starts. Deck entropy cannot be re-rolled once verified.</p>
      )}
    </section>
  );
}

type Verification = {
  handChecks: { handNumber: number; valid: boolean; seedMatches: boolean }[];
  engineReplayVerified: boolean;
  seedCommitmentMatches: boolean;
  onchain: {
    state: string;
    rosterHashMatches: boolean;
    seedCommitmentMatches: boolean;
    randomness: { status: string } | null;
    revealedSeedMatches: boolean | null;
    replayHashMatches: boolean | null;
    payouts: { agent: string; amount: string }[];
  } | null;
  teeReceipts: { total: number; verified: number };
  decisionPolicy: string;
  settlement: {
    verifierProject: string | null;
    verifiedByOutLayer: boolean;
    inFlight: boolean;
    lastRejection: string | null;
  };
};

const yoctoToNear = (y: string) => {
  const v = BigInt(y),
    whole = v / 10n ** 24n,
    frac = ((v % 10n ** 24n) / 10n ** 20n).toString().padStart(4, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
};

/** Every proof behind one tournament as a checklist anyone can re-run. */
export function SettlementPanel({ tournamentId, state }: { tournamentId: string; state: string }) {
  const [v, setV] = useState<Verification | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const run = () => {
    setBusy(true);
    setError('');
    void get<Verification>(`/api/tournaments/${tournamentId}/verification`)
      .then(setV)
      .catch(e => setError((e as Error).message))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    if (['settled', 'finalizing'].includes(state)) run();
  }, [tournamentId, state]);
  const hands = v?.handChecks.length ?? 0;
  const s = v?.settlement;
  const rows: [boolean | null, string][] = v
    ? [
        [v.onchain?.rosterHashMatches ?? null, 'Roster and strategies locked on NEAR before play'],
        [v.seedCommitmentMatches, 'Operator seed matches its pre-match commitment'],
        [
          v.onchain?.randomness ? v.onchain.randomness.status === 'verified' : null,
          'Shuffle entropy from OutLayer VRF, proof checked onchain',
        ],
        [
          hands ? v.engineReplayVerified : null,
          `${hands} hand${hands === 1 ? '' : 's'} replay to the same result here`,
        ],
        [
          v.teeReceipts.total ? v.teeReceipts.verified === v.teeReceipts.total : null,
          v.decisionPolicy === 'fixture'
            ? 'Decisions from the labelled fixture policy (no model)'
            : `${v.teeReceipts.verified}/${v.teeReceipts.total} model decisions carry a NEAR AI TEE signature`,
        ],
        [
          s?.verifiedByOutLayer ? true : s?.lastRejection ? false : null,
          s?.verifiedByOutLayer
            ? 'Payout released only after an OutLayer TEE replayed the match'
            : s?.inFlight
              ? 'OutLayer is replaying the match before payout'
              : s?.lastRejection
                ? `OutLayer replay rejected the result: ${s.lastRejection}`
                : s?.verifierProject
                  ? 'OutLayer replay runs when the match ends'
                  : 'Settled before replay verification was enabled',
        ],
      ]
    : [];
  return (
    <section className="content-panel verify-panel">
      <div className="panel-heading">
        <span>PROOF OF RESULT</span>
        <ShieldCheck size={17} />
      </div>
      {v ? (
        <ul className="checklist">
          {rows.map(([ok, label], n) => (
            <li
              key={label}
              className={ok === true ? 'pass' : ok === false ? 'fail' : 'wait'}
              style={{ '--n': n } as React.CSSProperties}
            >
              <i aria-hidden="true">{ok === true ? '✓' : ok === false ? '✕' : '·'}</i>
              {label}
            </li>
          ))}
        </ul>
      ) : (
        <p>
          Re-run every check behind this match: roster commitment, seed reveal, VRF proof, hand-by-hand replay, model
          signatures and the OutLayer settlement replay.
        </p>
      )}
      {v?.onchain?.payouts.length ? (
        <div className="payout-lines">
          <small>PAID BY THE CONTRACT</small>
          {v.onchain.payouts.map(p => (
            <div key={p.agent}>
              <span>{p.agent.split('.')[0]}</span>
              <b>{yoctoToNear(p.amount)} NEAR</b>
            </div>
          ))}
        </div>
      ) : null}
      {error && <p className="fund-hint">{error}</p>}
      <button className="quiet-link" disabled={busy} onClick={run}>
        {busy ? 'CHECKING…' : v ? 'RUN AGAIN' : 'RUN ALL CHECKS'} <ArrowRight size={15} />
      </button>
    </section>
  );
}

/** /near: what each NEAR integration does in this product, with live evidence. */
