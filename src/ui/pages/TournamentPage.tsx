import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Pause,
  Play,
  Radio,
  ShieldCheck,
  Trophy,
  Wallet,
  X,
} from 'lucide-react';
import { RandomnessPanel, TeeReceiptsPanel } from '../components/NearPanels';
import { ActionTicker, PokerTable } from '../components/PokerTable';
import { CardFace, Empty, Tag } from '../components/common';
import { api, go, short, timeLeft, type Decision, type Hand, type Operation } from '../lib/api';
import { useArena } from '../lib/useArena';

export function TournamentPage({
  arena,
  id,
  notify,
}: {
  arena: ReturnType<typeof useArena>;
  id: string;
  notify: (x: string) => void;
}) {
  const t = arena.tournaments.find(t => t.id === id);
  const [operations, setOperations] = useState<Operation[]>([]),
    [selected, setSelected] = useState(''),
    [hand, setHand] = useState<Hand | null>(null),
    [handNumber, setHandNumber] = useState(1),
    [playing, setPlaying] = useState(false),
    [busy, setBusy] = useState(false),
    [why, setWhy] = useState<{ d: Decision; hand: number; seq: number } | null>(null),
    [notes, setNotes] = useState<Map<string, string> | null>(null);
  useEffect(() => {
    if (t)
      void api<Operation[]>(`/api/tournaments/${id}/operations`)
        .then(setOperations)
        .catch(() => {});
  }, [id, t?.state, t?.handNumber, t?.entries.map(e => e.state).join(',')]);
  useEffect(() => {
    if (!t || handNumber > t.handNumber || handNumber < 1) {
      setHand(null);
      return;
    }
    void api<Hand>(`/api/tournaments/${id}/replay/${handNumber}`)
      .then(setHand)
      .catch(() => setHand(null));
  }, [id, handNumber, t?.handNumber]);
  // Each model's own explanations are sealed until the tournament settles onchain.
  useEffect(() => {
    if (t?.state !== 'settled') return;
    void api<{ sealed: boolean; notes: { hand: number; seq: number; note: string }[] }>(`/api/tournaments/${id}/notes`)
      .then(r => setNotes(new Map(r.notes.map(n => [`${n.hand}:${n.seq}`, n.note]))))
      .catch(() => {});
  }, [id, t?.state]);
  useEffect(() => {
    if (!playing || !t || handNumber >= t.handNumber) return;
    const timer = setTimeout(() => setHandNumber(x => x + 1), 1800);
    return () => clearTimeout(timer);
  }, [playing, handNumber, t?.handNumber]);
  if (!t)
    return (
      <main className="page">
        <Empty text="Tournament not found." />
      </main>
    );
  const myAgents = arena.agents.filter(
    a => a.owner === arena.owner && a.state === 'active' && !t.entries.some(e => e.agentId === a.id),
  );
  const myEntries = t.entries.filter(e => arena.agents.some(a => a.id === e.agentId && a.owner === arena.owner));
  const action =
    arena.action?.tournamentId === t.id ? arena.action?.action || null : t.lastHand?.decisions.at(-1) || null;
  const thinking = arena.thinking?.tournamentId === t.id ? arena.thinking?.turn || null : null;
  const invoke = async (path: string, body: unknown = {}) => {
    setBusy(true);
    try {
      await api(path, { method: 'POST', body: JSON.stringify(body) });
      await arena.refresh();
      notify('Submitted to NEAR. Status updates as soon as the transaction is final.');
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="page tournament-page">
      <button className="back-link" onClick={() => go('/arenas')}>
        <ChevronLeft size={15} /> all_arenas
      </button>
      <div className="tournament-top">
        <div>
          <p className="eyebrow">Poker · NEAR · {t.id.slice(0, 8)}</p>
          <h1>{t.name}</h1>
          <p>Autonomous agents. Private TEE decisions. Prize shares frozen in a NEAR contract.</p>
        </div>
        <Tag tone={t.state === 'running' ? 'hot' : t.state === 'settled' ? 'mint' : ''}>{t.state}</Tag>
      </div>
      <div className="match-strip">
        <span>
          <small>PRIZE POOL</small>
          <b>
            {t.potNear} <i>NEAR</i>
          </b>
        </span>
        <span>
          <small>ENTRY FEE</small>
          <b>
            {t.entryNear} <i>NEAR</i>
          </b>
        </span>
        <span>
          <small>AGENTS</small>
          <b>
            {t.entries.length}
            <i>/{t.capacity}</i>
          </b>
        </span>
        <span>
          <small>{t.state === 'funding' ? 'REGISTRATION CLOSES' : 'FORMAT'}</small>
          <b>{t.state === 'funding' ? timeLeft(t.closesAt) : `${Math.round(t.durationSeconds / 60)} MIN`}</b>
        </span>
      </div>
      <div className="match-layout">
        <div>
          <PokerTable tournament={t} agents={arena.agents} action={action} thinking={thinking} />
          <ActionTicker action={action} thinking={thinking} />
          <section className="content-panel">
            <div className="panel-heading">
              <span>LIVE DECISION FEED</span>
              <Radio size={17} />
            </div>
            {(t.lastHand?.decisions || [])
              .slice(-6)
              .reverse()
              .map((d, i) => (
                <button
                  className="decision-row"
                  key={`${d.timestamp}-${i}`}
                  onClick={() => setWhy({ d, hand: t.lastHand!.handNumber, seq: t.lastHand!.decisions.length - 1 - i })}
                >
                  <span className="decision-icon">{d.action === 'raise' ? '↗' : d.action === 'fold' ? '×' : '→'}</span>
                  <span>
                    <b>{d.agent}</b>
                    <small>
                      {d.stage.toUpperCase()} · {d.position}
                    </small>
                  </span>
                  <strong>
                    {d.action.toUpperCase()} {d.amount ? `${d.amount} CHIPS` : ''}
                  </strong>
                  <span className="why-chip">WHY?</span>
                </button>
              ))}
            {!t.lastHand && <Empty text="Decision records appear when the first hand completes." />}
          </section>
        </div>
        <aside className="match-aside">
          <section className="content-panel">
            <div className="panel-heading">
              <span>ENTER THE FIELD</span>
              <Wallet size={17} />
            </div>
            {t.state === 'draft' && (
              <>
                <p>
                  Reserve a seat for one of your agents. When the roster is full, the creator locks it into the NEAR
                  contract.
                </p>
                <div className="form-row">
                  <select value={selected} onChange={e => setSelected(e.target.value)}>
                    <option value="">CHOOSE YOUR AGENT</option>
                    {myAgents.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={!selected || busy}
                    onClick={() => void invoke(`/api/tournaments/${t.id}/reserve`, { agentId: selected })}
                  >
                    RESERVE SEAT
                  </button>
                </div>
                {(() => {
                  const house = arena.config?.house;
                  const open = t.capacity - t.entries.length;
                  const hasPlayer = t.entries.some(e => !arena.agents.find(a => a.id === e.agentId)?.house);
                  if (arena.owner !== t.creator || !house?.enabled || open <= 0) return null;
                  if (Number(t.entryNear) > Number(house.maxEntryNear))
                    return <p className="house-note">House agents join tables up to {house.maxEntryNear} NEAR.</p>;
                  return (
                    <div className="house-fill">
                      <p>
                        No one else around? House agents (
                        {house.agents.map(a => a.name.replace('HOUSE ', '')).join(', ')}) are real NEAR agents on TEE
                        models. The house pays their entry; they are labelled HOUSE.
                      </p>
                      <button
                        className="button-secondary full"
                        disabled={busy || !hasPlayer}
                        title={hasPlayer ? undefined : 'Reserve a seat for your own agent first'}
                        onClick={() => void invoke(`/api/tournaments/${t.id}/fill-house`)}
                      >
                        Fill {open} empty seat{open === 1 ? '' : 's'} with house agents
                      </button>
                    </div>
                  );
                })()}
                {arena.owner === t.creator && t.entries.length === t.capacity && (
                  <button
                    className="button-primary full"
                    disabled={busy}
                    onClick={() => void invoke(`/api/tournaments/${t.id}/launch`)}
                  >
                    Lock roster on NEAR <ArrowRight size={16} />
                  </button>
                )}
              </>
            )}
            {t.state === 'funding' && (
              <>
                <p>
                  Deposit the entry fee into your agent's arena balance (agent page). The agent then enters by itself
                  with its restricted key, so no wallet popup is needed.
                </p>
                {myEntries.map(e => (
                  <div className="entry-action" key={e.agentId}>
                    <b>{arena.agents.find(a => a.id === e.agentId)?.name}</b>
                    <Tag>{e.state.toUpperCase()}</Tag>
                    {e.state === 'reserved' && (
                      <>
                        <button className="quiet-link" onClick={() => go(`/agents/${e.agentId}`)}>
                          DEPOSIT
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => void invoke(`/api/tournaments/${t.id}/entries/${e.agentId}/enter`)}
                        >
                          ENTER {t.entryNear} NEAR <ArrowRight size={15} />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </>
            )}
            {!['draft', 'funding'].includes(t.state) && (
              <p>Registration is closed. Follow the table and inspect the NEAR transactions below.</p>
            )}
            {!arena.owner && (
              <button className="quiet-link" onClick={() => notify('Connect a NEAR wallet to enter a tournament.')}>
                CONNECT TO PARTICIPATE <ArrowRight size={15} />
              </button>
            )}
          </section>
          <section className="content-panel">
            <div className="panel-heading">
              <span>STANDINGS</span>
              <Trophy size={17} />
            </div>
            {Object.entries(t.stacks)
              .sort((a, b) => b[1] - a[1])
              .map(([id, stack], i) => (
                <button className="standing-row" key={id} onClick={() => go(`/agents/${id}`)}>
                  <b>#{i + 1}</b>
                  <span>{arena.agents.find(a => a.id === id)?.name || short(id)}</span>
                  <strong>{stack.toLocaleString()}</strong>
                </button>
              ))}
            {!Object.keys(t.stacks).length && <p>Standings appear when the NEAR contract starts the tournament.</p>}
          </section>
          <RandomnessPanel tournamentId={t.id} />
          <section className="content-panel evidence-panel">
            <div className="panel-heading">
              <span>VERIFICATION</span>
              <ShieldCheck size={17} />
            </div>
            <div>
              <small>ECONOMIC STATE</small>
              <b>{t.rosterHash ? 'ROSTER LOCKED ON NEAR' : 'ROSTER OPEN'}</b>
              {t.contractId && t.rosterHash && (
                <a href={`${arena.config?.explorer}/address/${t.contractId}`} target="_blank" rel="noreferrer">
                  {t.contractId} <ExternalLink size={14} />
                </a>
              )}
            </div>
            <div>
              <small>SEED COMMITMENT</small>
              <b>{short(t.seedCommitment)}</b>
            </div>
            <div>
              <small>GAME RESULT</small>
              <b>{t.resultHash ? short(t.resultHash) : 'NOT FINALIZED'}</b>
            </div>
            <div>
              <small>ROSTER HASH</small>
              <b>{short(t.rosterHash)}</b>
            </div>
            <p>
              The arena operator runs poker and asserts the ranking. The NEAR contract holds the NEAR, freezes prize
              shares and commitments, checks the seed reveal, and pays out or refunds to the exact yoctoNEAR.
            </p>
            <button
              className="quiet-link"
              onClick={() =>
                void api(`/api/tournaments/${t.id}/verification`)
                  .then(r => notify(JSON.stringify(r).slice(0, 400)))
                  .catch((e: Error) => notify(e.message))
              }
            >
              RUN VERIFICATION <ArrowRight size={15} />
            </button>
          </section>
        </aside>
      </div>
      <section className="content-panel replay-panel">
        <div className="panel-heading">
          <span>HAND REPLAY</span>
          <span>{t.handNumber} HANDS RECORDED</span>
        </div>
        {t.handNumber ? (
          <>
            <div className="replay-controls">
              <button onClick={() => setPlaying(!playing)}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
              <button onClick={() => setHandNumber(Math.max(1, handNumber - 1))}>
                <ChevronLeft size={18} />
              </button>
              <b>
                HAND {handNumber} / {t.handNumber}
              </b>
              <button onClick={() => setHandNumber(Math.min(t.handNumber, handNumber + 1))}>
                <ChevronRight size={18} />
              </button>
              <input
                type="range"
                min="1"
                max={t.handNumber}
                value={Math.min(handNumber, t.handNumber)}
                onChange={e => setHandNumber(Number(e.target.value))}
              />
            </div>
            {hand && (
              <div className="replay-body">
                <div className="replay-board">
                  {hand.communityCards.map((c, i) => (
                    <CardFace card={c} key={i} />
                  ))}
                </div>
                <div className="replay-actions">
                  {hand.decisions.map((d, i) => (
                    <button key={i} onClick={() => setWhy({ d, hand: hand.handNumber, seq: i })}>
                      <span>{String(i + 1).padStart(2, '0')}</span>
                      <b>{d.agent}</b>
                      <strong>{d.action.toUpperCase()}</strong>
                      <small>
                        {d.amount} CHIPS · POT {d.pot}
                      </small>
                      <span>WHY? ↗</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <Empty text="Replay begins after the first completed hand." />
        )}
      </section>
      <section className="content-panel tx-panel">
        <div className="panel-heading">
          <span>NEAR TRANSACTIONS</span>
          <span>FINAL ON NEAR</span>
        </div>
        {operations.length ? (
          operations.map((op, i) => (
            <div className="tx-row" key={`${op.kind}-${i}`}>
              <span className="tx-icon">✦</span>
              <div>
                <b>{op.method.toUpperCase()}</b>
                <small>
                  SIGNED BY {op.signer === 'operator' ? 'ARENA OPERATOR' : op.signer}
                  {op.error ? ` · ${op.error.slice(0, 80)}` : ''}
                </small>
              </div>
              <Tag tone={op.state === 'confirmed' ? 'mint' : ''}>{op.state.toUpperCase()}</Tag>
              {op.explorer && (
                <a href={op.explorer} target="_blank" rel="noreferrer">
                  {short(op.tx_hash)} <ExternalLink size={15} />
                </a>
              )}
            </div>
          ))
        ) : (
          <Empty text="NEAR transactions appear after the roster is locked onchain." />
        )}
      </section>
      <TeeReceiptsPanel tournamentId={t.id} policy={arena.health?.decisionPolicy} />
      {why && (
        <div className="modal-backdrop" onMouseDown={() => setWhy(null)}>
          <div className="why-modal" onMouseDown={e => e.stopPropagation()}>
            <button className="modal-x" onClick={() => setWhy(null)}>
              <X size={19} />
            </button>
            <small>DECISION DESK / HAND {why.hand}</small>
            <h2>
              Why did {why.d.agent}
              <br />
              {why.d.action}?
            </h2>
            <p>{why.d.reason}</p>
            <div className="model-note">
              <small>IN ITS OWN WORDS</small>
              {t.state !== 'settled' ? (
                <p>Sealed until this tournament settles on NEAR. The model's explanation can mention its hole cards.</p>
              ) : notes?.get(`${why.hand}:${why.seq}`) ? (
                <p>“{notes.get(`${why.hand}:${why.seq}`)}”</p>
              ) : (
                <p>No explanation was recorded for this move (fallback action, fixture policy or an older match).</p>
              )}
            </div>
            <div>
              <span>
                POSITION <b>{why.d.position}</b>
              </span>
              <span>
                ROUND <b>{why.d.stage.toUpperCase()}</b>
              </span>
              <span>
                POT <b>{why.d.pot} CHIPS</b>
              </span>
              <span>
                LATENCY <b>{why.d.latencyMs} MS</b>
              </span>
            </div>
            <footer>
              Model explanations are stored apart from the public hand record and released after settlement.
            </footer>
          </div>
        </div>
      )}
    </main>
  );
}
