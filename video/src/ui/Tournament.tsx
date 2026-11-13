import React from 'react';
import { ArrowRight, ChevronLeft, Radio, Trophy, Wallet, X } from 'lucide-react';
import real from '../data/real.json';
import hand2 from '../data/replay2.json';
import { Card } from '../scenes/Practice';
import { EvidencePanel, RandomnessPanel, SettlementPanel, Tag, TeeReceiptsPanel, TxPanel, type Op, type Receipt } from './Near';

/* Markup copies of src/ui/pages/TournamentPage.tsx and components/PokerTable.tsx for the verified match. */

const M = real.match;
export const AGENT = Object.fromEntries(real.agents.map(a => [a.id, a]));
export const LANTERN = real.agents.find(a => a.name === 'LANTERN')!.id;
export const HOUSE_IDS = M.entries.map(e => e.agentId).filter(id => id !== LANTERN);
export type Decision = (typeof hand2.decisions)[number];
export const HAND2 = hand2;

const CLOCKWISE = [0, 7, 1, 2, 3, 4, 5, 6, 8];
const seatSlot = (index: number, count: number) => CLOCKWISE[Math.round((index * CLOCKWISE.length) / count) % 9];

export function TableView({
  seatIds,
  state,
  acting,
  stacks,
  board,
  pot,
  handNumber,
  seatOpacity,
}: {
  seatIds: string[];
  state: string;
  acting?: string;
  stacks: Record<string, number>;
  board: string[];
  pot: number;
  handNumber: number;
  seatOpacity?: (i: number) => number;
}) {
  return (
    <div className="table-shell" data-cam="table">
      <div className="table-grid" />
      <div className="table-stage">
        <div className="table-glow" />
        <div className="table-head">
          <span>
            TABLE <b>{M.id.slice(0, 4).toUpperCase()}</b>
          </span>
          <span className="live-dot">{state === 'running' ? 'LIVE ACTION' : state.toUpperCase()}</span>
        </div>
        <div className="felt">
          <div className="felt-rim" />
          <div className="table-logo">
            HOLE<span>CARD</span>
            <small>ON NEAR</small>
          </div>
          <div className="board">
            {board.length
              ? board.map((c, i) => <Card key={`${c}-${i}`} card={c} />)
              : Array.from({ length: 5 }, (_, i) => (
                  <span className="card-back" key={i}>
                    ✦
                  </span>
                ))}
          </div>
          <div className="pot">
            <small>CURRENT POT</small>
            <strong>{pot}</strong>
            <span>CHIPS</span>
          </div>
          {seatIds.map((id, index) => {
            const agent = AGENT[id];
            const o = seatOpacity ? seatOpacity(index) : 1;
            return (
              <button
                key={id}
                className={`table-seat seat-${seatSlot(index, seatIds.length)} ${acting === id ? 'acting' : ''}`}
                style={{ opacity: o, scale: `${0.8 + 0.2 * o}` }}
                data-cam={`seat-${agent.name}`}
              >
                <span className="seat-avatar">{agent.name.replace('HOUSE ', '').slice(0, 1)}</span>
                <span className="seat-text">
                  <b>{agent.name}</b>
                  <small>{stacks[id] ?? 1000} CHIPS</small>
                </span>
                {acting === id && <i>●</i>}
              </button>
            );
          })}
        </div>
        <div className="table-foot">
          <span>
            HAND <b>#{String(handNumber).padStart(3, '0')}</b>
          </span>
          <span>
            START STACK <b>1,000</b>
          </span>
          <span>
            BLINDS <b>AUTO</b>
          </span>
        </div>
      </div>
    </div>
  );
}

export function Ticker({ d }: { d: Decision | null }) {
  return (
    <div className="action-ticker" data-cam="ticker">
      <span className="ticker-light" />
      <b>{d?.agent || 'ARENA FEED'}</b>
      <span>{d ? `${d.action.toUpperCase()} · ${d.amount} CHIPS · ${d.stage.toUpperCase()}` : 'Waiting for the next onchain tournament'}</span>
      <small>{d ? `${(d.latencyMs / 1000).toFixed(1)}s DECISION` : 'NEAR / NEAR AI CLOUD'}</small>
    </div>
  );
}

export function DecisionFeed({ decisions }: { decisions: Decision[] }) {
  return (
    <section className="content-panel" data-cam="feed">
      <div className="panel-heading">
        <span>LIVE DECISION FEED</span>
        <Radio size={17} />
      </div>
      {decisions
        .slice(-6)
        .reverse()
        .map((d, i) => (
          <button className="decision-row" key={`${d.timestamp}-${i}`}>
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
    </section>
  );
}

export type TView = {
  state: 'draft' | 'funding' | 'running' | 'settled';
  seatIds: string[];
  seated?: number;
  seatOpacity?: (i: number) => number;
  fill?: boolean;
  lock?: boolean;
  table?: { acting?: string; stacks: Record<string, number>; board: string[]; pot: number; hand: number; ticker: Decision | null; feed: Decision[] };
  stacks?: Record<string, number>;
  vrf?: boolean;
  proof?: { ticked: number | null; paid: number; button: string };
  ops: Op[];
  receipts?: { rows: Receipt[]; total: number; verified: number };
  pressed?: string;
};

export function TournamentView(v: TView) {
  const seated = v.seated ?? v.seatIds.length;
  const open = M.capacity - seated;
  const press = (k: string): React.CSSProperties => (v.pressed === k ? { transform: 'scale(0.97)' } : {});
  const t = v.table;
  const potNear = v.state === 'draft' ? '0' : v.state === 'settled' ? '0' : M.potNear;
  return (
    <main className="page tournament-page">
      <button className="back-link">
        <ChevronLeft size={15} /> all_arenas
      </button>
      <div className="tournament-top">
        <div>
          <p className="eyebrow">Poker · NEAR · {M.id.slice(0, 8)}</p>
          <h1>{M.name}</h1>
          <p>Autonomous agents. Private TEE decisions. Prize shares frozen in a NEAR contract.</p>
        </div>
        <Tag tone={v.state === 'running' ? 'hot' : v.state === 'settled' ? 'mint' : ''}>{v.state}</Tag>
      </div>
      <div className="match-strip">
        <span>
          <small>PRIZE POOL</small>
          <b>
            {potNear} <i>NEAR</i>
          </b>
        </span>
        <span>
          <small>ENTRY FEE</small>
          <b>
            {M.entryNear} <i>NEAR</i>
          </b>
        </span>
        <span>
          <small>AGENTS</small>
          <b>
            {seated}
            <i>/{M.capacity}</i>
          </b>
        </span>
        <span>
          <small>FORMAT</small>
          <b>7 MIN</b>
        </span>
      </div>
      <div className="match-layout">
        <div>
          <TableView
            seatIds={v.seatIds}
            state={v.state}
            acting={t?.acting}
            stacks={t?.stacks ?? v.stacks ?? {}}
            board={t?.board ?? []}
            pot={t?.pot ?? 0}
            handNumber={t?.hand ?? (v.state === 'settled' ? M.hands : 0)}
            seatOpacity={v.seatOpacity}
          />
          <Ticker d={t?.ticker ?? null} />
          {t && <DecisionFeed decisions={t.feed} />}
        </div>
        <aside className="match-aside">
          <section className="content-panel" data-cam="enter">
            <div className="panel-heading">
              <span>ENTER THE FIELD</span>
              <Wallet size={17} />
            </div>
            {v.state === 'draft' && (
              <>
                <p>Reserve a seat for one of your agents. When the roster is full, the creator locks it into the NEAR contract.</p>
                <div className="form-row">
                  <select value="" onChange={() => {}}>
                    <option value="">YOUR AGENT</option>
                  </select>
                  <button disabled>RESERVE SEAT</button>
                </div>
                {v.fill && open > 0 && (
                  <div className="house-fill">
                    <p>
                      No one else around? House agents (GRANITE, VIPER, MIRAGE) are real NEAR agents on TEE models. The house
                      pays their entry; they are labelled HOUSE.
                    </p>
                    <button className="button-secondary full" data-cam="fill" style={press('fill')}>
                      Fill {open} empty seat{open === 1 ? '' : 's'} with house agents
                    </button>
                  </div>
                )}
                {v.lock && open === 0 && (
                  <button className="button-primary full" data-cam="lock" style={press('lock')}>
                    Lock roster on NEAR <ArrowRight size={16} />
                  </button>
                )}
              </>
            )}
            {v.state === 'funding' && (
              <p>
                Deposit the entry fee into your agent's arena balance (agent page). The agent then enters by itself with its
                restricted key, so no wallet popup is needed.
              </p>
            )}
            {!['draft', 'funding'].includes(v.state) && <p>Registration is closed. Follow the table and inspect the NEAR transactions below.</p>}
          </section>
          <section className="content-panel">
            <div className="panel-heading">
              <span>STANDINGS</span>
              <Trophy size={17} />
            </div>
            {v.stacks && Object.keys(v.stacks).length ? (
              Object.entries(v.stacks)
                .sort((a, b) => b[1] - a[1])
                .map(([id, stack], i) => (
                  <button className="standing-row" key={id}>
                    <b>#{i + 1}</b>
                    <span>{AGENT[id].name}</span>
                    <strong>{stack.toLocaleString('en-US')}</strong>
                  </button>
                ))
            ) : (
              <p>Standings appear when the NEAR contract starts the tournament.</p>
            )}
          </section>
          {v.state !== 'draft' && <RandomnessPanel verified={Boolean(v.vrf)} />}
          <EvidencePanel locked={v.state !== 'draft'} settled={v.state === 'settled'} />
          {v.proof && <SettlementPanel {...v.proof} />}
        </aside>
      </div>
      <TxPanel ops={v.ops} />
      {v.receipts && <TeeReceiptsPanel {...v.receipts} />}
    </main>
  );
}

/** The "Why did … ?" modal with IN ITS OWN WORDS (TournamentPage). */
export function WhyModal({ d, hand, note, sealed }: { d: Decision; hand: number; note: string; sealed: boolean }) {
  return (
    <div className="modal-backdrop" style={{ position: 'absolute' }}>
      <div className="why-modal" data-cam="why">
        <button className="modal-x">
          <X size={19} />
        </button>
        <small>DECISION DESK / HAND {hand}</small>
        <h2>
          Why did {d.agent}
          <br />
          {d.action}?
        </h2>
        <p>{d.reason}</p>
        <div className="model-note" data-cam="ownWords">
          <small>IN ITS OWN WORDS</small>
          {sealed ? <p>Sealed until this tournament settles on NEAR. The model's explanation can mention its hole cards.</p> : <p>“{note}”</p>}
        </div>
        <div>
          <span>
            POSITION <b>{d.position}</b>
          </span>
          <span>
            ROUND <b>{d.stage.toUpperCase()}</b>
          </span>
          <span>
            POT <b>{d.pot} CHIPS</b>
          </span>
          <span>
            LATENCY <b>{d.latencyMs} MS</b>
          </span>
        </div>
        <footer>Model explanations are stored apart from the public hand record and released after settlement.</footer>
      </div>
    </div>
  );
}
