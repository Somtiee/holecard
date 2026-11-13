import React from 'react';
import { Sparkles, Wallet, X } from 'lucide-react';
import { Mark } from '../../../src/ui/components/Brand';

/** The app shell's header, same markup and classes as src/ui/App.tsx. */
export function Header({ path, owner, menu }: { path: string; owner?: string | null; menu?: React.ReactNode }) {
  const nav: [string, string][] = [
    ['/practice', 'practice'],
    ['/arenas', 'arenas'],
    ['/agents', 'agents'],
    ['/leaderboard', 'leaderboard'],
    ['/near', 'on_near'],
  ];
  return (
    <header className="site-header" style={{ position: 'relative' }}>
      <div className="wrap nav-in">
        <button className="brand">
          <Mark />
          Holecard<span className="on">on NEAR</span>
        </button>
        <nav>
          {nav.map(([href, label]) => (
            <button key={href} className={path === href || path.startsWith(`${href}/`) ? 'active' : ''}>
              {label}
            </button>
          ))}
        </nav>
        <div className="header-right">
          <span className="chain-status online">
            <i />
            near_testnet · live
          </span>
          <span className="signin-wrap">
            <button className="connect-button" data-cam="signin">
              {owner ? (
                <>
                  <Wallet size={14} />
                  {owner}
                </>
              ) : (
                'sign_in'
              )}
            </button>
            {menu}
          </span>
        </div>
      </div>
    </header>
  );
}

/** The app's toast (App.tsx), placed in the page so it zooms with the camera. */
export function Toast({ text, opacity = 1 }: { text: string; opacity?: number }) {
  return (
    <div className="toast" role="status" style={{ opacity, transform: `translateY(${(1 - opacity) * 16}px)` }}>
      <Sparkles size={17} />
      {text}
      <button aria-label="Dismiss">
        <X size={15} />
      </button>
    </div>
  );
}

export function Page({ path, owner, children, menu }: { path: string; owner?: string | null; children: React.ReactNode; menu?: React.ReactNode }) {
  return (
    <div className="product" style={{ position: 'relative' }}>
      <Header path={path} owner={owner} menu={menu} />
      {children}
    </div>
  );
}

export { Mark };
