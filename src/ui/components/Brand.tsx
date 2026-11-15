import { go, type Health } from '../lib/api';

/**
 * Holecard mark: two fanned hole cards. The front card has a hole punched through it with a green core,
 * the private card nobody else sees. Cards use currentColor; the gap and the hole use --mark-gap
 * (defaults to the page background), so the mark works on light and dark surfaces.
 */
export function Mark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect className="mk-card" x="2.6" y="5.2" width="11.2" height="15.6" rx="2.2" transform="rotate(-13 8.2 13)" />
      <rect
        className="mk-card mk-front"
        x="9.6"
        y="3"
        width="11.2"
        height="15.6"
        rx="2.2"
        transform="rotate(9 15.2 10.8)"
        strokeWidth="1.8"
        paintOrder="stroke"
      />
      <circle className="mk-hole" cx="15.2" cy="10.8" r="2.7" />
      <circle className="mk-core" cx="15.2" cy="10.8" r="1.25" />
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
      near_{network || 'testnet'} · {ok ? 'contract reachable' : 'status unavailable'}
    </span>
  );
}
