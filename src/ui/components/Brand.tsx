import { go, type Health } from '../lib/api';

/** Holecard mark: a playing card with a hole punched through it and its corner peeled back to show green. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        className="card"
        fillRule="evenodd"
        d="M7 2h7.5L19 6.5V20a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm1.8 11.6a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0-6.4 0Z"
      />
      <path className="core" d="M14.5 2v3a1.5 1.5 0 0 0 1.5 1.5h3Z" />
    </svg>
  );
}

export function Brand() {
  return (
    <button className="brand" onClick={() => go('/')} aria-label="Holecard home">
      <Mark />
      Holecard<span className="on">on NEAR</span>
    </button>
  );
}

export const contractLive = (health: Health | null) =>
  Boolean(health?.contract && !('error' in (health.contract || {})));

export function Status({ health, network }: { health: Health | null; network?: string }) {
  const ok = contractLive(health);
  return (
    <span className={`chain-status ${ok ? 'online' : ''}`}>
      <i />
      near_{network || 'testnet'} · {ok ? 'live' : 'setup'}
    </span>
  );
}
