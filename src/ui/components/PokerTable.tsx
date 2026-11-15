import { CardFace } from './common';
import { go, short, tournamentStatus, type Agent, type Decision, type Thinking, type Tournament } from '../lib/api';

export function ActionTicker({ action, thinking }: { action: Decision | null; thinking: Thinking['turn'] | null }) {
  return (
    <div className="action-ticker">
      <span className="ticker-light" />
      <b>{thinking?.agent || action?.agent || 'ARENA FEED'}</b>
      <span>
        {thinking
          ? `IS THINKING · ${thinking.stage.toUpperCase()} · POT ${thinking.pot} CHIPS`
          : action
            ? `${action.action.toUpperCase()} · ${action.amount} CHIPS · ${action.stage.toUpperCase()}`
            : 'No current action'}
      </span>
      <small>
        {thinking
          ? `${Math.round(thinking.timeoutMs / 1000)}s DECISION LIMIT`
          : action
            ? `${(action.latencyMs / 1000).toFixed(1)}s DECISION`
            : ''}
      </small>
    </div>
  );
}

/** The nine seat slots in clockwise order from the bottom centre (see .seat-N in styles.css). */
const CLOCKWISE = [0, 7, 1, 2, 3, 4, 5, 6, 8];
/** Spread n players evenly around the table instead of filling the first n slots. */
const seatSlot = (index: number, count: number) => CLOCKWISE[Math.round((index * CLOCKWISE.length) / count) % 9];

export function PokerTable({
  activeHand,
  tournament,
  agents,
  action,
  thinking,
}: {
  activeHand?: number;
  tournament: Tournament;
  agents: Agent[];
  action: Decision | null;
  thinking: Thinking['turn'] | null;
}) {
  // Before the match starts, show every reserved seat; afterwards only agents that actually entered.
  const seated = ['draft', 'launching', 'funding'].includes(tournament.state);
  // Only a running table has a player to act; finished tables show final stacks.
  const live = tournament.state === 'running';
  const actingId = live ? thinking?.agentId || action?.agentId : undefined;
  const entrants = tournament.entries.filter(e => seated || e.state === 'entered');
  const seats = entrants.map((e, i) => ({ entry: e, agent: agents.find(a => a.id === e.agentId), index: i }));
  const last = tournament.lastHand,
    board = thinking?.communityCards || action?.communityCards || last?.communityCards || [],
    pot = thinking?.pot ?? action?.pot ?? last?.pot ?? 0;
  return (
    <div className="table-shell">
      <div className="table-grid" />
      <div className="table-stage">
        <div className="table-glow" />
        <div className="table-head">
          <span>
            TABLE <b>{tournament.id.slice(0, 4).toUpperCase()}</b>
          </span>
          <span className="live-dot">
            {live && (thinking || action) ? 'LIVE ACTION' : tournamentStatus(tournament).toUpperCase()}
          </span>
        </div>
        <div className="felt">
          <div className="felt-rim" />
          <div className="table-logo">
            HOLE<span>CARD</span>
            <small>ON NEAR</small>
          </div>
          <div className="board">
            {board.length
              ? board.map((card, i) => <CardFace key={`${card}-${i}`} card={card} />)
              : Array.from({ length: 5 }, (_, i) => (
                  <span className="card-back" key={i}>
                    ✦
                  </span>
                ))}
          </div>
          <div className="pot">
            <small>{live && (thinking || action) ? 'CURRENT POT' : last ? 'LAST HAND POT' : 'POT'}</small>
            <strong>{pot}</strong>
            <span>CHIPS</span>
          </div>
          {seats.map(({ entry, agent, index }) => (
            <button
              key={entry.agentId}
              className={`table-seat seat-${seatSlot(index, seats.length)} ${actingId === entry.agentId ? 'acting' : ''}`}
              onClick={() => go(`/agents/${entry.agentId}`)}
            >
              <span className="seat-avatar">{agent?.name.slice(0, 1) || 'A'}</span>
              <span className="seat-text">
                <b>{agent?.name || short(entry.agentId)}</b>
                <small>
                  {(live
                    ? thinking?.agentId === entry.agentId
                      ? thinking.stack
                      : action?.tableStacks?.[entry.agentId]
                    : undefined) ??
                    tournament.stacks[entry.agentId] ??
                    tournament.startingStack}{' '}
                  CHIPS
                </small>
              </span>
              {actingId === entry.agentId && <i>●</i>}
            </button>
          ))}
        </div>
        <div className="table-foot">
          <span>
            HAND <b>#{String(activeHand ?? tournament.handNumber).padStart(3, '0')}</b>
          </span>
          <span>
            START STACK <b>{tournament.startingStack.toLocaleString()}</b>
          </span>
          <span>
            BLINDS <b>AUTO</b>
          </span>
        </div>
      </div>
    </div>
  );
}
