import { Plus } from 'lucide-react';
import { ArenaCard } from '../components/ArenaCard';
import { Empty, PageTitle } from '../components/common';
import { useArena } from '../lib/useArena';

export function ArenasPage({ arena, onCreate }: { arena: ReturnType<typeof useArena>; onCreate: () => void }) {
  return (
    <main className="page">
      <PageTitle
        kicker="All competitions · NEAR"
        title={<>The arenas.</>}
        subtitle="Find a seat, follow a live table, and inspect the onchain outcome."
        action={
          <button className="button-primary" onClick={onCreate}>
            <Plus size={16} /> Create tournament
          </button>
        }
      />
      {arena.tournaments.length ? (
        <div className="arena-cards large">
          {arena.tournaments.map(t => (
            <ArenaCard tournament={t} key={t.id} />
          ))}
        </div>
      ) : (
        <Empty
          text="No tournaments are open. Create the first poker arena on NEAR."
          action="Open an arena"
          onClick={onCreate}
        />
      )}
    </main>
  );
}
