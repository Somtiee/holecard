import './styles.css';
import { useEffect, useState } from 'react';
import { Menu, Sparkles, Wallet, X } from 'lucide-react';
import { signInWithNear, signOutNear } from './wallet/near';
import PracticePage, { type PracticePreset } from './pages/PracticePage';
import { Brand, Status } from './components/Brand';
import { CreateModal } from './components/CreateModal';
import { api, go, route } from './lib/api';
import { useArena } from './lib/useArena';
import { AgentPage } from './pages/AgentPage';
import { AgentsPage } from './pages/AgentsPage';
import { ArenasPage } from './pages/ArenasPage';
import { HomePage } from './pages/HomePage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { NearPage } from './pages/NearPage';
import { TournamentPage } from './pages/TournamentPage';

export default function App() {
  const arena = useArena();
  const [path, setPath] = useState(route),
    [modal, setModal] = useState<'agent' | 'tournament' | null>(null),
    [preset, setPreset] = useState<PracticePreset | null>(null),
    [toast, setToast] = useState(''),
    [menu, setMenu] = useState(false);
  useEffect(() => {
    const fn = () => {
      setPath(route());
      setMenu(false);
      window.scrollTo({ top: 0, behavior: 'instant' });
    };
    addEventListener('hashchange', fn);
    return () => removeEventListener('hashchange', fn);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const network = arena.config?.network || 'testnet';
  const [signIn, setSignIn] = useState(false);
  // Email, Google and passkey sign-in need a NEAR Auth client registered for this domain.
  const socialReady = Boolean(arena.config?.fastAuth?.clientId) || location.origin === 'http://localhost:3000';
  const connectSocial = async () => {
    setSignIn(false);
    try {
      if (!arena.config?.fastAuth) throw new Error('NEAR Auth is not configured.');
      setToast('Opening NEAR Auth…');
      const { startNearAuth } = await import('./wallet/fastauth');
      await startNearAuth(arena.config.fastAuth);
    } catch (error) {
      setToast((error as Error).message);
    }
  };
  // Finish a NEAR Auth redirect round-trip (login, then message approval) when the page comes back.
  useEffect(() => {
    const cfg = arena.config?.fastAuth;
    if (!cfg) return;
    let pending = false;
    try {
      pending = Boolean(sessionStorage.getItem('arena.nearauth.stage'));
    } catch {
      /* storage blocked */
    }
    if (!pending) return;
    void import('./wallet/fastauth')
      .then(m => m.resumeNearAuth(cfg))
      .then(async session => {
        if (session) {
          arena.setOwner(session.accountId);
          await arena.refresh();
          setToast(`Signed in with NEAR Auth as ${session.accountId.slice(0, 10)}…`);
        }
      })
      .catch((error: Error) => setToast(error.message));
  }, [arena.config?.fastAuth?.contractId]);
  const connect = async () => {
    setSignIn(false);
    try {
      const session = await signInWithNear(network);
      arena.setOwner(session.accountId);
      await arena.refresh();
      setToast(`Signed in as ${session.accountId}.`);
    } catch (error) {
      setToast((error as Error).message);
    }
  };
  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST', body: '{}' });
    await signOutNear(network);
    await import('./wallet/fastauth').then(m => m.signOutNearAuth()).catch(() => {});
    arena.setOwner(null);
    setToast('Signed out.');
  };
  const openAgentWith = (from: PracticePreset | null) => {
    setPreset(from);
    if (!arena.config?.nearReady || !arena.config?.models.length) {
      setToast('The arena contract and a NEAR AI Cloud model must be configured before agent creation.');
      return;
    }
    setModal('agent');
  };
  const openAgent = () => openAgentWith(null);
  const openTournament = () => {
    if (!arena.health?.tournamentLaunchReady) {
      setToast('The arena contract and NEAR AI Cloud must be configured before creating an arena.');
      return;
    }
    setModal('tournament');
  };
  const content =
    path === '/practice' ? (
      <PracticePage onMakeReal={openAgentWith} />
    ) : path === '/near' ? (
      <NearPage config={arena.config} signedIn={Boolean(arena.owner)} notify={setToast} />
    ) : path === '/' ? (
      <HomePage arena={arena} onCreateAgent={openAgent} onCreateTournament={openTournament} />
    ) : path === '/arenas' ? (
      <ArenasPage arena={arena} onCreate={openTournament} />
    ) : path.startsWith('/arenas/') ? (
      <TournamentPage arena={arena} id={path.split('/')[2]} notify={setToast} />
    ) : path === '/agents' ? (
      <AgentsPage arena={arena} onCreate={openAgent} />
    ) : path.startsWith('/agents/') ? (
      <AgentPage arena={arena} id={path.split('/')[2]} notify={setToast} />
    ) : path === '/leaderboard' ? (
      <LeaderboardPage arena={arena} />
    ) : (
      <HomePage arena={arena} onCreateAgent={openAgent} onCreateTournament={openTournament} />
    );
  const nav: [string, string][] = [
    ['/practice', 'practice'],
    ['/arenas', 'arenas'],
    ['/agents', 'agents'],
    ['/leaderboard', 'leaderboard'],
    ['/near', 'on_near'],
  ];
  return (
    <div className="product">
      <header className="site-header">
        <div className="wrap nav-in">
          <Brand />
          <nav className={menu ? 'open' : ''}>
            {nav.map(([href, label]) => (
              <button
                key={href}
                className={path === href || path.startsWith(`${href}/`) ? 'active' : ''}
                onClick={() => go(href)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="header-right">
            <Status health={arena.health} network={arena.config?.network} />
            <span className="signin-wrap">
              <button
                className="connect-button"
                onClick={() => (arena.owner ? void logout() : socialReady ? setSignIn(!signIn) : void connect())}
              >
                {arena.owner ? (
                  <>
                    <Wallet size={14} />
                    {arena.owner.length > 24 ? `${arena.owner.slice(0, 8)}…${arena.owner.slice(-4)}` : arena.owner}
                  </>
                ) : (
                  'sign_in'
                )}
              </button>
              {signIn && socialReady && !arena.owner && (
                <span className="signin-menu">
                  <button
                    title="Email, Google and passkey sign-in through NEAR Auth"
                    onClick={() => void connectSocial()}
                  >
                    Email · Google · Passkey
                    <small>NEAR Auth · no wallet, no gas</small>
                  </button>
                  <button onClick={() => void connect()}>
                    NEAR wallet<small>Meteor, Intear, Nightly, Ledger…</small>
                  </button>
                </span>
              )}
            </span>
            <button className="menu-button" aria-label="Menu" onClick={() => setMenu(!menu)}>
              {menu ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
      </header>
      {!arena.loading && !arena.health?.tournamentLaunchReady && (
        <div className="release-banner">
          <div className="wrap">
            <span>Testnet setup in progress</span>Agent creation and tournaments open once the arena contract and NEAR
            AI Cloud are configured on this server.
          </div>
        </div>
      )}
      {arena.loading ? (
        <div className="loading-scene">
          <span />
          <b>Holecard</b>
          <small>Connecting to NEAR</small>
        </div>
      ) : (
        content
      )}
      <footer className="site-footer">
        <div className="wrap">
          <div className="f-top">
            <div>
              <Brand />
              <p className="f-b">AI-agent competition infrastructure on NEAR. Poker is the first arena.</p>
            </div>
            <div className="f-col">
              <h4>arena</h4>
              <ul>
                <li>
                  <button onClick={() => go('/practice')}>Practice table</button>
                </li>
                <li>
                  <button onClick={() => go('/arenas')}>Tournaments</button>
                </li>
                <li>
                  <button onClick={() => go('/agents')}>Agents</button>
                </li>
                <li>
                  <button onClick={() => go('/leaderboard')}>Leaderboard</button>
                </li>
              </ul>
            </div>
            <div className="f-col">
              <h4>near</h4>
              <ul>
                <li>
                  <button onClick={() => go('/near')}>How it uses NEAR</button>
                </li>
                {arena.config?.contractId && (
                  <li>
                    <a
                      href={`${arena.config.explorer}/address/${arena.config.contractId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Arena contract ↗
                    </a>
                  </li>
                )}
                {arena.config?.agentMarket.listing && (
                  <li>
                    <a href={arena.config.agentMarket.listing} target="_blank" rel="noreferrer">
                      Agent Market ↗
                    </a>
                  </li>
                )}
              </ul>
            </div>
            <div className="f-col">
              <h4>network</h4>
              <ul>
                <li>NEAR {network}</li>
                <li>NEAR AI Cloud</li>
                <li>NEAR Intents</li>
              </ul>
            </div>
          </div>
          <div className="f-bottom">
            <p className="legal">
              A testnet arena built for the NEAR hackathon. Poker runs offchain; escrow, payouts and an OutLayer replay
              of every result are enforced by the NEAR contract. Testnet NEAR has no value.
            </p>
            <span>© {new Date().getFullYear()} Holecard</span>
          </div>
        </div>
      </footer>
      {modal && (
        <CreateModal
          kind={modal}
          arena={arena}
          preset={modal === 'agent' ? preset : null}
          onClose={() => setModal(null)}
          notify={setToast}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Sparkles size={17} />
          {toast}
          <button aria-label="Dismiss" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
