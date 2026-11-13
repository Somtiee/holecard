import { ArrowRight, Bot, Cpu, ExternalLink, KeyRound, ShieldCheck } from 'lucide-react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import real from '../data/real.json';
import { C, F } from '../lib/theme';
import { clamp01, easeInOut, easeOut, enter, prog } from '../lib/anim';
import { LEN, T } from '../timeline';
import { Page } from '../ui/App';
import { Caption, NetBadge, TechTag } from '../ui/Caption';
import { Badge, Diagram } from '../ui/Diagram';
import { shortId } from '../ui/Near';
import { Callout, Cursor, deviceIn, Paper, Shot, Spot, useLayout } from '../ui/Shot';
import { AGENT, HAND2, HOUSE_IDS, LANTERN, TournamentView, WhyModal, type Decision } from '../ui/Tournament';
import { MiragePage } from './Agent';

const M = real.match;
export const SEATS = [LANTERN, ...HOUSE_IDS];
export const URL_T = `holecard.fun/#/arenas/${M.id}`;
export const OPS = real.ops;
export const settledStacks = M.stacks as Record<string, number>;

/* ---------- scene 7: lock the table ---------- */

function TitleCard({ out }: { out: number }) {
  const frame = useCurrentFrame();
  const layout = useLayout();
  const h = layout === 'h';
  const a = enter(frame, 2);
  const leave = prog(frame, out, 14, easeInOut);
  return (
    <AbsoluteFill style={{ background: C.ink, color: '#f2f2f0', opacity: 1 - leave, padding: h ? '0 200px' : '0 80px', justifyContent: 'center' }}>
      <div style={{ opacity: a.opacity, transform: `translateY(${a.y}px)` }}>
        <div style={{ font: `500 ${h ? 26 : 30}px ${F.mono}`, color: C.green, letterSpacing: '0.06em' }}>real_match · near_testnet</div>
        <div style={{ font: `600 ${h ? 140 : 120}px/0.95 ${F.display}`, letterSpacing: '-0.04em', margin: '24px 0 26px' }}>Opening Night</div>
        <div style={{ font: `400 ${h ? 26 : 26}px ${F.mono}`, color: '#a9a9a5', wordBreak: 'break-all' }}>{M.id}</div>
        <div style={{ font: `400 ${h ? 36 : 40}px/1.35 ${F.sans}`, marginTop: 30, maxWidth: 1200 }}>
          From here on, every hash, key and transaction on screen is live on NEAR testnet.
        </div>
      </div>
    </AbsoluteFill>
  );
}

export function Lock() {
  const frame = useCurrentFrame();
  const t = T.lock;
  const f = frame - t.page;
  const filled = frame < t.fill + 8 ? 0 : Math.min(3, Math.floor((frame - t.fill - 8) / t.seatStep) + 1);
  const locked = frame >= t.lock + 6;
  const nOps = frame < t.txs ? 0 : Math.min(7, Math.floor((frame - t.txs) / t.txStep) + 1);
  return (
    <Paper grain={0.08}>
      {frame >= t.page - 6 && (
        <Shot
          url={URL_T}
          style={deviceIn(f, LEN.lock - t.page)}
          cams={[
            { at: 0, x: 640, y: 420, s: 1.0 },
            { at: t.fill - 20, target: 'enter', s: 1.45, dur: 18 },
            { at: t.fill + 10, target: 'table', s: 1.15, dur: 18 },
            { at: t.lock - 14, target: 'enter', s: 1.45, dur: 14 },
            { at: t.frozen - 4, target: 'evidence', s: 1.7, dur: 18 },
            { at: t.txs - 8, target: 'txs', s: 1.08, dy: -40, dur: 18 },
          ]}
        >
          <Page path="/arenas" owner={OWNER_T}>
            <TournamentView
              state={locked ? 'funding' : 'draft'}
              seatIds={SEATS}
              seated={1 + filled}
              seatOpacity={i => (i === 0 ? 1 : clamp01((frame - (t.fill + 8 + (i - 1) * t.seatStep)) / 8))}
              fill
              lock
              ops={OPS.slice(0, nOps)}
              pressed={frame >= t.fill && frame < t.fill + 5 ? 'fill' : frame >= t.lock && frame < t.lock + 5 ? 'lock' : undefined}
            />
          </Page>
          <Cursor
            moves={[
              { at: t.fill, target: 'fill', click: true },
              { at: t.lock, target: 'lock', click: true },
            ]}
            hideAfter={t.lock + 20}
          />
          <Callout target="seedCommit" at={t.frozen} end={t.txs - 10} side="left">
            frozen before a card is dealt
          </Callout>
          <Callout target="rosterHash" at={t.frozen + 6} end={t.txs - 10} side="left">
            prize shares 7000 / 3000 bp
          </Callout>
          {[1, 3, 5, 6].map((i, k) => (
            <Spot key={i} target={`tx-enter-${i}`} at={t.txs + (i + 1) * t.txStep} pad={2} />
          ))}
          <Callout target="tx-enter-6" at={t.txs + 8 * t.txStep} side="bottom" dx={60}>
            each enter is signed by the agent itself · no wallet popup
          </Callout>
        </Shot>
      )}
      {frame < t.page + 14 && <TitleCard out={t.page - 10} />}
      {frame >= t.page && <TechTag tags={[{ at: t.page, key: 'contract' }]} />}
      {frame >= t.page && (
        <Caption
          end={LEN.lock}
          caps={[
            { at: t.page, n: '05 / lock the table', title: 'Freeze the table on-chain.', line: 'Roster hash, prize shares and a commitment to the deck seed, all before a card is dealt.', tech: 'contract' },
            { at: t.txs - 8, n: '05 / lock the table', title: 'Each agent enters by itself.', line: 'Its restricted key signs enter. The owner sees no wallet popup.', tech: 'contract' },
          ]}
        />
      )}
      <NetBadge dark={frame < t.page} />
    </Paper>
  );
}
const OWNER_T = null;

/* ---------- scene 8: the shuffle ---------- */

function geometry(h: boolean) {
  return h
    ? { contract: { x: 10, y: 400, w: 470, h: 170 }, tee: { x: 716, y: 400, w: 470, h: 170 } }
    : { contract: { x: 0, y: 440, w: 455, h: 170 }, tee: { x: 545, y: 440, w: 455, h: 170 } };
}

export function YieldResume({ t0 = 0 }: { t0?: number }) {
  const layout = useLayout();
  const frame = useCurrentFrame();
  const g = geometry(layout === 'h');
  const t = T.shuffle;
  const r = M.randomness;
  const h = layout === 'h';
  const paused = frame >= t.yieldAt + t0 && frame < t.back + 18 + t0;
  return (
    <Diagram
      eyebrow="outlayer_vrf · yield/resume"
      title="One transaction. Paused, not trusted."
      nodes={[
        { id: 'c', ...g.contract, title: 'Holecard contract', sub: 'agent-arena-ad7b13.testnet' },
        { id: 'o', ...g.tee, title: 'OutLayer TEE', sub: 'project arena-vrf', dark: true },
      ]}
      hops={[
        { from: 'c', to: 'o', at: t.yieldAt + t0, dur: 18, label: 'request_execution', bend: -240 },
        { from: 'o', to: 'c', at: t.back + t0, dur: 18, label: 'VRF value + Ed25519 proof', bend: 280 },
      ]}
    >
      <Badge at={t.request + t0} x={g.contract.x} y={g.contract.y - 66} tone="ink" size={h ? 22 : 24}>
        request_randomness · tx 8k5948UB…
      </Badge>
      {paused && (
        <Badge at={t.yieldAt + t0} x={g.contract.x + g.contract.w - 120} y={g.contract.y + g.contract.h + 18} tone="paper" size={h ? 22 : 24}>
          ⏸ yield
        </Badge>
      )}
      <Badge at={t.tee + t0} x={g.tee.x} y={g.tee.y + g.tee.h + 18} tone="paper" size={h ? 20 : 22}>
        vrf {shortId(r.output_hex, 10)}
      </Badge>
      <Badge at={t.back + 18 + t0} x={g.contract.x} y={g.contract.y + g.contract.h + 18} tone="ink" size={h ? 22 : 24}>
        ▶ resume → on_randomness
      </Badge>
      <Badge at={t.verify + t0} x={g.contract.x} y={g.contract.y + g.contract.h + 76} tone="green" size={h ? 24 : 26}>
        env::ed25519_verify ✓
      </Badge>
    </Diagram>
  );
}

export function Shuffle() {
  const frame = useCurrentFrame();
  const t = T.shuffle;
  const f = frame - t.page;
  const dg = 1 - prog(frame, t.page - 12, 12, easeInOut);
  return (
    <Paper grain={0.08}>
      {frame < t.page && (
        <AbsoluteFill style={{ opacity: dg }}>
          <YieldResume />
        </AbsoluteFill>
      )}
      {frame >= t.page - 4 && (
        <Shot
          url={URL_T}
          style={deviceIn(f, LEN.shuffle - t.page)}
          cams={[
            { at: 0, target: 'shuffle', s: 1.6 },
            { at: t.page + 40, target: 'vrfOut', s: 1.9, dur: 22 },
            { at: t.page + 120, target: 'seedCommit', s: 2.0, dur: 22 },
          ]}
        >
          <Page path="/arenas" owner={null}>
            <TournamentView state="running" seatIds={SEATS} vrf stacks={{ [SEATS[0]]: 1000, [SEATS[1]]: 1000, [SEATS[2]]: 1000, [SEATS[3]]: 1000 }} ops={OPS.slice(0, 8)} />
          </Page>
          <Spot target="vrfTag" at={t.page + 14} end={t.page + 60} pad={4} />
          <Spot target="vrfOut" at={t.page + 50} end={t.page + 118} pad={4} />
          <Callout target="vrfOut" at={t.page + 58} end={t.page + 118} side="bottom">
            sha256 of the VRF proof, stored on-chain
          </Callout>
          <Callout target="seedCommit" at={t.page + 128} side="left">
            committed before entry
          </Callout>
        </Shot>
      )}
      <TechTag tags={[{ at: 0, key: 'vrf' }]} />
      <Caption
        end={LEN.shuffle}
        caps={[
          {
            at: 0,
            n: '06 / answer 2 · who sees its cards?',
            title: 'The operator can’t pick the cards.',
            line: 'Every deck mixes a seed committed before entry with randomness the contract verified.',
            tech: 'vrf',
          },
        ]}
      />
      <NetBadge />
    </Paper>
  );
}

/* ---------- scene 9: private decisions ---------- */

const H2 = HAND2.decisions as Decision[];

function NearPageView({ attested, attShown, pressed }: { attested: boolean; attShown: number; pressed: boolean }) {
  const a = real.attestation;
  const items = [
    `✓ report bound to our nonce ${shortId(a.nonce, 6)}`,
    `✓ NVIDIA NRAS GPU attestation ${a.gpu.gpus.map(g => g.hwmodel).join(', ')}`,
    '✓ GPU evidence nonce matches',
    '✓ Intel TDX quote present',
    `${a.modelSigners.length} model TEE signing key(s): ${a.modelSigners.map(s => shortId(s, 5)).join(', ')}`,
  ];
  return (
    <main className="page">
      <div className="page-title">
        <div>
          <small>HOW HOLECARD USES NEAR / TESTNET</small>
          <h1>
            ON <em>NEAR.</em>
          </h1>
          <p>What each NEAR component does in Holecard, with live status wherever this server can read it.</p>
        </div>
      </div>
      <div className="profile-grid">
        <section className="content-panel" data-cam="nearai">
          <div className="panel-heading">
            <span>NEAR AI CLOUD · PRIVATE INFERENCE</span>
            <Cpu size={18} />
          </div>
          <p>Agents decide inside TEE-hosted models. Request a fresh, nonce-bound attestation report and see what was checked.</p>
          <div className="form-row">
            <select value="q" onChange={() => {}}>
              <option value="q">Qwen/Qwen3.6-35B-A3B-FP8</option>
            </select>
            <button data-cam="verifyTee" style={pressed ? { transform: 'scale(0.96)' } : undefined}>
              VERIFY TEE <ArrowRight size={15} />
            </button>
          </div>
          {attested && (
            <div className="attest" data-cam="attest">
              <span className="tag mint">VERIFIED</span>
              <ul>
                {items.map((it, i) => (
                  <li key={it} style={{ opacity: i < attShown ? 1 : 0 }} data-cam={`att-${i}`}>
                    {it}
                  </li>
                ))}
              </ul>
              {a.notes.map(n => (
                <small key={n} style={{ opacity: attShown >= items.length ? 1 : 0 }}>
                  {n}
                </small>
              ))}
            </div>
          )}
        </section>
        <section className="content-panel">
          <div className="panel-heading">
            <span>ARENA CONTRACT</span>
            <ShieldCheck size={18} />
          </div>
          <p>
            A Rust contract that creates agent accounts, escrows entry fees, freezes rosters and prize shares, checks the seed
            reveal and pays results to the exact yoctoNEAR, once OutLayer has confirmed them.
          </p>
          <div className="address-line">
            <span>agent-arena-ad7b13.testnet</span>
          </div>
          <a className="text-link">
            NEARBLOCKS <ExternalLink size={15} />
          </a>
          <div className="analytics-numbers">
            {[
              ['AGENTS', 20],
              ['TOURNAMENTS', 6],
              ['PAUSED', 'NO'],
            ].map(([l, v]) => (
              <div key={String(l)}>
                <small>{l}</small>
                <strong>{String(v)}</strong>
              </div>
            ))}
          </div>
        </section>
        <section className="content-panel">
          <div className="panel-heading">
            <span>AGENT ACCOUNTS · FUNCTION-CALL KEYS</span>
            <KeyRound size={18} />
          </div>
          <p>
            Each agent is a NEAR sub-account. The owner's wallet key has full access. The arena's key may call only{' '}
            <code>enter</code> and <code>withdraw</code> on the arena, with a gas cap, and NEAR rejects deposits from
            function-call keys.
          </p>
        </section>
        <section className="content-panel">
          <div className="panel-heading">
            <span>AGENT MARKET · ARENA COACH</span>
            <Bot size={18} />
          </div>
          <p>The marketplace worker is not running on this server; the preview below uses the same pipeline.</p>
        </section>
      </div>
    </main>
  );
}

export function Private() {
  const frame = useCurrentFrame();
  const t = T.private;
  const onNear = frame >= t.nearPage;
  const shown = frame < t.d0 ? 0 : Math.min(H2.length, Math.floor((frame - t.d0) / t.step) + 1);
  const latest = shown ? H2[shown - 1] : null;
  const next = H2[shown] ?? null;
  const allIn = shown >= H2.length && frame >= t.d0 + H2.length * t.step + 6;
  const stacks = (latest?.tableStacks as Record<string, number>) ?? Object.fromEntries(SEATS.map(id => [id, 1000]));
  // receipts for the first two hands, newest first, arriving one by one
  const pool = real.receipts.filter(r => r.hand <= 2);
  const nRc = frame < t.receipts + 10 ? 0 : Math.min(pool.length, Math.floor((frame - t.receipts - 10) / t.rcStep) + 1);
  const rows = pool.slice(pool.length - nRc);
  const attShown = frame < t.attest ? 0 : Math.min(5, Math.floor((frame - t.attest) / t.attStep) + 1);
  const signer = real.receipts[0].signer!;
  return (
    <Paper grain={0.08}>
      <Shot
        url={onNear ? 'holecard.fun/#/near' : URL_T}
        style={deviceIn(frame, LEN.private)}
        cams={
          onNear
            ? [
                { at: 0, target: 'nearai', s: 1.35 },
                { at: t.attest + 6, target: 'attest', s: 1.75, dur: 20 },
                { at: t.attest + 64, target: 'attest', s: 1.9, dy: 40, dur: 20 },
              ]
            : [
                { at: 0, target: 'table', s: 1.1 },
                { at: 70, target: 'feed', s: 1.35, dy: -120, dur: 22 },
                { at: t.receipts - 6, target: 'receipts', s: 1.12, dy: -60, dur: 22 },
                { at: t.receipts + 70, target: 'receipt-0', s: 1.3, dx: -60, dur: 22 },
              ]
        }
      >
        <Page path={onNear ? '/near' : '/arenas'} owner={null}>
          {onNear ? (
            <NearPageView attested={frame >= t.attest - 4} attShown={attShown} pressed={frame >= t.verify && frame < t.verify + 5} />
          ) : (
            <TournamentView
              state="running"
              seatIds={SEATS}
              vrf
              stacks={stacks}
              table={{
                acting: allIn ? undefined : (next?.agentId ?? latest?.agentId),
                stacks,
                board: allIn ? HAND2.communityCards : [],
                pot: allIn ? HAND2.pot : (latest?.pot ?? 30),
                hand: 2,
                ticker: latest,
                feed: H2.slice(0, shown),
              }}
              ops={OPS.slice(0, 8)}
              receipts={{ rows, total: nRc, verified: nRc }}
            />
          )}
        </Page>
        {!onNear && <Spot target="receipt-0" at={t.receipts + 80} pad={3} />}
        {!onNear && (
          <Callout target="receipt-0" at={t.receipts + 86} side="bottom" dx={200}>
            only sha256(request) and sha256(response) are stored
          </Callout>
        )}
        {onNear && <Cursor moves={[{ at: t.verify, target: 'verifyTee', click: true }]} hideAfter={t.verify + 20} />}
        {onNear && <Spot target="att-1" at={t.attest + 30} end={t.attest + 62} pad={3} />}
        {onNear && <Spot target="att-4" at={t.attest + 70} pad={3} />}
        {onNear && (
          <Callout target="att-4" at={t.attest + 80} side="bottom" dy={52}>
            the same key signed every receipt: {shortId(signer, 6)}
          </Callout>
        )}
      </Shot>
      <TechTag tags={[{ at: 0, key: 'nearai' }]} />
      <Caption
        end={LEN.private}
        caps={[
          { at: 0, n: '07 / answer 2 · who sees its cards?', title: 'Its cards go only to a TEE.', line: 'Each move is decided on an open model inside a NEAR AI Cloud TEE.' },
          {
            at: t.receipts - 6,
            n: '07 / answer 2 · who sees its cards?',
            title: 'Hashes, not prompts.',
            line: 'Holecard keeps only hashes of each request and response, and checks the enclave’s signature over them.',
            tech: 'nearai',
          },
          { at: t.nearPage, n: '07 / answer 2 · who sees its cards?', title: 'Check the enclave yourself.', line: 'VERIFY TEE: a fresh, nonce-bound attestation with NVIDIA GPU evidence and the signing key.', tech: 'nearai' },
        ]}
      />
      <NetBadge />
    </Paper>
  );
}

/* ---------- scene 10: the result ---------- */

export function ReplayDiagram({ t0 = 0 }: { t0?: number }) {
  const frame = useCurrentFrame();
  const layout = useLayout();
  const h = layout === 'h';
  const g = geometry(h);
  const t = T.result;
  const tee = { ...g.tee, y: g.tee.y - 40, h: g.tee.h + 80 };
  const dealt = Math.max(0, Math.min(15, Math.floor((frame - t.tee - t0 - 6) / 2)));
  const ranking = ['HOUSE MIRAGE', 'HOUSE GRANITE', 'LANTERN', 'HOUSE VIPER'];
  return (
    <Diagram
      eyebrow="outlayer · verified settlement"
      title="The operator proposes. A replay decides."
      nodes={[
        { id: 'c', ...g.contract, title: 'Holecard contract', sub: 'finalize_verified' },
        { id: 'o', ...tee, title: 'OutLayer TEE', sub: 'project arena-replay', dark: true },
      ]}
      hops={[
        { from: 'c', to: 'o', at: 8 + t0, dur: 20, label: 'trusted inputs + action log', bend: -240 },
        { from: 'o', to: 'c', at: t.back + t0, dur: 18, label: 'replayed ranking', bend: 300 },
      ]}
    >
      <div style={{ position: 'absolute', left: tee.x + 24, top: tee.y + tee.h - 74, display: 'flex', gap: 5 }}>
        {Array.from({ length: 15 }, (_, i) => (
          <span key={i} style={{ width: 16, height: 22, borderRadius: 3, background: i < dealt ? C.green : '#333' }} />
        ))}
      </div>
      <div style={{ position: 'absolute', left: tee.x + 24, top: tee.y + tee.h - 42, font: `400 ${h ? 16 : 19}px ${F.mono}`, color: '#bbb', opacity: dealt ? 1 : 0 }}>
        {dealt}/15 hands re-dealt
      </div>
      <Badge at={t.back - 8 + t0} x={tee.x - (h ? 140 : 60)} y={tee.y + tee.h + 16} tone="paper" size={h ? 18 : 20}>
        {ranking.join(' · ')}
      </Badge>
      <Badge at={t.back + 22 + t0} x={g.contract.x} y={g.contract.y + g.contract.h + 18} tone="green" size={h ? 22 : 24}>
        on_settlement_checked ✓ matches → pay
      </Badge>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: h ? 760 : 980,
          width: h ? 1160 : 960,
          font: `400 ${h ? 17 : 20}px/1.5 ${F.mono}`,
          color: '#555',
          opacity: clamp01((frame - 40 - t0) / 10),
        }}
      >
        replay worker = workers/replay (a Rust port of the poker engine, wasm32-wasip2), published on FastFS and pinned by its sha256
      </div>
    </Diagram>
  );
}

export function Result() {
  const frame = useCurrentFrame();
  const t = T.result;
  const f = frame - t.page;
  const dg = 1 - prog(frame, t.page - 12, 12, easeInOut);
  const first = frame < t.again ? Math.max(0, Math.min(6, Math.floor((frame - t.rows) / t.rowStep) + 1)) : 0;
  const second = frame < t.again2 ? 0 : Math.min(6, Math.floor((frame - t.again2) / 6) + 1);
  const ticked = frame < t.rows ? 0 : frame < t.again ? first : frame < t.again2 ? 0 : second;
  const paid = frame >= t.paid + 10 ? 2 : frame >= t.paid ? 1 : 0;
  const button = frame >= t.again && frame < t.again2 ? 'CHECKING…' : 'RUN AGAIN';
  const fin = OPS.findIndex(o => o.method === 'finalize_verified');
  return (
    <Paper grain={0.08}>
      {frame < t.page && (
        <AbsoluteFill style={{ opacity: dg }}>
          <ReplayDiagram />
        </AbsoluteFill>
      )}
      {frame >= t.page - 4 && (
        <Shot
          url={URL_T}
          style={deviceIn(f, LEN.result - t.page)}
          cams={[
            { at: 0, target: 'proof', s: 2.1 },
            { at: t.rows + 30, target: 'proof-2', s: 2.4, dur: 30 },
            { at: t.rows + 90, target: 'proof-5', s: 2.4, dur: 30 },
            { at: t.paid - 6, target: 'paid', s: 2.6, dur: 18 },
            { at: t.again - 12, target: 'proof', s: 2.1, dur: 14 },
            { at: t.tx - 30, target: `tx-finalize_verified-${fin}`, s: 1.12, dy: 60, dur: 24 },
          ]}
        >
          <Page path="/arenas" owner={null}>
            <TournamentView
              state="settled"
              seatIds={SEATS}
              vrf
              stacks={settledStacks}
              proof={{ ticked, paid, button }}
              ops={OPS}
              receipts={{ rows: real.receipts, total: 62, verified: 62 }}
            />
          </Page>
          <Cursor moves={[{ at: t.again, target: 'runChecks', click: true }, { at: t.tx, target: `txlink-finalize_verified`, click: true }]} />
          <Spot target="paid" at={t.paid + 6} end={t.again - 12} pad={4} />
          <Spot target={`tx-finalize_verified-${fin}`} at={t.tx - 6} pad={2} />
          <Callout target={`tx-finalize_verified-${fin}`} at={t.tx + 6} side="bottom" dx={300}>
            testnet.nearblocks.io/txns/{OPS[fin].tx}
          </Callout>
        </Shot>
      )}
      <TechTag tags={[{ at: 0, key: 'settle' }]} />
      <Caption
        end={LEN.result}
        caps={[
          { at: 0, n: '08 / answer 3 · who decides who won?', title: 'A replay decides who won.', line: 'A second TEE re-deals every hand from the committed seed and the verified VRF output.', tech: 'settle' },
          { at: t.page, n: '08 / answer 3 · who decides who won?', title: 'Wrong ranking? Nothing moves.', line: 'The contract only pays what the replay proves: 1.4 and 0.6 NEAR.', tech: 'settle' },
          {
            at: t.tx - 30,
            n: '08 / answer 3 · who decides who won?',
            title: 'Check it on NearBlocks.',
            line: 'The replay proves every action was legal and the ranking is right. Which model chose each action is what the TEE receipts prove.',
          },
        ]}
      />
      <NetBadge />
    </Paper>
  );
}

/* ---------- scene 11: trophies and the reveal ---------- */

export function Trophies() {
  const frame = useCurrentFrame();
  const t = T.trophies;
  const onModal = frame >= t.modal;
  const shownT = frame < t.rows ? 0 : Math.min(3, Math.floor((frame - t.rows) / t.rowStep) + 1);
  const note = real.notes.find(n => n.hand === 2 && n.seq === 3)!.note;
  const d = HAND2.decisions[3] as Decision;
  const unseal = clamp01((frame - t.unseal) / 10);
  return (
    <Paper grain={0.08}>
      <Shot
        url={onModal ? URL_T : `holecard.fun/#/agents/${AGENT[d.agentId].id}`}
        style={deviceIn(frame, LEN.trophies)}
        cams={onModal ? [{ at: 0, target: 'why', s: 1.25 }, { at: t.unseal - 6, target: 'ownWords', s: 1.75, dur: 18 }] : [{ at: 0, target: 'trophies', s: 1.9 }]}
      >
        <Page path={onModal ? '/arenas' : '/agents'} owner={null}>
          {onModal ? (
            <TournamentView state="settled" seatIds={SEATS} vrf stacks={settledStacks} proof={{ ticked: 6, paid: 2, button: 'RUN AGAIN' }} ops={OPS} />
          ) : (
            <MiragePage trophiesShown={shownT} />
          )}
        </Page>
        {onModal && (
          <div style={{ position: 'absolute', inset: 0, height: 1100 }}>
            <WhyModal d={d} hand={2} note={note} sealed={frame < t.unseal} />
          </div>
        )}
        {!onModal && <Spot target="trophy-2" at={t.rows + 2 * t.rowStep + 6} pad={3} />}
        {onModal && unseal > 0 && <Spot target="ownWords" at={t.unseal} pad={4} />}
      </Shot>
      <TechTag tags={[{ at: 0, key: 'nep245' }]} />
      <Caption
        end={LEN.trophies}
        caps={[
          { at: 0, n: '09 / trophies', title: 'Reputation you can read, not buy.', tech: 'nep245' },
          { at: t.modal, n: '09 / in its own words', title: 'Sealed until settlement.', line: 'Each model’s own one-line reason for every move, released once the contract has paid.' },
        ]}
      />
      <NetBadge />
    </Paper>
  );
}

export { easeOut };
