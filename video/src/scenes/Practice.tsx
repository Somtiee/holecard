import { ArrowRight, ChevronLeft, ChevronRight, FastForward, Pause, RotateCcw, Trophy } from 'lucide-react';
import { useCurrentFrame } from 'remotion';
import real from '../data/real.json';
import { clamp01, typed } from '../lib/anim';
import { LEN, T } from '../timeline';
import { Page } from '../ui/App';
import { Caption, NetBadge } from '../ui/Caption';
import { Cursor, deviceIn, Paper, Shot, Spot } from '../ui/Shot';

type Decision = (typeof real.practice.hand.decisions)[number];
type Hand = typeof real.practice.hand;

const STRATEGIES: [string, string][] = [
  ['Aggressive', 'Plays lots of hands and bets them hard. Bigger pots, bigger swings.'],
  ['Conservative', 'Waits for a real edge, then bets it. Almost never bluffs.'],
  ['Balanced', 'Solid hands at sensible prices. The middle of the road.'],
  ['Bluff Heavy', 'Attacks from the button and cutoff with or without a hand.'],
  ['Mathematical', 'Calls exactly when the pot odds pay for it, and no wider.'],
  ['Adaptive', 'Shoves or folds when short, tightens out of position, steals late.'],
];
const HOUSE = [
  ['GRANITE', 'Conservative'],
  ['VIPER', 'Aggressive'],
  ['MIRAGE', 'Bluff Heavy'],
];
const PLACE = ['1st', '2nd', '3rd', '4th'];

export function Card({ card, small, dim, flip = 1 }: { card: string; small?: boolean; dim?: boolean; flip?: number }) {
  // flip: 0 = back, 1 = face; the card turns edge-on halfway.
  if (flip < 0.5)
    return <span className={`card-back ${small ? 'mini' : ''}`} style={{ transform: `scaleX(${1 - flip * 2})` }} />;
  const suit = card.slice(-1).toLowerCase(),
    red = suit === 'h' || suit === 'd';
  return (
    <span className={`card-face ${red ? 'red' : ''} ${small ? 'mini' : ''} ${dim ? 'dim' : ''}`} style={{ transform: `scaleX(${(flip - 0.5) * 2})` }}>
      <b>{card.slice(0, -1) === 'T' ? '10' : card.slice(0, -1)}</b>
      <span>{{ s: '♠', h: '♥', d: '♦', c: '♣' }[suit as 's' | 'h' | 'd' | 'c'] || suit}</span>
    </span>
  );
}

const verb = (d: Decision) =>
  d.action === 'raise'
    ? `raises to ${d.raiseTarget ?? d.amount}`
    : d.action === 'call'
      ? `calls ${d.amount}`
      : d.action === 'all-in'
        ? `is all in (${d.amount})`
        : d.action === 'check'
          ? 'checks'
          : 'folds';

const P = real.practice;
const seatsAll = P.seats;
const nameOf = (id: string) => seatsAll.find(s => s.id === id)?.name || id;

/** Same markup as PracticePage's table view, driven by `step` instead of a timer. */
function PracticeTable({ hand, step, flip, done }: { hand: Hand; step: number; flip: number; done: boolean }) {
  const current = hand;
  const last = current.decisions.length + 1;
  const seats = seatsAll.filter(s => ((current.startStacks as Record<string, number>)[s.id] || 0) > 0);
  const shown = current.decisions.slice(0, Math.min(step, current.decisions.length));
  const latest = shown.at(-1),
    atResult = step >= last;
  const stacks: Record<string, number> = atResult ? current.endStacks : { ...current.startStacks, ...((latest?.tableStacks as Record<string, number>) || {}) };
  const board = atResult ? current.communityCards : latest?.communityCards || [];
  const pot = atResult ? current.pot : (latest?.pot ?? current.smallBlind + current.bigBlind);
  const folded = new Set(shown.filter(d => d.action === 'fold').map(d => d.agentId));
  const winners = current.winnerIds.map(nameOf),
    won = current.winnerIds.reduce((n, id) => n + ((current.payouts as Record<string, number>)[id] || 0), 0);
  const buttonId = seats[current.button % seats.length]?.id;
  const position = (id: string) => seatsAll.map(s => s.id).indexOf(id);
  const me = P.standings.find(s => s.id === 'you')!;
  const handIdx = current.handNumber - 1;
  return (
    <main className="page practice-page">
      <div className="tournament-top">
        <div>
          <p className="eyebrow">Practice table · simulated equity · not onchain</p>
          <h1>NIGHTOWL vs the house.</h1>
          <p>{P.strategy} strategy. Four seats, 1,000 chips each, blinds up every five hands.</p>
        </div>
        <button className="button-secondary">
          <RotateCcw size={15} /> New game
        </button>
      </div>
      <div className="match-layout">
        <div>
          <div className="table-shell" data-cam="table">
            <div className="table-stage">
              <div className="table-glow" />
              <div className="table-head">
                <span>
                  PRACTICE <b>HAND {current.handNumber}</b>
                </span>
                <span className="live-dot">{atResult ? 'HAND OVER' : latest ? latest.stage.toUpperCase() : 'DEALING'}</span>
              </div>
              <div className="felt">
                <div className="felt-rim" />
                <div className="table-logo">
                  HOLE<span>CARD</span>
                  <small>PRACTICE</small>
                </div>
                <div className="board">
                  {board.length
                    ? board.map((c, i) => <Card key={`${i}-${c}`} card={c} />)
                    : Array.from({ length: 5 }, (_, i) => (
                        <span className="card-back" key={i}>
                          ✦
                        </span>
                      ))}
                </div>
                <div className="pot">
                  <small>POT</small>
                  <strong>{pot}</strong>
                  <span>CHIPS</span>
                </div>
                {atResult && (
                  <div className="hand-result" role="status" data-cam="handResult">
                    <b>{winners.join(' & ')}</b> {winners.length > 1 ? 'split' : 'wins'} {won}
                    {current.winningHand ? ` with ${current.winningHand}` : ''}
                  </div>
                )}
                {seats.map(s => {
                  const cards = (current.holeCards as Record<string, string[]>)[s.id] || [],
                    mine = s.id === 'you',
                    reveal = mine || (atResult && cards.length > 0);
                  return (
                    <div
                      key={s.id}
                      className={`table-seat p-seat-${position(s.id)} ${latest?.agentId === s.id && !atResult ? 'acting' : ''} ${folded.has(s.id) ? 'folded' : ''} ${mine ? 'mine' : ''} ${atResult && current.winnerIds.includes(s.id) ? 'winner' : ''}`}
                    >
                      <span className="seat-avatar">{s.name[0]}</span>
                      <span className="seat-text">
                        <b>
                          {s.name}
                          {s.id === buttonId && (
                            <em className="dealer" title="Dealer button">
                              D
                            </em>
                          )}
                        </b>
                        <small>{(stacks[s.id] ?? 0).toLocaleString('en-US')} chips</small>
                      </span>
                      <span className="seat-cards">
                        {reveal && cards.length ? (
                          cards.map((c, i) => <Card key={i} card={c} small dim={folded.has(s.id)} flip={mine ? 1 : flip} />)
                        ) : (
                          <>
                            <span className="card-back mini" />
                            <span className="card-back mini" />
                          </>
                        )}
                      </span>
                      {latest?.agentId === s.id && !atResult && <span className="seat-bubble">{verb(latest)}</span>}
                    </div>
                  );
                })}
              </div>
              <div className="table-foot">
                <span>
                  BLINDS{' '}
                  <b>
                    {current.smallBlind}/{current.bigBlind}
                  </b>
                </span>
                <span>
                  HAND{' '}
                  <b>
                    {handIdx + 1} / {P.handsTotal}
                  </b>
                </span>
              </div>
            </div>
          </div>
          <div className="replay-controls practice-controls">
            <button aria-label="Pause">
              <Pause size={18} />
            </button>
            <button aria-label="Previous hand">
              <ChevronLeft size={18} />
            </button>
            <b>
              HAND {handIdx + 1} / {P.handsTotal}
            </b>
            <button aria-label="Next hand">
              <ChevronRight size={18} />
            </button>
            <input type="range" aria-label="Hand" min={1} max={P.handsTotal} value={handIdx + 1} readOnly />
            <span className="speed">
              {[1, 2, 4].map(x => (
                <button key={x} className={x === 1 ? 'on' : ''}>
                  {x}×
                </button>
              ))}
            </span>
            <button className="skip" data-cam="skip">
              <FastForward size={16} /> Results
            </button>
          </div>
          <section className="content-panel" data-cam="log">
            <div className="panel-heading">
              <span>Decision log · hand {current.handNumber}</span>
              <span>
                {shown.length} / {current.decisions.length}
              </span>
            </div>
            {shown.length ? (
              <ol className="practice-log">
                {[...shown].reverse().map((d, i) => (
                  <li key={shown.length - i} className={d.agentId === 'you' ? 'mine' : ''} data-cam={`dec-${shown.length - 1 - i}`}>
                    <span className={`act act-${d.action}`}>{d.action}</span>
                    <div>
                      <b>
                        {d.agent}{' '}
                        <small>
                          {d.position} · {d.stage}
                          {d.amount ? ` · ${d.amount} chips` : ''}
                        </small>
                      </b>
                      <p>{d.reason}</p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p>
                Cards are in the air. Blinds {current.smallBlind}/{current.bigBlind} are posted.
              </p>
            )}
          </section>
        </div>
        <aside className="match-aside">
          {done && (
            <section className="content-panel practice-summary" data-cam="summary">
              <div className="panel-heading">
                <span>Final result</span>
                <Trophy size={17} />
              </div>
              <strong className="place">{PLACE[me.place - 1]}</strong>
              <p className="place-sub">of 4 after {P.handsTotal} hands</p>
              <div className="summary-grid">
                <div>
                  <small>Net chips</small>
                  <b className={P.you.net >= 0 ? 'up' : 'down'}>
                    {P.you.net >= 0 ? '+' : ''}
                    {P.you.net}
                  </b>
                </div>
                <div>
                  <small>Hands won</small>
                  <b>{P.you.handsWon}</b>
                </div>
                <div>
                  <small>VPIP</small>
                  <b>{Math.round(P.you.vpip * 100)}%</b>
                </div>
              </div>
              <button className="button-primary full" data-cam="makeReal">
                Make it real on NEAR <ArrowRight size={16} />
              </button>
              <button className="button-secondary full">
                <RotateCcw size={15} /> Play again
              </button>
              <p>On NEAR your agent gets its own account and decides with a TEE-hosted model instead of these rules.</p>
            </section>
          )}
          <section className="content-panel">
            <div className="panel-heading">
              <span>Chip counts</span>
              <span>hand {current.handNumber}</span>
            </div>
            {[...seatsAll]
              .map(s => ({ s, stack: stacks[s.id] ?? 0 }))
              .sort((a, b) => b.stack - a.stack)
              .map(({ s, stack }, i) => (
                <div className={`standing-row ${s.id === 'you' ? 'mine' : ''}`} key={s.id}>
                  <b>#{i + 1}</b>
                  <span>
                    {s.name}
                    <small>{s.house ? `house · ${s.strategy}` : `you · ${s.strategy}`}</small>
                  </span>
                  <strong>{stack.toLocaleString('en-US')}</strong>
                </div>
              ))}
          </section>
          <section className="content-panel">
            <div className="panel-heading">
              <span>How this works</span>
            </div>
            <p>{P.policy} Each hand uses a fresh deck from a random 256-bit seed and the same engine that runs real arenas.</p>
            <p className="seed">
              seed <code>{P.seed.slice(0, 16)}…</code>
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}

function PracticeSetup({ name, strategy, busy }: { name: string; strategy: string; busy: boolean }) {
  return (
    <main className="page practice-page">
      <div className="page-title">
        <div>
          <small>Practice table · free · no wallet</small>
          <h1>Try a strategy.</h1>
          <p>
            Name an agent, pick how it plays and drop it into a four-seat sit-and-go against the house bots. Thirty hands,
            rising blinds, every decision explained. Nothing is onchain and nothing is stored.
          </p>
        </div>
      </div>
      <div className="practice-setup">
        <section className="content-panel" data-cam="setup">
          <div className="panel-heading">
            <span>Your agent</span>
            <span>01</span>
          </div>
          <label>
            Agent name
            <input value={name} readOnly placeholder="NIGHTOWL" data-cam="nameInput" />
          </label>
          <div className="panel-heading sub">
            <span>Strategy</span>
            <span>02</span>
          </div>
          <div className="strategy-grid" role="radiogroup" aria-label="Strategy">
            {STRATEGIES.map(([s, body]) => (
              <button key={s} role="radio" aria-checked={strategy === s} className={strategy === s ? 'on' : ''} data-cam={`strat-${s}`}>
                <b>{s}</b>
                <small>{body}</small>
              </button>
            ))}
          </div>
          <button className="button-primary full" disabled={!name.trim()} data-cam="deal">
            {busy ? 'Shuffling…' : 'Deal me in'} <ArrowRight size={16} />
          </button>
        </section>
        <aside className="content-panel practice-house">
          <div className="panel-heading">
            <span>The house</span>
            <span>3 bots</span>
          </div>
          {HOUSE.map(([n, s]) => (
            <div className="house-row" key={n}>
              <span className="seat-avatar">{n[0]}</span>
              <span>
                <b>{n}</b>
                <small>{s}</small>
              </span>
            </div>
          ))}
          <p>
            Practice runs Holecard's own poker engine. Every seat estimates its chance of winning by simulating the rest of
            the hand, then plays its style, so a game is instant and free. Real tables swap these rules for a model running
            in a NEAR AI Cloud TEE, with entry fees held by the NEAR contract.
          </p>
        </aside>
      </div>
    </main>
  );
}

function HomeTop() {
  return (
    <section className="hero-sub" style={{ paddingTop: 80 }}>
      <div className="wrap">
        <p className="eyebrow">AI agent poker · NEAR testnet</p>
        <p className="hero-lead">
          Give an AI agent its own NEAR account, a strategy and a seat at the table. It plays poker for a NEAR prize pool
          and builds a public record.
        </p>
        <p className="hero-lead">
          Underneath, every decision runs in a NEAR AI Cloud TEE, every shuffle is a VRF proof checked onchain, and no
          prize is paid until an OutLayer TEE has replayed the whole match.
        </p>
        <div className="actions">
          <button className="btn" data-cam="practiceBtn">
            Play a free practice match
          </button>
          <button className="btn ghost">Enter the arena</button>
          <button className="btn ghost">How it uses NEAR</button>
        </div>
        <p className="cta-practice">No wallet and no sign-in. Pick a strategy and play thirty hands against the house in seconds.</p>
      </div>
    </section>
  );
}

export function Practice() {
  const frame = useCurrentFrame();
  const t = T.practice;
  const hand = P.hand;
  const n = hand.decisions.length;
  const resultAt = t.d0 + n * t.step + 6;
  const step = frame < t.d0 ? 0 : frame >= resultAt ? n + 1 : Math.min(n, Math.floor((frame - t.d0) / t.step) + 1);
  const flip = clamp01((frame - resultAt) / 10);
  const done = frame >= t.results + 4;
  const view = frame < t.setup ? 'home' : frame < t.table ? 'setup' : 'table';
  const name = frame < t.setup ? '' : typed('NIGHTOWL', frame, t.typeName, 3);
  const strategy = frame >= t.pickStrategy ? P.strategy : 'Aggressive';
  // the 'call ... needs 36%' decision is where the pot odds show
  const oddsIdx = hand.decisions.findIndex(d => d.agentId === 'you' && d.action === 'call');
  const oddsAt = t.d0 + oddsIdx * t.step;
  const url = view === 'home' ? 'holecard.fun' : 'holecard.fun/#/practice';
  const cams =
    view === 'home'
      ? [{ at: 0, target: 'practiceBtn', s: 1.5 }]
      : view === 'setup'
        ? [
            { at: 0, target: 'setup', s: 1.12 },
            { at: t.typeName, target: 'nameInput', s: 1.55, dur: 16 },
            { at: t.pickStrategy - 14, target: 'setup', s: 1.12, dur: 16 },
          ]
        : [
            { at: 0, target: 'table', s: 1.08 },
            { at: oddsAt + 2, target: `dec-${oddsIdx}`, s: 1.42, dur: 20 },
            { at: oddsAt + 40, target: `dec-${oddsIdx}`, s: 1.42, dy: -40, dur: 20 },
            { at: resultAt - 18, target: 'table', s: 1.15, dur: 18 },
            { at: t.results - 16, target: 'skip', s: 1.3, dur: 14 },
            { at: t.results + 6, target: 'summary', s: 1.35, dur: 18 },
          ];
  const moves =
    view === 'home'
      ? [{ at: t.clickPractice, target: 'practiceBtn', click: true }]
      : view === 'setup'
        ? [
            { at: t.typeName - 4, target: 'nameInput', click: true },
            { at: t.pickStrategy, target: `strat-${P.strategy}`, click: true },
            { at: t.deal, target: 'deal', click: true },
          ]
        : [
            { at: t.results, target: 'skip', click: true },
            { at: t.makeReal, target: 'makeReal', click: true },
          ];
  return (
    <Paper grain={0.08}>
      <Shot url={url} cams={cams} style={deviceIn(frame, LEN.practice)}>
        <Page path="/practice">
          {view === 'home' && <HomeTop />}
          {view === 'setup' && <PracticeSetup name={name} strategy={strategy} busy={frame >= t.deal + 4} />}
          {view === 'table' && <PracticeTable hand={done ? (P.lastHand as Hand) : hand} step={done ? 999 : step} flip={done ? 1 : flip} done={done} />}
        </Page>
        <Cursor key={view} moves={moves} from={view === 'table' ? { x: 1000, y: 500 } : { x: 900, y: 300 }} />
        {view === 'table' && !done && <Spot target={`dec-${oddsIdx}`} at={oddsAt + 8} end={resultAt - 20} pad={4} />}
      </Shot>
      <Caption
        end={LEN.practice}
        caps={[
          { at: 0, n: '01 / practice', title: 'Try it free.', line: 'A practice match against the house bots. No wallet, no sign-in.' },
          { at: t.table, n: '01 / practice', title: 'Every move comes with its reason.', line: 'Each seat simulates the rest of the hand, then says its win chance and why it acts.' },
          { at: t.results, n: '01 / practice', title: 'Try it free. Then make it real on NEAR.', line: 'Make it real on NEAR carries the name and strategy into agent creation.' },
        ]}
      />
      <NetBadge />
    </Paper>
  );
}
