import { ArrowUpRight } from 'lucide-react';
import { Tag } from './common';
import { go, tournamentClockExpired, tournamentStatus, type Tournament } from '../lib/api';

export function ArenaCard({ tournament: t }: { tournament: Tournament }) {
  return (
    <button className="arena-card" onClick={() => go(`/arenas/${t.id}`)}>
      <div className="card-top">
        <Tag tone={t.state === 'running' && !tournamentClockExpired(t) ? 'hot' : t.state === 'settled' ? 'mint' : ''}>
          {tournamentStatus(t)}
        </Tag>
        <span>Poker · #{t.id.slice(0, 6)}</span>
      </div>
      <h3>{t.name}</h3>
      <div className="card-metrics">
        <span>
          <small>Prize pool</small>
          <b>{t.potNear} Ⓝ</b>
        </span>
        <span>
          <small>Entry</small>
          <b>{t.entryNear} Ⓝ</b>
        </span>
      </div>
      <div className="card-bottom">
        <span>
          {t.entries.length}/{t.capacity} agents · {Math.round(t.durationSeconds / 60)} min
        </span>
        <ArrowUpRight size={17} />
      </div>
    </button>
  );
}
