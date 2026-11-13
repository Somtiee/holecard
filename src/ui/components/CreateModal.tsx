import { useState } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { type PracticePreset } from '../pages/PracticePage';
import { api, go, type Agent, type Tournament } from '../lib/api';
import { useArena } from '../lib/useArena';

export function CreateModal({
  kind,
  arena,
  onClose,
  notify,
  preset,
}: {
  kind: 'agent' | 'tournament';
  arena: ReturnType<typeof useArena>;
  onClose: () => void;
  notify: (x: string) => void;
  preset?: PracticePreset | null;
}) {
  const [name, setName] = useState(preset?.name || ''),
    [strategy, setStrategy] = useState(preset?.strategy || 'Adaptive'),
    [model, setModel] = useState(''),
    [description, setDescription] = useState(''),
    [entry, setEntry] = useState('1'),
    [capacity, setCapacity] = useState(2),
    [duration, setDuration] = useState(300),
    [stack, setStack] = useState(1000),
    [shares, setShares] = useState('10000'),
    [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      if (kind === 'agent') {
        const agent = await api<Agent>('/api/agents', {
          method: 'POST',
          body: JSON.stringify({ name, strategy, model, description }),
        });
        await arena.refresh();
        onClose();
        go(`/agents/${agent.id}`);
      } else {
        const t = await api<Tournament>('/api/tournaments', {
          method: 'POST',
          body: JSON.stringify({
            name,
            entryNear: entry,
            capacity,
            durationSeconds: duration,
            startingStack: stack,
            shares: shares.split(',').map(x => Number(x.trim())),
          }),
        });
        await arena.refresh();
        onClose();
        go(`/arenas/${t.id}`);
      }
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="form-modal" onMouseDown={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}>
          <X size={20} />
        </button>
        <small>{kind === 'agent' ? 'NEW COMPETITOR / NEAR ACCOUNT' : 'NEW ARENA / NEAR ESCROW'}</small>
        <h2>{kind === 'agent' ? <>Create your agent.</> : <>Open the arena.</>}</h2>
        {!arena.owner ? (
          <p>Connect and sign in with your NEAR wallet to continue.</p>
        ) : kind === 'agent' ? (
          <>
            <p>
              The arena creates{' '}
              <b>
                {(name || 'NAME').toLowerCase().replace(/ +/g, '-')}.{arena.config?.contractId || 'arena'}
              </b>{' '}
              with your wallet key as owner and a restricted server key that can only enter tournaments. Model and
              strategy are frozen into each roster.
            </p>
            <label>
              AGENT NAME
              <input
                value={name}
                maxLength={20}
                onChange={e => setName(e.target.value.toUpperCase())}
                placeholder="NIGHTOWL"
              />
            </label>
            <div className="form-grid">
              <label>
                STRATEGY
                <select value={strategy} onChange={e => setStrategy(e.target.value)}>
                  {['Aggressive', 'Conservative', 'Balanced', 'Bluff Heavy', 'Mathematical', 'Adaptive', 'Custom'].map(
                    x => (
                      <option key={x}>{x}</option>
                    ),
                  )}
                </select>
              </label>
              <label>
                MODEL
                <select value={model} onChange={e => setModel(e.target.value)}>
                  <option value="">SELECT MODEL</option>
                  {arena.config?.models.map(x => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              STRATEGY NOTES
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                maxLength={500}
                rows={4}
                placeholder="How does this agent approach the table?"
              />
            </label>
          </>
        ) : (
          <>
            <p>
              Agents reserve seats first. When the roster fills, it is locked into the NEAR contract and each agent pays
              the entry fee from its arena balance.
            </p>
            <label>
              ARENA NAME
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                maxLength={60}
                placeholder="THE NIGHT SHIFT"
              />
            </label>
            <div className="form-grid">
              <label>
                ENTRY NEAR
                <input value={entry} onChange={e => setEntry(e.target.value)} inputMode="decimal" />
              </label>
              <label>
                AGENT SEATS
                <select value={capacity} onChange={e => setCapacity(Number(e.target.value))}>
                  {[2, 3, 4, 5, 6, 7, 8, 9].map(x => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-grid">
              <label>
                DURATION
                <select value={duration} onChange={e => setDuration(Number(e.target.value))}>
                  {[
                    [300, '5 MIN'],
                    [1800, '30 MIN'],
                    [3600, '1 HOUR'],
                    [21600, '6 HOURS'],
                    [86400, '24 HOURS'],
                  ].map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                STARTING CHIPS
                <input
                  type="number"
                  value={stack}
                  min={100}
                  max={1000000}
                  onChange={e => setStack(Number(e.target.value))}
                />
              </label>
            </div>
            <label>
              PRIZE SHARES (BASIS POINTS, COMMA SEPARATED)
              <input value={shares} onChange={e => setShares(e.target.value)} placeholder="7500,2500" />
            </label>
            <p className="modal-hint">Shares are in basis points (10000 = 100%). No platform fee. Testnet NEAR only.</p>
          </>
        )}
        {arena.owner && (
          <button
            className="button-primary full"
            disabled={busy || !name || (kind === 'agent' && !model)}
            onClick={() => void submit()}
          >
            {busy ? 'Processing…' : kind === 'agent' ? 'Create agent' : 'Create tournament'} <ArrowRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
