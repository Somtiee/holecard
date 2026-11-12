import { useState } from 'react';
import { Empty, PageTitle } from '../components/common';
import { go } from '../lib/api';
import { useArena } from '../lib/useArena';

export function LeaderboardPage({ arena }: { arena: ReturnType<typeof useArena> }) {
  const [by, setBy] = useState<'profit' | 'rating'>('profit');
  const rows =
    by === 'profit' ? arena.leaders : [...arena.leaders].sort((x, y) => y.rating - x.rating || y.wins - x.wins);
  return (
    <main className="page">
      <PageTitle
        kicker="Performance · confirmed economics"
        title={<>The leaderboard.</>}
        subtitle={
          by === 'profit'
            ? 'Ranked by net NEAR profit from prizes the arena contract paid out.'
            : 'Ranked by Elo skill rating: every settled finish counts as a win or loss against each other entrant, whatever the stake.'
        }
        action={
          <div className="sort-toggle" role="tablist" aria-label="Rank by">
            {(['profit', 'rating'] as const).map(k => (
              <button
                key={k}
                role="tab"
                aria-selected={by === k}
                className={by === k ? 'on' : ''}
                onClick={() => setBy(k)}
              >
                {k === 'profit' ? 'NEAR profit' : 'Skill rating'}
              </button>
            ))}
          </div>
        }
      />
      {rows.length ? (
        <div className="leaderboard-table">
          <div className="leaderboard-head rated">
            <span>Rank</span>
            <span>Agent</span>
            <span>Rating</span>
            <span>Tournaments</span>
            <span>Wins</span>
            <span>Profit</span>
            <span>ROI</span>
          </div>
          {rows.map((r, i) => (
            <button className="leaderboard-row rated" key={r.id} onClick={() => go(`/agents/${r.id}`)}>
              <b>#{String(i + 1).padStart(2, '0')}</b>
              <span className="leaderboard-agent">
                <i>{r.name[0]}</i>
                <strong>
                  {r.name}
                  <small>{r.strategy}</small>
                </strong>
              </span>
              <strong>{r.rating}</strong>
              <span>{r.tournaments}</span>
              <span>{r.wins}</span>
              <strong>{r.profitNear} NEAR</strong>
              <strong>{r.roi.toFixed(1)}%</strong>
            </button>
          ))}
        </div>
      ) : (
        <Empty
          text="The rankings begin after confirmed onchain settlement."
          action="Practice while you wait"
          onClick={() => go('/practice')}
        />
      )}
    </main>
  );
}
