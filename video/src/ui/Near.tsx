import React from 'react';
import { ArrowRight, ArrowUpRight, Award, ChevronLeft, Cpu, Dices, ExternalLink, Gift, KeyRound, Repeat, ShieldCheck, Trophy, Wallet } from 'lucide-react';
import real from '../data/real.json';

/* Markup copies of src/ui/components/NearPanels.tsx and the agent page, driven by props instead of fetches. */

export const shortId = (v: string | null | undefined, n = 8) => (v ? (v.length > 2 * n + 1 ? `${v.slice(0, n)}…${v.slice(-n + 2)}` : v) : '—');
/** lib/api.ts `short` */
export const shortApi = (value: string | null | undefined) => (value ? `${value.slice(0, 7)}…${value.slice(-5)}` : '—');
const yoctoNear = (v: string) => {
  const b = BigInt(v);
  return `${b / 10n ** 24n}.${(b % 10n ** 24n).toString().padStart(24, '0').slice(0, 3)}`;
};
export const yoctoToNear = (y: string) => {
  const v = BigInt(y),
    whole = v / 10n ** 24n,
    frac = ((v % 10n ** 24n) / 10n ** 20n).toString().padStart(4, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
};

export function Tag({ children, tone = '' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`tag ${tone}`}>{children}</span>;
}

type Wallet = Omit<typeof real.wallets.nightowl, "trophies"> & { trophies: { tokenId: string; balance: string }[] };
type Key = Wallet['accessKeys'][number];

export function AgentHero({ name, account, strategy, model, owner, house, rating = 1200, stats }: { name: string; account: string; strategy: string; model: string; owner?: string; house?: boolean; rating?: number; stats?: (string | number)[] }) {
  const s = stats ?? [0, 0, '0.0%', '0 NEAR', '0.0%', 0];
  return (
    <>
      <button className="back-link">
        <ChevronLeft size={15} /> all_agents
      </button>
      <div className="agent-hero">
        <div className="agent-emblem giant">{name[0]}</div>
        <div>
          <small>AGENT PROFILE / {account}</small>
          <h1>{name}</h1>
          <p>No strategy notes published.</p>
          <div className="agent-tags">
            <Tag>{strategy.toUpperCase()}</Tag>
            <Tag>{model}</Tag>
            <Tag tone="mint">NEAR ACCOUNT</Tag>
            {house ? <Tag tone="house">HOUSE AGENT</Tag> : <Tag>OWNER {owner}</Tag>}
          </div>
        </div>
        <div className="rep-score">
          <small>SKILL RATING</small>
          <strong>{rating}</strong>
          <span>ELO · STARTS AT 1200</span>
        </div>
      </div>
      <div className="profile-stats">
        {['TOURNAMENTS', 'WINS', 'WIN RATE', 'NET PROFIT', 'ROI', 'HANDS'].map((label, i) => (
          <div key={label}>
            <small>{label}</small>
            <strong>{s[i]}</strong>
          </div>
        ))}
      </div>
    </>
  );
}

export function AgentNearPanel({
  wallet,
  balance,
  keysShown = 99,
  keyFlash = -1,
  owned = true,
  amount = '1',
  quote,
  trophiesShown = 99,
  pressed,
}: {
  wallet: Wallet;
  balance: string;
  keysShown?: number;
  keyFlash?: number;
  owned?: boolean;
  amount?: string;
  quote?: typeof real.quote | null;
  trophiesShown?: number;
  pressed?: string;
}) {
  const press = (k: string): React.CSSProperties => (pressed === k ? { transform: 'scale(0.96)' } : {});
  return (
    <section className="content-panel near-panel" data-cam="nearPanel">
      <div className="panel-heading">
        <span>NEAR AGENT ACCOUNT</span>
        <Wallet size={18} />
      </div>
      <p>
        This agent is its own NEAR account, a sub-account of the arena contract. Its owner holds the full-access key; the
        arena server holds only a restricted key.
      </p>
      <div className="wallet-balance" data-cam="balance">
        <small>ARENA BALANCE (ESCROWED IN CONTRACT)</small>
        <strong>{balance}</strong>
        <span>NEAR</span>
      </div>
      <div className="address-line" data-cam="address">
        <span>{wallet.nearAccount}</span>
      </div>
      <a className="text-link">
        VIEW ON NEARBLOCKS <ExternalLink size={16} />
      </a>
      {wallet.createTx && (
        <a className="text-link" data-cam="createTx">
          ACCOUNT CREATION TX <ExternalLink size={16} />
        </a>
      )}
      <div className="key-list" data-cam="keys">
        <small>
          <KeyRound size={13} /> ACCESS KEYS (READ FROM CHAIN)
        </small>
        {wallet.accessKeys.map((k: Key, i) => {
          const perm = k.permission as Key['permission'];
          return (
            <div
              className="key-row"
              key={k.publicKey}
              data-cam={perm === 'FullAccess' ? 'ownerKey' : 'serverKey'}
              style={{
                opacity: i < keysShown ? 1 : 0,
                background: keyFlash === i ? 'rgba(28,199,68,0.12)' : undefined,
              }}
            >
              <b>{k.role.toUpperCase()}</b>
              <code>{shortId(k.publicKey, 12)}</code>
              <span data-cam={perm === 'FullAccess' ? undefined : 'restricted'}>
                {perm === 'FullAccess'
                  ? 'Full access'
                  : `Only ${(perm as { methodNames: string[] }).methodNames.join(', ')} on ${(perm as { receiverId: string }).receiverId}${(perm as { allowance: string | null }).allowance ? ` · gas cap ${yoctoNear((perm as { allowance: string }).allowance)} NEAR` : ''} · cannot attach deposits`}
              </span>
            </div>
          );
        })}
      </div>
      {owned && (
        <>
          <div className="form-row" data-cam="fundRow">
            <input aria-label="Amount in NEAR" value={amount} readOnly placeholder="NEAR" />
            <button data-cam="deposit" style={press('deposit')}>
              DEPOSIT <ArrowRight size={15} />
            </button>
            <button data-cam="withdraw" style={press('withdraw')}>
              WITHDRAW
            </button>
          </div>
          <p className="fund-hint">
            Deposit and withdraw are signed by your own wallet; when your wallet supports NEP-366 delegate actions the
            arena relayer pays the gas. Withdrawals always pay the owner account recorded in the contract.
          </p>
          <button className="quiet-link" data-cam="claim" style={press('claim')}>
            <Gift size={14} /> CLAIM 1 NEAR TESTNET STARTER STAKE
          </button>
        </>
      )}
      <div className="key-list" data-cam="trophies">
        <small>
          <Award size={13} /> TROPHIES · NEP-245 (SOULBOUND)
        </small>
        {wallet.trophies.length ? (
          wallet.trophies.map((t, i) => (
            <div className="key-row" key={t.tokenId} data-cam={`trophy-${i}`} style={{ opacity: i < trophiesShown ? 1 : 0 }}>
              <b>{t.tokenId.startsWith('trophy:') ? 'CHAMPION TROPHY' : t.tokenId.toUpperCase()}</b>
              <span>{t.tokenId.startsWith('trophy:') ? `Tournament ${t.tokenId.slice(7, 15)}…` : `× ${t.balance}`}</span>
            </div>
          ))
        ) : (
          <span className="fund-hint">Trophies are minted by the arena contract when this agent finishes in the money.</span>
        )}
      </div>
      <div className="intents-box" data-cam="intents">
        <small>
          <Repeat size={13} /> FUND FROM ANY CHAIN · NEAR INTENTS
        </small>
        <div className="form-row">
          <select value="usdc-base" onChange={() => {}}>
            {real.quote && <option value="usdc-base">USDC on Base</option>}
          </select>
          <button data-cam="quoteBtn" style={press('quote')}>
            QUOTE {amount} NEAR
          </button>
        </div>
        {quote && (
          <div className="quote" data-cam="quote">
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

export function HistoryPanel({ rows }: { rows: { name: string; state: string; hands: number; champion?: boolean }[] }) {
  return (
    <section className="content-panel">
      <div className="panel-heading">
        <span>TOURNAMENT HISTORY</span>
        <Trophy size={18} />
      </div>
      {rows.map(r => (
        <button className="history-row" key={r.name}>
          <span>
            <b>{r.name}</b>
            <small>
              {r.state.toUpperCase()} · {r.hands} HANDS
            </small>
          </span>
          <strong>
            {r.champion ? 'CHAMPION' : 'VIEW MATCH'} <ArrowUpRight size={15} />
          </strong>
        </button>
      ))}
      {!rows.length && (
        <div className="empty-state">
          <span aria-hidden="true" />
          <p>This agent has not entered an arena yet.</p>
        </div>
      )}
    </section>
  );
}

/* ---------- tournament panels ---------- */

export type Receipt = (typeof real.receipts)[number];

export function TeeReceiptsPanel({ rows, total, verified }: { rows: Receipt[]; total: number; verified: number }) {
  return (
    <section className="content-panel tx-panel" data-cam="receipts">
      <div className="panel-heading">
        <span>PRIVATE INFERENCE RECEIPTS</span>
        <span data-cam="receiptsCount">{`${verified}/${total} TEE-SIGNED`}</span>
      </div>
      <p>
        Each decision prompt holds that agent's private hole cards. It is sent only to a NEAR AI Cloud model running in a
        TEE. The arena keeps the sha256 of the exact request and response, then checks the enclave's signature over them
        against the attested signing key. The prompt itself is not stored.
      </p>
      {rows.slice(0, 12).map((r, i) => (
        <div className="tx-row" key={`${r.chat}-${i}`} data-cam={`receipt-${i}`}>
          <span className="tx-icon">
            <Cpu size={15} />
          </span>
          <div>
            <b>
              HAND {r.hand} · {r.agent}
            </b>
            <small>
              {r.model} · {shortId(r.chat, 10)}
            </small>
          </div>
          <span className={`tag ${r.verified ? 'mint' : ''}`}>{r.verified ? 'TEE VERIFIED' : 'CHECKING'}</span>
          <small>{r.signer ? `${r.kind} ${shortId(r.signer, 6)}` : ''}</small>
        </div>
      ))}
    </section>
  );
}

export function RandomnessPanel({ verified }: { verified: boolean }) {
  const r = real.match.randomness;
  return (
    <section className="content-panel" data-cam="shuffle">
      <div className="panel-heading">
        <span>VERIFIABLE SHUFFLE</span>
        <Dices size={17} />
      </div>
      {verified ? (
        <>
          <span className="tag mint" data-cam="vrfTag">
            VRF VERIFIED ONCHAIN
          </span>
          <p>
            OutLayer's TEE produced this value; the arena contract checked its Ed25519 proof before storing it. Every deck
            mixes it with the operator's pre-committed seed.
          </p>
          <div className="address-line" data-cam="vrfOut">
            <span>{shortId(r.output_hex, 14)}</span>
          </div>
          <small>{r.alpha}</small>
        </>
      ) : (
        <p>Waiting for OutLayer to return verifiable randomness. Dealing starts once the contract verifies it.</p>
      )}
    </section>
  );
}

export function EvidencePanel({ locked, settled }: { locked: boolean; settled?: boolean }) {
  const m = real.match;
  return (
    <section className="content-panel evidence-panel" data-cam="evidence">
      <div className="panel-heading">
        <span>VERIFICATION</span>
        <ShieldCheck size={17} />
      </div>
      <div>
        <small>ECONOMIC STATE</small>
        <b>{locked ? 'ROSTER LOCKED ON NEAR' : 'ROSTER OPEN'}</b>
        {locked && (
          <a>
            agent-arena-ad7b13.testnet <ExternalLink size={14} />
          </a>
        )}
      </div>
      <div data-cam="seedCommit">
        <small>SEED COMMITMENT</small>
        <b>{shortApi(locked ? m.seedCommitment : null)}</b>
      </div>
      <div>
        <small>GAME RESULT</small>
        <b>{settled ? shortApi(m.resultHash) : 'NOT FINALIZED'}</b>
      </div>
      <div data-cam="rosterHash">
        <small>ROSTER HASH</small>
        <b>{shortApi(locked ? m.rosterHash : null)}</b>
      </div>
      <p>
        The NEAR contract holds every entry fee, freezes prize shares and commitments, and pays out or refunds to the exact
        yoctoNEAR. It releases prizes only after an OutLayer TEE replays the match and reaches the same ranking.
      </p>
    </section>
  );
}

export const PROOF_ROWS = [
  'Roster and strategies locked on NEAR before play',
  'Operator seed matches its pre-match commitment',
  'Shuffle entropy from OutLayer VRF, proof checked onchain',
  `${real.match.hands} hands replay to the same result here`,
  `${real.receipts.filter(r => r.verified).length}/${real.receipts.length} model decisions carry a NEAR AI TEE signature`,
  'Payout released only after an OutLayer TEE replayed the match',
];

export function SettlementPanel({ ticked, paid, button }: { ticked: number | null; paid: number; button: string }) {
  return (
    <section className="content-panel verify-panel" data-cam="proof">
      <div className="panel-heading">
        <span>PROOF OF RESULT</span>
        <ShieldCheck size={17} />
      </div>
      {ticked === null ? (
        <p>
          Re-run every check behind this match: roster commitment, seed reveal, VRF proof, hand-by-hand replay, model
          signatures and the OutLayer settlement replay.
        </p>
      ) : (
        <ul className="checklist">
          {PROOF_ROWS.map((label, n) => {
            const ok = n < ticked;
            return (
              <li key={label} className={ok ? 'pass' : 'wait'} data-cam={`proof-${n}`}>
                <i aria-hidden="true">{ok ? '✓' : '·'}</i>
                {label}
              </li>
            );
          })}
        </ul>
      )}
      {paid > 0 && (
        <div className="payout-lines" data-cam="paid">
          <small>PAID BY THE CONTRACT</small>
          {real.match.payouts.slice(0, paid).map(p => (
            <div key={p.agent}>
              <span>{p.agent.split('.')[0]}</span>
              <b>{yoctoToNear(p.amount)} NEAR</b>
            </div>
          ))}
        </div>
      )}
      <button className="quiet-link" data-cam="runChecks">
        {button} <ArrowRight size={15} />
      </button>
    </section>
  );
}

export type Op = (typeof real.ops)[number];

export function TxPanel({ ops, highlight }: { ops: Op[]; highlight?: string }) {
  return (
    <section className="content-panel tx-panel" data-cam="txs">
      <div className="panel-heading">
        <span>NEAR TRANSACTIONS</span>
        <span>FINAL ON NEAR</span>
      </div>
      {ops.length ? (
        ops.map((op, i) => (
          <div className="tx-row" key={`${op.method}-${i}`} data-cam={`tx-${op.method}-${i}`} style={highlight === op.tx ? { background: 'rgba(28,199,68,0.1)' } : undefined}>
            <span className="tx-icon">✦</span>
            <div>
              <b>{op.method.toUpperCase()}</b>
              <small>SIGNED BY {op.signer === 'operator' ? 'ARENA OPERATOR' : op.signer}</small>
            </div>
            <Tag tone={op.state === 'confirmed' ? 'mint' : ''}>{op.state.toUpperCase()}</Tag>
            <a data-cam={`txlink-${op.method}`}>
              {shortApi(op.tx)} <ExternalLink size={15} />
            </a>
          </div>
        ))
      ) : (
        <div className="empty-state">
          <span aria-hidden="true" />
          <p>NEAR transactions appear after the roster is locked onchain.</p>
        </div>
      )}
    </section>
  );
}
