import { ArrowRight, X } from 'lucide-react';
import { useCurrentFrame } from 'remotion';
import real from '../data/real.json';
import { C, F } from '../lib/theme';
import { clamp01, count, easeOut, enter } from '../lib/anim';
import { LEN, T } from '../timeline';
import { Page, Toast } from '../ui/App';
import { Caption, NetBadge, TechTag } from '../ui/Caption';
import { AgentHero, AgentNearPanel, HistoryPanel } from '../ui/Near';
import { Callout, Cursor, deviceIn, Paper, Shot, Spot, useLayout } from '../ui/Shot';

/** Example data (not from chain): the signed-in owner account. */
export const OWNER = 'you.testnet';
const NIGHTOWL = real.wallets.nightowl;
const MIRAGE = real.wallets.mirage;
const fmt = (v: number) => (Math.round(v * 10000) / 10000).toString(); // chain.ts formatNear style

function NightowlPage({ balance, keysShown, keyFlash, quote, pressed }: { balance: string; keysShown?: number; keyFlash?: number; quote?: boolean; pressed?: string }) {
  return (
    <main className="page">
      <AgentHero name="NIGHTOWL" account={NIGHTOWL.nearAccount} strategy="Mathematical" model="z-ai/glm-5.3-flash" owner={OWNER} />
      <div className="profile-grid">
        <AgentNearPanel wallet={NIGHTOWL} balance={balance} keysShown={keysShown} keyFlash={keyFlash} quote={quote ? real.quote : null} pressed={pressed} />
        <HistoryPanel rows={[]} />
      </div>
    </main>
  );
}

function HomeLead() {
  return (
    <section className="hero-sub" style={{ paddingTop: 90 }}>
      <div className="wrap">
        <p className="eyebrow">AI agent poker · NEAR testnet</p>
        <p className="hero-lead">
          Give an AI agent its own NEAR account, a strategy and a seat at the table. It plays poker for a NEAR prize pool and
          builds a public record.
        </p>
        <div className="actions">
          <button className="btn">Play a free practice match</button>
          <button className="btn ghost">Enter the arena</button>
          <button className="btn ghost">How it uses NEAR</button>
        </div>
      </div>
    </section>
  );
}

/* ---------- scene 4: sign in ---------- */

const WALLETS = ['Meteor', 'Intear', 'Nightly', 'Ledger', 'NEAR CLI'];

function Picker({ at, pick }: { at: number; pick: number }) {
  const frame = useCurrentFrame();
  const a = clamp01((frame - at) / 10);
  return (
    <div style={{ position: 'absolute', inset: 0, background: `rgba(10,10,10,${0.42 * a})`, zIndex: 50 }}>
      <div
        data-cam="picker"
        style={{
          position: 'absolute',
          left: 640 - 230,
          top: 150,
          width: 460,
          background: '#fff',
          borderRadius: 22,
          padding: 22,
          opacity: a,
          transform: `translateY(${(1 - easeOut(a)) * 30}px)`,
          boxShadow: '0 30px 60px rgba(0,0,0,0.3)',
          display: 'grid',
          gap: 8,
        }}
      >
        {WALLETS.map((w, i) => (
          <div
            key={w}
            data-cam={`wallet-${i}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: '14px 16px',
              borderRadius: 14,
              background: frame >= pick && i === 0 ? '#eef9f1' : '#f5f5f3',
              border: frame >= pick && i === 0 ? `2px solid ${C.green}` : '2px solid transparent',
              font: `500 20px ${F.sans}`,
            }}
          >
            <span style={{ width: 40, height: 40, borderRadius: 12, background: ['#111', '#5b3df5', '#7a5af8', '#1d1d1d', '#e6e6e3'][i], display: 'grid', placeItems: 'center', color: i === 4 ? '#111' : '#fff', font: `600 18px ${F.mono}` }}>
              {w[0]}
            </span>
            {w}
          </div>
        ))}
      </div>
    </div>
  );
}

function SignSheet({ at, sign }: { at: number; sign: number }) {
  const frame = useCurrentFrame();
  const a = clamp01((frame - at) / 10);
  const pressed = frame >= sign && frame < sign + 6;
  const gone = clamp01((frame - sign - 8) / 8);
  if (frame < at) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, background: `rgba(10,10,10,${0.42 * a * (1 - gone)})`, zIndex: 60 }}>
      <div
        data-cam="sheet"
        style={{
          position: 'absolute',
          left: 640 - 260,
          top: 110,
          width: 520,
          background: '#fff',
          borderRadius: 22,
          padding: '26px 28px',
          opacity: a * (1 - gone),
          transform: `translateY(${(1 - easeOut(a)) * 30 + gone * 20}px)`,
          boxShadow: '0 30px 60px rgba(0,0,0,0.3)',
        }}
      >
        <div style={{ font: `600 26px ${F.display}`, letterSpacing: '-0.02em' }}>Sign message</div>
        <div style={{ font: `400 15px ${F.mono}`, color: '#666', marginTop: 6 }}>holecard.fun · {OWNER} · testnet</div>
        <pre
          data-cam="message"
          style={{ margin: '18px 0 0', padding: 16, background: '#f5f5f3', borderRadius: 12, font: `400 15px/1.55 ${F.mono}`, whiteSpace: 'pre-wrap', color: '#222' }}
        >
          {'Holecard sign-in\nPurpose: manage AI agents and NEAR tournament entries.\nIssued: 2026-11-13T09:14:02.118Z'}
        </pre>
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <span style={{ flex: 1, textAlign: 'center', padding: '13px 0', borderRadius: 999, border: '1.5px solid #ccc', font: `500 16px ${F.sans}` }}>Cancel</span>
          <span
            data-cam="signBtn"
            style={{ flex: 1, textAlign: 'center', padding: '13px 0', borderRadius: 999, background: C.ink, color: '#fff', font: `500 16px ${F.sans}`, transform: pressed ? 'scale(0.96)' : undefined }}
          >
            Sign
          </span>
        </div>
      </div>
    </div>
  );
}

function AnnotationChips({ at, items, x, y }: { at: number; items: string[]; x: number; y: number }) {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: 'absolute', left: x, top: y, display: 'flex', gap: 10, zIndex: 70 }}>
      {items.map((it, i) => {
        const a = clamp01((frame - at - i * 5) / 8);
        return (
          <span key={it} style={{ opacity: a, transform: `translateY(${(1 - a) * 10}px)`, background: C.green, color: C.ink, borderRadius: 999, padding: '7px 14px', font: `500 15px ${F.mono}` }}>
            {it}
          </span>
        );
      })}
    </div>
  );
}

export function SignIn() {
  const frame = useCurrentFrame();
  const layout = useLayout();
  const t = T.signin;
  const signed = frame >= t.signed;
  const insetA = clamp01((frame - t.inset) / 12);
  const h = layout === 'h';
  return (
    <Paper grain={0.08}>
      <Shot
        url="holecard.fun"
        style={deviceIn(frame, LEN.signin)}
        cams={[
          { at: 0, x: 900, y: 200, s: 1.35 },
          { at: t.picker, x: 640, y: 330, s: 1.15 },
          { at: t.sheet + 4, target: 'message', s: 1.55, dur: 20 },
          { at: t.signed, x: 900, y: 150, s: 1.25 },
        ]}
        overlay={signed && frame < t.signed + 70 ? <Toast text={`Signed in as ${OWNER}.`} opacity={clamp01((frame - t.signed) / 8)} /> : null}
      >
        <Page path="/" owner={signed ? OWNER : null}>
          <HomeLead />
        </Page>
        {frame >= t.picker && frame < t.sheet + 4 && <Picker at={t.picker} pick={t.pickWallet} />}
        <SignSheet at={t.sheet} sign={t.sign} />
        {frame >= t.sheet + 10 && frame < t.sign + 10 && <AnnotationChips at={t.sheet + 22} items={['nep-413', 'no transaction', 'no fee']} x={640 - 260} y={78} />}
        <Cursor
          moves={[
            { at: t.click, target: 'signin', click: true },
            { at: t.pickWallet, target: 'wallet-0', click: true },
            { at: t.sign, target: 'signBtn', click: true },
          ]}
          hideAfter={t.sign + 20}
        />
      </Shot>
      {frame >= t.inset && (
        <div style={{ opacity: insetA, transform: `translateY(${(1 - easeOut(insetA)) * 30}px)` }}>
          <div
            style={{
              position: 'absolute',
              left: h ? 420 : 300,
              top: h ? 520 : 760,
              zIndex: 80,
              background: C.ink,
              color: '#fff',
              borderRadius: 999,
              padding: '8px 18px',
              font: `500 ${h ? 20 : 24}px ${F.mono}`,
            }}
          >
            local_build · localhost:3000
          </div>
          <Shot
            url="localhost:3000"
            box={h ? { x: 400, y: 560, w: 820, h: 400 } : { x: 260, y: 800, w: 760, h: 400 }}
            pageW={900}
            cams={[{ at: 0, x: 900, y: 130, s: 1.45 }]}
            style={{ boxShadow: '0 40px 80px rgba(0,0,0,0.35), 0 0 0 3px #111' }}
          >
            <Page
              path="/"
              menu={
                <span className="signin-menu">
                  <button>
                    Email · Google · Passkey
                    <small>NEAR Auth · no wallet, no gas</small>
                  </button>
                  <button>
                    NEAR wallet<small>Meteor, Intear, Nightly, Ledger…</small>
                  </button>
                </span>
              }
            >
              <div style={{ height: 300 }} />
            </Page>
          </Shot>
        </div>
      )}
      <TechTag
        tags={[
          { at: t.picker, key: 'connect' },
          { at: t.sheet, key: 'nep413' },
          { at: t.inset, key: 'auth' },
        ]}
      />
      <Caption
        end={LEN.signin}
        caps={[
          { at: 0, n: '02 / sign in', title: 'Sign in with NEAR.', line: 'Pick any NEAR wallet.' },
          { at: t.picker, n: '02 / sign in', title: 'One picker for every NEAR wallet.', tech: 'connect' },
          { at: t.sheet, n: '02 / sign in', title: 'Sign a message, not a transaction.', tech: 'nep413' },
          { at: t.inset, n: '02 / sign in', title: 'No wallet? Email, Google or passkey.', line: 'Local build only. holecard.fun signs in with a wallet until NEAR Auth has a client for that domain.', tech: 'auth' },
        ]}
      />
      <NetBadge />
    </Paper>
  );
}

/* ---------- scene 5: the keys ---------- */

function CreateModal({ name, strategy, model, busy, pressed }: { name: string; strategy: string; model: string; busy: boolean; pressed: boolean }) {
  return (
    <div className="modal-backdrop" style={{ position: 'absolute' }}>
      <div className="form-modal" data-cam="createModal">
        <button className="modal-x">
          <X size={20} />
        </button>
        <small>NEW COMPETITOR / NEAR ACCOUNT</small>
        <h2>Create your agent.</h2>
        <p>
          The arena creates{' '}
          <b data-cam="subaccount">
            {(name || 'NAME').toLowerCase().replace(/ +/g, '-')}.{real.match.entries[0].nearAccount.split('.').slice(1).join('.')}
          </b>{' '}
          with your wallet key as owner and a restricted server key that can only enter tournaments. Model and strategy are
          frozen into each roster.
        </p>
        <label>
          AGENT NAME
          <input value={name} readOnly placeholder="NIGHTOWL" />
        </label>
        <div className="form-grid">
          <label>
            STRATEGY
            <select value={strategy} onChange={() => {}}>
              <option>{strategy}</option>
            </select>
          </label>
          <label>
            MODEL
            <select value={model} onChange={() => {}} data-cam="model">
              <option value="">SELECT MODEL</option>
              <option value="z-ai/glm-5.3-flash">z-ai/glm-5.3-flash</option>
            </select>
          </label>
        </div>
        <label>
          STRATEGY NOTES
          <textarea value="" readOnly rows={4} placeholder="How does this agent approach the table?" />
        </label>
        <button className="button-primary full" disabled={!model} data-cam="create" style={pressed ? { transform: 'scale(0.97)' } : undefined}>
          {busy ? 'Processing…' : 'Create agent'} <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

export function Keys() {
  const frame = useCurrentFrame();
  const t = T.keys;
  const onPage = frame >= t.page;
  const keysShown = frame < t.keysOn ? 0 : frame < t.keysOn + t.keyStep ? 1 : 2;
  const keyFlash = frame >= t.keysOn && frame < t.keysOn + 10 ? 0 : frame >= t.keysOn + t.keyStep && frame < t.keysOn + t.keyStep + 10 ? 1 : -1;
  return (
    <Paper grain={0.08}>
      <Shot
        url={onPage ? `holecard.fun/#/agents/${NIGHTOWL.agentId}` : 'holecard.fun/#/agents'}
        style={deviceIn(frame, LEN.keys)}
        cams={
          onPage
            ? [
                { at: 0, x: 640, y: 330, s: 1.05 },
                { at: t.page + 34, target: 'address', s: 1.7, dur: 22 },
                { at: t.keysOn - 14, target: 'keys', s: 1.8, dur: 18 },
                { at: t.push, target: 'serverKey', s: 1.95, dur: 26 },
              ]
            : [
                { at: 0, target: 'createModal', s: 1.1 },
                { at: 20, target: 'subaccount', s: 1.6, dur: 20 },
                { at: t.model - 14, target: 'model', s: 1.3, dur: 14 },
              ]
        }
      >
        <Page path="/agents" owner={OWNER}>
          {onPage ? <NightowlPage balance="0" keysShown={keysShown} keyFlash={keyFlash} /> : <div style={{ height: 900 }} />}
        </Page>
        {!onPage && <CreateModal name="NIGHTOWL" strategy="Mathematical" model={frame >= t.model ? 'z-ai/glm-5.3-flash' : ''} busy={frame >= t.create + 4} pressed={frame >= t.create && frame < t.create + 5} />}
        {onPage && <Spot target="restricted" at={t.push + 22} pad={6} />}
        {onPage && <Spot target="address" at={t.page + 44} end={t.keysOn - 14} pad={6} />}
        {!onPage && <Spot target="subaccount" at={26} end={t.model - 16} pad={4} />}
        <Cursor
          key={onPage ? 'p' : 'm'}
          moves={
            onPage
              ? []
              : [
                  { at: t.model, target: 'model', click: true },
                  { at: t.create, target: 'create', click: true },
                ]
          }
        />
      </Shot>
      <TechTag
        tags={[
          { at: 0, key: 'subaccounts' },
          { at: t.keysOn - 14, key: 'fckeys' },
        ]}
      />
      <Caption
        end={LEN.keys}
        caps={[
          { at: 0, n: '03 / answer 1 · who holds its keys?', title: 'Every agent is its own NEAR account.', tech: 'subaccounts' },
          { at: t.keysOn - 14, n: '03 / answer 1 · who holds its keys?', title: 'The server can play for your agent. It can never take its money.', tech: 'fckeys' },
        ]}
      />
      <NetBadge />
    </Paper>
  );
}

/* ---------- scene 6: fund it ---------- */

export function Fund() {
  const frame = useCurrentFrame();
  const t = T.fund;
  const bal = count(frame, t.claim + 14, 24, 0, 1);
  const quote = frame >= t.quoteShown;
  const toastA = frame >= t.claim + 10 && frame < t.claim + 90 ? clamp01((frame - t.claim - 10) / 8) : 0;
  return (
    <Paper grain={0.08}>
      <Shot
        url={`holecard.fun/#/agents/${NIGHTOWL.agentId}`}
        style={deviceIn(frame, LEN.fund)}
        cams={[
          { at: 0, target: 'fundRow', s: 1.55, dy: 40 },
          { at: t.claim + 8, target: 'balance', s: 1.7, dur: 18 },
          { at: t.quotePick - 24, target: 'intents', s: 1.6, dur: 22 },
          { at: t.quoteShown + 6, target: 'quote', s: 2.0, dur: 22 },
        ]}
        overlay={toastA ? <Toast text="Starter stake of 1 testnet NEAR deposited by the arena." opacity={toastA} /> : null}
      >
        <Page path={`/agents/${NIGHTOWL.agentId}`} owner={OWNER}>
          <NightowlPage
            balance={fmt(bal)}
            keysShown={2}
            quote={quote}
            pressed={frame >= t.claim && frame < t.claim + 5 ? 'claim' : frame >= t.quote && frame < t.quote + 5 ? 'quote' : undefined}
          />
        </Page>
        <Spot target="deposit" at={14} end={t.claim - 14} pad={5} />
        <Spot target="quote" at={t.quoteShown + 20} pad={6} />
        <Cursor
          moves={[
            { at: 22, target: 'deposit' },
            { at: t.claim, target: 'claim', click: true },
            { at: t.quote, target: 'quoteBtn', click: true },
          ]}
        />
      </Shot>
      <TechTag
        tags={[
          { at: 0, key: 'nep366' },
          { at: t.quotePick - 24, key: 'intents' },
        ]}
      />
      <Caption
        end={LEN.fund}
        caps={[
          { at: 0, n: '04 / fund it', title: 'Fund it with no NEAR to start.', line: 'DEPOSIT is signed by your wallet. The relayer pays the gas.', tech: 'nep366' },
          { at: t.quotePick - 24, n: '04 / fund it', title: 'Or quote it from another chain.', line: 'A dry-run quote. Nothing executes on testnet.', tech: 'intents' },
        ]}
      />
      <NetBadge />
    </Paper>
  );
}

/* ---------- scene 12: withdraw ---------- */

export function Withdraw() {
  const frame = useCurrentFrame();
  const t = T.withdraw;
  const bal = 1 - count(frame, t.done, 20, 0, 1);
  const toastA = frame >= t.done ? clamp01((frame - t.done) / 8) : 0;
  return (
    <Paper grain={0.08}>
      <Shot
        url={`holecard.fun/#/agents/${NIGHTOWL.agentId}`}
        style={deviceIn(frame, LEN.withdraw)}
        cams={[
          { at: 0, target: 'fundRow', s: 1.6, dy: -60 },
          { at: t.done, target: 'balance', s: 1.7, dur: 18, dy: 40 },
        ]}
        overlay={toastA ? <Toast text="Withdrawal sent to your wallet." opacity={toastA} /> : null}
      >
        <Page path={`/agents/${NIGHTOWL.agentId}`} owner={OWNER}>
          <NightowlPage balance={fmt(bal)} keysShown={2} pressed={frame >= t.click && frame < t.click + 5 ? 'withdraw' : undefined} />
        </Page>
        <Cursor moves={[{ at: t.click, target: 'withdraw', click: true }]} hideAfter={t.done + 10} />
        <Callout target="balance" at={t.done + 10} side="bottom" dx={0} dy={-8}>
          1 NEAR → owner wallet {OWNER}
        </Callout>
      </Shot>
      <TechTag tags={[{ at: 0, key: 'fckeys' }]} />
      <Caption
        end={LEN.withdraw}
        caps={[
          {
            at: 0,
            n: '10 / withdraw',
            title: 'Even the agent’s own key can only send winnings home.',
            line: 'withdraw always pays the owner account recorded in the contract.',
          },
        ]}
      />
      <NetBadge />
    </Paper>
  );
}

/* ---------- scene 11 (part 1): trophies on HOUSE MIRAGE ---------- */

export function MiragePage({ trophiesShown }: { trophiesShown: number }) {
  return (
    <main className="page">
      <AgentHero
        name="HOUSE MIRAGE"
        account={MIRAGE.nearAccount}
        strategy="Bluff Heavy"
        model="Qwen/Qwen3.6-35B-A3B-FP8"
        house
        rating={1201}
        stats={[2, 1, '50.0%', '0.4 NEAR', '40.0%', 19]}
      />
      <div className="profile-grid">
        <AgentNearPanel wallet={MIRAGE} balance="1.4" owned={false} trophiesShown={trophiesShown} />
        <HistoryPanel rows={[{ name: 'Opening Night', state: 'settled', hands: 15, champion: true }]} />
      </div>
    </main>
  );
}

export { NightowlPage, fmt as formatNear, easeOut };
