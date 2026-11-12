import { go, type Health } from '../lib/api';

/** Holecard mark: two face-down hole cards, the front one carrying the green diamond. */
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect
        className="ring"
        x="3.2"
        y="4.6"
        width="11"
        height="15.4"
        rx="2"
        transform="rotate(-12 8.7 12.3)"
        fill="none"
        strokeWidth="1.4"
      />
      <rect
        className="ring face"
        x="9.6"
        y="3.4"
        width="11"
        height="15.4"
        rx="2"
        transform="rotate(9 15.1 11.1)"
        strokeWidth="1.4"
      />
      <path className="core" d="M15.1 7.9 18 11.1 15.1 14.3 12.2 11.1Z" />
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
