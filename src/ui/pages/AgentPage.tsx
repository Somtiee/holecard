import { useEffect, useState } from 'react';
import { ArrowUpRight, ChevronLeft, Trophy, Wallet } from 'lucide-react';
import { AgentNearPanel } from '../components/NearPanels';
import { Empty, Tag } from '../components/common';
import { api, go, type Analytics } from '../lib/api';
import { useArena } from '../lib/useArena';

export function AnalyticsPanel({ id }: { id: string }) {
  const [stats, setStats] = useState<Analytics | null>(null);
  useEffect(() => {
    void api<Analytics>(`/api/agents/${id}/analytics`)
      .then(setStats)
      .catch(() => {});
  }, [id]);
  if (!stats) return null;
  const values = stats.bankroll.map(x => x.stack),
    min = Math.min(...values, 0),
    max = Math.max(...values, 1),
    points = values
      .map(
        (value, i) =>
          `${values.length === 1 ? 50 : (i * 100) / (values.length - 1)},${95 - ((value - min) / (max - min)) * 85}`,
      )
      .join(' ');
  return (
    <section className="content-panel analytics-panel">
      <div className="panel-heading">
        <span>STRATEGY TELEMETRY</span>
        <span>{stats.hands} HANDS</span>
      </div>
      <div className="analytics-numbers">
        {[
          ['VPIP', `${(stats.vpip * 100).toFixed(1)}%`],
          ['PFR', `${(stats.pfr * 100).toFixed(1)}%`],
          ['AGGRESSION', stats.aggression.toFixed(2)],
          ['SHOWDOWN WINS', `${(stats.showdownWinRate * 100).toFixed(1)}%`],
          ['AVG DECISION', `${stats.averageDecisionMs} MS`],
          ['AVG BET', `${stats.averageBetChips} CHIPS`],
        ].map(([label, value]) => (
          <div key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {values.length > 1 ? (
        <div className="bankroll-chart">
          <small>CHIP STACK / RECORDED HANDS</small>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Agent chip stack chart">
            <polyline points={points} fill="none" stroke="#f4813c" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
      ) : (
        <p>The bankroll chart appears after two recorded hands.</p>
      )}
      <p>{stats.note}</p>
    </section>
  );
}

export function AgentPage({
  arena,
  id,
  notify,
}: {
  arena: ReturnType<typeof useArena>;
  id: string;
  notify: (x: string) => void;
}) {
  const a = arena.agents.find(a => a.id === id),
    stats = arena.leaders.find(x => x.id === id);
  if (!a)
    return (
      <main className="page">
        <Empty text="Agent not found." />
      </main>
    );
  const owned = a.owner === arena.owner;
  return (
    <main className="page">
      <button className="back-link" onClick={() => go('/agents')}>
        <ChevronLeft size={15} /> all_agents
      </button>
      <div className="agent-hero">
        <div className="agent-emblem giant">{a.name[0]}</div>
        <div>
          <small>AGENT PROFILE / {a.nearAccount}</small>
          <h1>{a.name}</h1>
          <p>{a.description || 'No strategy notes published.'}</p>
          <div className="agent-tags">
            <Tag>{a.strategy.toUpperCase()}</Tag>
            <Tag>{a.model}</Tag>
            <Tag tone="mint">{a.state === 'active' ? 'NEAR ACCOUNT' : a.state.toUpperCase()}</Tag>
            <Tag>OWNER {a.owner}</Tag>
          </div>
        </div>
        <div className="rep-score">
          <small>REPUTATION</small>
          <strong>{stats?.reputation || 0}</strong>
          <span>MEASURED PERFORMANCE</span>
        </div>
      </div>
      <div className="profile-stats">
        {[
          ['SKILL RATING', stats?.rating ?? 1200],
          ['TOURNAMENTS', stats?.tournaments || 0],
          ['WINS', stats?.wins || 0],
          ['WIN RATE', `${((stats?.winRate || 0) * 100).toFixed(1)}%`],
          ['NET PROFIT', `${stats?.profitNear || '0'} NEAR`],
          ['ROI', `${(stats?.roi || 0).toFixed(1)}%`],
          ['HANDS', stats?.hands || 0],
        ].map(([label, value]) => (
          <div key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <AnalyticsPanel id={id} />
      <div className="profile-grid">
        {a.state === 'active' ? (
          <AgentNearPanel agentId={a.id} owned={owned} config={arena.config} notify={notify} />
        ) : (
          <section className="content-panel">
            <div className="panel-heading">
              <span>NEAR AGENT ACCOUNT</span>
              <Wallet size={18} />
            </div>
            <p>
              {a.state === 'creating'
                ? 'The arena contract is creating this account on NEAR.'
                : 'Account creation did not finish.'}
            </p>
            {owned && (
              <button
                onClick={() =>
                  void api(`/api/agents/${a.id}/provision`, { method: 'POST', body: '{}' })
                    .then(() => arena.refresh())
                    .catch((e: Error) => notify(e.message))
                }
              >
                RETRY ACCOUNT CREATION
              </button>
            )}
          </section>
        )}
        <section className="content-panel">
          <div className="panel-heading">
            <span>TOURNAMENT HISTORY</span>
            <Trophy size={18} />
          </div>
          {arena.tournaments
            .filter(t => t.entries.some(e => e.agentId === a.id))
            .map(t => (
              <button className="history-row" key={t.id} onClick={() => go(`/arenas/${t.id}`)}>
                <span>
                  <b>{t.name}</b>
                  <small>
                    {t.state.toUpperCase()} · {t.handNumber} HANDS
                  </small>
                </span>
                <strong>
                  {t.leaderId === a.id ? 'CHAMPION' : 'VIEW MATCH'} <ArrowUpRight size={15} />
                </strong>
              </button>
            ))}
          {!arena.tournaments.some(t => t.entries.some(e => e.agentId === a.id)) && (
            <Empty text="This agent has not entered an arena yet." />
          )}
        </section>
      </div>
    </main>
  );
}
