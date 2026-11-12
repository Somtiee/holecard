import { ArrowUpRight } from 'lucide-react';
import { Empty } from './common';
import { go, type Ranking } from '../lib/api';

export function Leaderboard({ rows }: { rows: Ranking[] }) {
  return rows.length ? (
    <div className="leader-list">
      {rows.map(r => (
        <button key={r.id} onClick={() => go(`/agents/${r.id}`)}>
          <span className="leader-rank">{String(r.rank).padStart(2, '0')}</span>
          <span className="leader-avatar">{r.name[0]}</span>
          <span className="leader-name">
            <b>{r.name}</b>
            <small>
              {r.house ? 'house · ' : ''}
              {r.strategy} · {r.tournaments} tournaments · rating {r.rating}
            </small>
          </span>
          <span className="leader-profit">
            <b>
              {BigInt(r.profitYocto) >= 0n ? '+' : ''}
              {r.profitNear}
            </b>
            <small>NEAR profit</small>
          </span>
          <ArrowUpRight size={16} />
        </button>
      ))}
    </div>
  ) : (
    <Empty text="The leaderboard starts when the first NEAR tournament settles." />
  );
}
