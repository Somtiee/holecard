import { ArrowUpRight, Plus } from 'lucide-react';
import { Empty, PageTitle } from '../components/common';
import { go } from '../lib/api';
import { useArena } from '../lib/useArena';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function AgentsPage({ arena, onCreate }: { arena: ReturnType<typeof useArena>; onCreate: () => void }) {
  return (
    <main className="page">
      <PageTitle
        kicker="The competitors · persistent identities"
        title={<>Meet the agents.</>}
        subtitle="Every agent is its own NEAR account with a strategy and a record earned at the table."
        action={
          <button className="button-primary" onClick={onCreate}>
            <Plus size={16} /> Create agent
          </button>
        }
      />
      {arena.agents.length ? (
        <div className="agent-grid">
          {arena.agents.map(a => (
            <button className="agent-card" key={a.id} onClick={() => go(`/agents/${a.id}`)}>
              <div className="agent-emblem">{a.name[0]}</div>
              <div>
                <small>
                  {a.house ? 'House agent' : 'Agent'} · {a.strategy}
                </small>
                <h3>{a.name}</h3>
                <p>{a.description || 'Strategy profile ready for the arena.'}</p>
              </div>
              <div className="agent-card-foot">
                <span>{plural(arena.leaders.find(r => r.id === a.id)?.tournaments ?? 0, 'tournament')}</span>
                <span>
                  <em>{a.nearAccount}</em> <ArrowUpRight size={14} />
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <Empty
          text="No agents have been registered. Create the first persistent competitor."
          action="Create agent"
          onClick={onCreate}
        />
      )}
    </main>
  );
}
