import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, FastForward, Pause, Play, RotateCcw, Trophy } from 'lucide-react';

type Decision = {
  agentId: string;
  agent: string;
  action: string;
  amount: number;
  raiseTarget?: number;
  pot: number;
  stage: string;
  position: string;
  reason: string;
  communityCards: string[];
  tableStacks: Record<string, number>;
};
type Hand = {
  handNumber: number;
  button: number;
  smallBlind: number;
  bigBlind: number;
  startStacks: Record<string, number>;
  holeCards: Record<string, string[]>;
  communityCards: string[];
  pot: number;
  endStacks: Record<string, number>;
  decisions: Decision[];
  winnerIds: string[];
  payouts: Record<string, number>;
  winningHand: string | null;
};
type Seat = { id: string; name: string; strategy: string; house: boolean };
type Result = {
  seed: string;
  policy: string;
  seats: Seat[];
  hands: Hand[];
  standings: { id: string; name: string; stack: number; place: number }[];
  you: { place: number; net: number; handsWon: number; vpip: number };
};
export type PracticePreset = { name: string; strategy: string };

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
const SPEEDS = [1, 2, 4];
const PLACE = ['1st', '2nd', '3rd', '4th'];
const STORE = 'arena.practice';

function Card({ card, small, dim }: { card: string; small?: boolean; dim?: boolean }) {
  const suit = card.slice(-1).toLowerCase(),
    red = suit === 'h' || suit === 'd';
  return (
    <span className={`card-face ${red ? 'red' : ''} ${small ? 'mini' : ''} ${dim ? 'dim' : ''}`}>
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

export default function PracticePage({ onMakeReal }: { onMakeReal: (preset: PracticePreset) => void }) {
  const saved = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(STORE) || '{}') as Partial<PracticePreset>;
    } catch {
      return {};
    }
  }, []);
  const [name, setName] = useState(saved.name || 'NIGHTOWL'),
    [strategy, setStrategy] = useState(saved.strategy || 'Aggressive');
  const [result, setResult] = useState<Result | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [hand, setHand] = useState(0),
    [step, setStep] = useState(0),
    [playing, setPlaying] = useState(true),
    [speed, setSpeed] = useState(1),
    [done, setDone] = useState(false);

  const deal = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/practice', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name, strategy }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      try {
        localStorage.setItem(STORE, JSON.stringify({ name, strategy }));
      } catch {
        /* storage blocked */
      }
      setResult(data);
      setHand(0);
      setStep(0);
      setDone(false);
      setPlaying(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const current = result?.hands[hand];
  const last = current ? current.decisions.length + 1 : 0; // step 0 = deal, 1..n = after decision n, n+1 = result
  useEffect(() => {
    if (!result || !current || !playing || done) return;
    const atEnd = step >= last,
      lastHand = hand >= result.hands.length - 1;
    const timer = setTimeout(
      () => {
        if (!atEnd) setStep(step + 1);
        else if (!lastHand) {
          setHand(hand + 1);
          setStep(0);
        } else {
          setDone(true);
          setPlaying(false);
        }
      },
      (atEnd ? 1900 : step === 0 ? 700 : 950) / speed,
    );
    return () => clearTimeout(timer);
  }, [result, current, playing, done, step, last, hand, speed]);

  if (!result || !current)
    return (
      <main className="page practice-page">
        <div className="page-title">
          <div>
            <small>Practice table · free · no wallet</small>
            <h1>Try a strategy.</h1>
            <p>
              Name an agent, pick how it plays and drop it into a four-seat sit-and-go against the house bots. Thirty
              hands, rising blinds, every decision explained. Nothing is onchain and nothing is stored.
            </p>
          </div>
        </div>
        <div className="practice-setup">
          <section className="content-panel">
            <div className="panel-heading">
              <span>Your agent</span>
              <span>01</span>
            </div>
            <label>
              Agent name
              <input
                value={name}
                maxLength={20}
                onChange={e => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9 _-]/g, ''))}
                placeholder="NIGHTOWL"
                onKeyDown={e => {
                  if (e.key === 'Enter' && name.trim()) void deal();
                }}
              />
            </label>
            <div className="panel-heading sub">
              <span>Strategy</span>
              <span>02</span>
            </div>
            <div className="strategy-grid" role="radiogroup" aria-label="Strategy">
              {STRATEGIES.map(([s, body]) => (
                <button
                  key={s}
                  role="radio"
                  aria-checked={strategy === s}
                  className={strategy === s ? 'on' : ''}
                  onClick={() => setStrategy(s)}
                >
                  <b>{s}</b>
                  <small>{body}</small>
                </button>
              ))}
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="button-primary full" disabled={busy || !name.trim()} onClick={() => void deal()}>
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
              Practice runs Holecard's own poker engine. Every seat estimates its chance of winning by simulating the
              rest of the hand, then plays its style, so a game is instant and free. Real tables swap these rules for a
              model running in a NEAR AI Cloud TEE, with entry fees held by the NEAR contract.
            </p>
          </aside>
        </div>
      </main>
    );

  const seats = result.seats.filter(s => (current.startStacks[s.id] || 0) > 0);
  const shown = current.decisions.slice(0, Math.min(step, current.decisions.length));
  const latest = shown.at(-1),
    atResult = step >= last;
  const stacks = atResult ? current.endStacks : { ...current.startStacks, ...(latest?.tableStacks || {}) };
  const board = atResult ? current.communityCards : latest?.communityCards || [];
  const pot = atResult ? current.pot : (latest?.pot ?? current.smallBlind + current.bigBlind);
  const folded = new Set(shown.filter(d => d.action === 'fold').map(d => d.agentId));
  const nameOf = (id: string) => result.seats.find(s => s.id === id)?.name || id;
  const winners = current.winnerIds.map(nameOf),
    won = current.winnerIds.reduce((n, id) => n + (current.payouts[id] || 0), 0);
  const buttonId = seats[current.button % seats.length]?.id;
  const position = (id: string) => {
    const order = result.seats.map(s => s.id);
    return order.indexOf(id);
  };
  const finish = () => {
    setHand(result.hands.length - 1);
    setStep(result.hands[result.hands.length - 1].decisions.length + 1);
    setDone(true);
    setPlaying(false);
  };
  const jump = (h: number) => {
    setHand(Math.max(0, Math.min(result.hands.length - 1, h)));
    setStep(0);
    setDone(false);
  };
  const me = result.standings.find(s => s.id === 'you')!;

  return (
    <main className="page practice-page">
      <div className="tournament-top">
        <div>
          <p className="eyebrow">Practice table · simulated equity · not onchain</p>
          <h1>{nameOf('you')} vs the house.</h1>
          <p>{strategy} strategy. Four seats, 1,000 chips each, blinds up every five hands.</p>
        </div>
        <button
          className="button-secondary"
          onClick={() => {
            setResult(null);
            setPlaying(true);
          }}
        >
          <RotateCcw size={15} /> New game
        </button>
      </div>
      <div className="match-layout">
        <div>
          <div className="table-shell">
            <div className="table-stage">
              <div className="table-glow" />
              <div className="table-head">
                <span>
                  PRACTICE <b>HAND {current.handNumber}</b>
                </span>
                <span className="live-dot">
                  {atResult ? 'HAND OVER' : latest ? latest.stage.toUpperCase() : 'DEALING'}
                </span>
              </div>
              <div className="felt">
                <div className="felt-rim" />
                <div className="table-logo">
                  HOLE<span>CARD</span>
                  <small>PRACTICE</small>
                </div>
                <div className="board">
                  {board.length
                    ? board.map((c, i) => <Card key={`${current.handNumber}-${i}-${c}`} card={c} />)
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
                  <div className="hand-result" role="status">
                    <b>{winners.join(' & ')}</b> {winners.length > 1 ? 'split' : 'wins'} {won}
                    {current.winningHand ? ` with ${current.winningHand}` : ''}
                  </div>
                )}
                {seats.map(s => {
                  const cards = current.holeCards[s.id] || [],
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
                        <small>{(stacks[s.id] ?? 0).toLocaleString()} chips</small>
                      </span>
                      <span className="seat-cards">
                        {reveal && cards.length ? (
                          cards.map((c, i) => <Card key={i} card={c} small dim={folded.has(s.id)} />)
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
                    {hand + 1} / {result.hands.length}
                  </b>
                </span>
              </div>
            </div>
          </div>
          <div className="replay-controls practice-controls">
            <button
              aria-label={playing ? 'Pause' : 'Play'}
              onClick={() => {
                if (done) {
                  jump(0);
                  setPlaying(true);
                } else setPlaying(!playing);
              }}
            >
              {playing ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button aria-label="Previous hand" onClick={() => jump(hand - 1)}>
              <ChevronLeft size={18} />
            </button>
            <b>
              HAND {hand + 1} / {result.hands.length}
            </b>
            <button aria-label="Next hand" onClick={() => jump(hand + 1)}>
              <ChevronRight size={18} />
            </button>
            <input
              type="range"
              aria-label="Hand"
              min={1}
              max={result.hands.length}
              value={hand + 1}
              onChange={e => jump(Number(e.target.value) - 1)}
            />
            <span className="speed">
              {SPEEDS.map(x => (
                <button key={x} className={speed === x ? 'on' : ''} onClick={() => setSpeed(x)}>
                  {x}×
                </button>
              ))}
            </span>
            <button className="skip" onClick={finish}>
              <FastForward size={16} /> Results
            </button>
          </div>
          <section className="content-panel">
            <div className="panel-heading">
              <span>Decision log · hand {current.handNumber}</span>
              <span>
                {shown.length} / {current.decisions.length}
              </span>
            </div>
            {shown.length ? (
              <ol className="practice-log">
                {[...shown].reverse().map((d, i) => (
                  <li key={shown.length - i} className={d.agentId === 'you' ? 'mine' : ''}>
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
            <section className="content-panel practice-summary">
              <div className="panel-heading">
                <span>Final result</span>
                <Trophy size={17} />
              </div>
              <strong className="place">{PLACE[me.place - 1]}</strong>
              <p className="place-sub">of 4 after {result.hands.length} hands</p>
              <div className="summary-grid">
                <div>
                  <small>Net chips</small>
                  <b className={result.you.net >= 0 ? 'up' : 'down'}>
                    {result.you.net >= 0 ? '+' : ''}
                    {result.you.net}
                  </b>
                </div>
                <div>
                  <small>Hands won</small>
                  <b>{result.you.handsWon}</b>
                </div>
                <div>
                  <small>VPIP</small>
                  <b>{Math.round(result.you.vpip * 100)}%</b>
                </div>
              </div>
              <button className="button-primary full" onClick={() => onMakeReal({ name: nameOf('you'), strategy })}>
                Make it real on NEAR <ArrowRight size={16} />
              </button>
              <button className="button-secondary full" onClick={() => void deal()} disabled={busy}>
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
            {[...result.seats]
              .map(s => ({ s, stack: stacks[s.id] ?? 0 }))
              .sort((a, b) => b.stack - a.stack)
              .map(({ s, stack }, i) => (
                <div className={`standing-row ${s.id === 'you' ? 'mine' : ''}`} key={s.id}>
                  <b>#{i + 1}</b>
                  <span>
                    {s.name}
                    <small>{s.house ? `house · ${s.strategy}` : `you · ${s.strategy}`}</small>
                  </span>
                  <strong>{stack.toLocaleString()}</strong>
                </div>
              ))}
          </section>
          <section className="content-panel">
            <div className="panel-heading">
              <span>How this works</span>
            </div>
            <p>
              {result.policy} Each hand uses a fresh deck from a random 256-bit seed and the same engine that runs real
              arenas.
            </p>
            <p className="seed">
              seed <code>{result.seed.slice(0, 16)}…</code>
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}
