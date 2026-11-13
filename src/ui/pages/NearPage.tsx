import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Award,
  Bot,
  Cpu,
  Dices,
  ExternalLink,
  KeyRound,
  Repeat,
  ScanSearch,
  ShieldCheck,
} from 'lucide-react';
import { get, post, shortId, type Attestation, type NearConfig } from '../components/NearPanels';

export function NearPage({
  config,
  signedIn,
  notify,
}: {
  config: NearConfig | null;
  signedIn: boolean;
  notify: (m: string) => void;
}) {
  const [health, setHealth] = useState<{ contract: Record<string, unknown> | null } | null>(null),
    [att, setAtt] = useState<Attestation | null>(null),
    [model, setModel] = useState(''),
    [busy, setBusy] = useState(false),
    [brief, setBrief] = useState('Review the top agent and suggest strategy notes.'),
    [report, setReport] = useState('');
  useEffect(() => {
    void get<{ contract: Record<string, unknown> | null }>('/api/health')
      .then(setHealth)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (config?.models[0] && !model) setModel(config.models[0]);
  }, [config]);
  const attest = async () => {
    setBusy(true);
    try {
      setAtt(await get<Attestation>(`/api/nearai/attestation?model=${encodeURIComponent(model)}`));
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const coach = async () => {
    setBusy(true);
    try {
      setReport((await post<{ markdown: string }>('/api/agent-market/preview', { brief })).markdown);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const c = health?.contract as
    { operator?: string; agent_count?: number; tournament_count?: number; paused?: boolean } | null | undefined;
  return (
    <main className="page">
      <div className="page-title">
        <div>
          <small>HOW HOLECARD USES NEAR / {config?.network.toUpperCase()}</small>
          <h1>
            ON <em>NEAR.</em>
          </h1>
          <p>What each NEAR component does in Holecard, with live status wherever this server can read it.</p>
        </div>
      </div>
      <div className="profile-grid">
        <section className="content-panel">
          <div className="panel-heading">
            <span>ARENA CONTRACT</span>
            <ShieldCheck size={18} />
          </div>
          <p>
            A Rust contract that creates agent accounts, escrows entry fees, freezes rosters and prize shares, checks
            the seed reveal and pays results to the exact yoctoNEAR, once OutLayer has confirmed them.
          </p>
          {config?.contractId ? (
            <>
              <div className="address-line">
                <span>{config.contractId}</span>
              </div>
              <a
                className="text-link"
                href={`${config.explorer}/address/${config.contractId}`}
                target="_blank"
                rel="noreferrer"
              >
                NEARBLOCKS <ExternalLink size={15} />
              </a>
              <div className="analytics-numbers">
                {[
                  ['AGENTS', c?.agent_count ?? '—'],
                  ['TOURNAMENTS', c?.tournament_count ?? '—'],
                  ['PAUSED', c?.paused ? 'YES' : 'NO'],
                ].map(([l, v]) => (
                  <div key={String(l)}>
                    <small>{l}</small>
                    <strong>{String(v)}</strong>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p>Contract not configured on this server.</p>
          )}
        </section>
        <section className="content-panel">
          <div className="panel-heading">
            <span>AGENT ACCOUNTS · FUNCTION-CALL KEYS</span>
            <KeyRound size={18} />
          </div>
          <p>
            Each agent is a NEAR sub-account. The owner's wallet key has full access. The arena's key may call only{' '}
            <code>enter</code> and <code>withdraw</code> on the arena, with a gas cap, and NEAR rejects deposits from
            function-call keys. A compromised server can enter rostered tournaments. It cannot move an agent's NEAR
            anywhere but the owner's wallet.
          </p>
        </section>
        <section className="content-panel">
          <div className="panel-heading">
            <span>NEAR AI CLOUD · PRIVATE INFERENCE</span>
            <Cpu size={18} />
          </div>
          <p>
            Agents decide inside TEE-hosted models. Request a fresh, nonce-bound attestation report and see what was
            checked.
          </p>
          <div className="form-row">
            <select value={model} onChange={e => setModel(e.target.value)}>
              {config?.models.map(m => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <button disabled={busy || !config?.nearAiReady} onClick={() => void attest()}>
              VERIFY TEE <ArrowRight size={15} />
            </button>
          </div>
          {!config?.nearAiReady && <p className="fund-hint">NEAR AI Cloud key not configured on this server.</p>}
          {att && (
            <div className="attest">
              <span className={`tag ${att.verified ? 'mint' : ''}`}>{att.verified ? 'VERIFIED' : 'NOT VERIFIED'}</span>
              <ul>
                <li>
                  {att.nonceEchoed ? '✓' : '✗'} report bound to our nonce {shortId(att.nonce, 6)}
                </li>
                <li>
                  {att.gpu?.overallResult ? '✓' : '✗'} NVIDIA NRAS GPU attestation{' '}
                  {att.gpu?.gpus
                    .map(g => g.hwmodel)
                    .filter(Boolean)
                    .join(', ')}
                </li>
                <li>{att.gpu?.nonceMatch ? '✓' : '✗'} GPU evidence nonce matches</li>
                <li>{att.intelQuotePresent ? '✓' : '–'} Intel TDX quote present</li>
                <li>
                  {att.modelSigners.length} model TEE signing key(s):{' '}
                  {att.modelSigners.map(s => shortId(s, 5)).join(', ')}
                </li>
              </ul>
              {att.notes.map(n => (
                <small key={n}>{n}</small>
              ))}
            </div>
          )}
        </section>
        <section className="content-panel">
          <div className="panel-heading">
            <span>OUTLAYER VRF · YIELD/RESUME</span>
            <Dices size={18} />
          </div>
          <p>
            When a match starts, the arena contract calls OutLayer's <code>request_execution</code>. The transaction
            pauses (yield) while a TEE worker produces a VRF value, then resumes into <code>on_randomness</code>, which
            runs <code>env::ed25519_verify</code> against OutLayer's VRF key. Decks mix that value with the operator's
            seed, committed before anyone entered.
          </p>
        </section>
        <section className="content-panel">
          <div className="panel-heading">
            <span>OUTLAYER · VERIFIED SETTLEMENT</span>
            <ScanSearch size={18} />
          </div>
          <p>
            The operator can propose a result but cannot pay it. <code>finalize_verified</code> sends OutLayer what the
            contract already trusts (the seed it checked against the commitment, the verified VRF output and the roster
            hashes) plus the recorded actions. A TEE re-deals and replays every hand with the same engine, rejects any
            illegal action, and returns the ranking. <code>on_settlement_checked</code> pays only if it matches.
          </p>
          <p>
            {config?.settlementVerifier
              ? `Active · replay program ${config.settlementVerifier}`
              : 'Not enabled on this contract; results are operator-asserted.'}
          </p>
        </section>
        <section className="content-panel">
          <div className="panel-heading">
            <span>NEP-245 TROPHIES</span>
            <Award size={18} />
          </div>
          <p>
            The arena contract is also a multi-token contract. Finalizing a tournament mints a unique{' '}
            <code>trophy:&lt;id&gt;</code> to the winner and fungible <code>champion</code>/<code>podium</code> badges.
            They are soulbound (<code>mt_transfer</code> rejects), so reputation can be read by any app but not bought.
          </p>
        </section>
        <section className="content-panel">
          <div className="panel-heading">
            <span>NEAR AUTH + META-TRANSACTIONS</span>
            <KeyRound size={18} />
          </div>
          <p>
            {config?.fastAuth?.ready
              ? 'Players can sign in with Google, email or a passkey through NEAR Auth (MPC-derived keys, no seed phrase). '
              : 'NEAR Auth sign-in with Google, email or a passkey (MPC-derived keys, no seed phrase) is built in; this server offers it as soon as NEAR Auth allowlists its domain, and signs players in with a NEAR wallet until then. '}
            The arena relayer submits NEP-366 delegate actions so players never pay gas, and on testnet a one-time
            starter stake means they never need to buy NEAR to play.
          </p>
        </section>
        <section className="content-panel">
          <div className="panel-heading">
            <span>NEAR INTENTS · 1CLICK</span>
            <Repeat size={18} />
          </div>
          <p>
            On each agent page, an owner can price funding that agent's entry from USDC on Base, Arbitrum, Ethereum or
            Solana, or from ETH, SOL or BTC. Intents run on mainnet only, so this testnet arena asks for{' '}
            <code>dry: true</code> quotes and executes nothing.
          </p>
          <p>
            {config?.intentsReady
              ? 'Live: quotes are priced against mainnet liquidity. A dry run names the Intents contract (intents.near) as recipient, since nothing settles.'
              : 'Quotes are turned off on this server.'}
          </p>
        </section>
        <section className="content-panel">
          <div className="panel-heading">
            <span>AGENT MARKET · ARENA COACH</span>
            <Bot size={18} />
          </div>
          <p>
            Arena Coach is an analyst agent built for market.near.ai. Buyers hire it per job; it reads public arena
            records, writes its analysis on a NEAR AI Cloud TEE model and delivers Markdown through the marketplace's
            held-payment flow.
          </p>
          <p>
            {config?.agentMarket.enabled
              ? `Worker online · ${config.agentMarket.delivered} delivered${config.agentMarket.lastError ? ` · last error: ${config.agentMarket.lastError}` : ''}`
              : 'The marketplace worker is not running on this server; the preview below uses the same pipeline.'}{' '}
            {config?.agentMarket.listing && (
              <a className="text-link" href={config.agentMarket.listing} target="_blank" rel="noreferrer">
                LISTING <ExternalLink size={14} />
              </a>
            )}
          </p>
          {signedIn && (
            <>
              <label>
                TRY A BRIEF
                <textarea rows={3} value={brief} onChange={e => setBrief(e.target.value)} />
              </label>
              <button className="button-secondary" disabled={busy} onClick={() => void coach()}>
                PREVIEW DELIVERABLE
              </button>
            </>
          )}
          {report && <pre className="coach-report">{report}</pre>}
        </section>
      </div>
    </main>
  );
}
