import type React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import real from '../data/real.json';
import { easeInOut, prog } from '../lib/anim';
import { T } from '../timeline';
import { Page } from '../ui/App';
import { Caption, NetBadge, TechTag } from '../ui/Caption';
import { Callout, deviceIn, Paper, Shot, Spot } from '../ui/Shot';
import { TournamentView } from '../ui/Tournament';
import { NightowlPage, OWNER } from './Agent';
import { OPS, ReplayDiagram, SEATS, settledStacks, URL_T, YieldResume } from './Match';
import { Close, Cover, Hook } from './Opening';
import { Stack } from './Stack';

/* The 45 s vertical cut (1080×1920). Same components as the main cut, laid out for portrait. */

const NIGHTOWL = real.wallets.nightowl;

function VKeys() {
  const frame = useCurrentFrame();
  return (
    <Paper grain={0.08}>
      <Shot
        url="holecard.fun/#/agents/nightowl"
        style={deviceIn(frame, 180)}
        cams={[
          { at: 0, target: 'keys', s: 1.1 },
          { at: 40, target: 'serverKey', s: 1.4, dur: 26 },
        ]}
      >
        <Page path="/agents" owner={OWNER}>
          <NightowlPage balance="0" keysShown={2} />
        </Page>
        <Spot target="serverKey" at={64} pad={6} />
      </Shot>
      <TechTag tags={[{ at: 0, key: 'fckeys' }]} />
      <Caption end={180} caps={[{ at: 0, n: 'who holds its keys?', title: 'The server can play for your agent. It can never take its money.', tech: 'fckeys' }]} />
      <NetBadge />
    </Paper>
  );
}

function VShuffle() {
  const frame = useCurrentFrame();
  const page = 104;
  return (
    <Paper grain={0.08}>
      {frame < page && (
        <AbsoluteFill style={{ opacity: 1 - prog(frame, page - 10, 10, easeInOut) }}>
          <YieldResume />
        </AbsoluteFill>
      )}
      {frame >= page - 4 && (
        <Shot url={URL_T} style={deviceIn(frame - page, 180 - page)} cams={[{ at: 0, target: 'shuffle', s: 0.98 }, { at: page + 20, target: 'vrfOut', s: 1.05, dur: 20 }]}>
          <Page path="/arenas" owner={null}>
            <TournamentView state="running" seatIds={SEATS} vrf stacks={Object.fromEntries(SEATS.map(id => [id, 1000]))} ops={OPS.slice(0, 8)} />
          </Page>
          <Spot target="vrfOut" at={page + 30} pad={4} />
        </Shot>
      )}
      <TechTag tags={[{ at: 0, key: 'vrf' }]} />
      <Caption end={180} caps={[{ at: 0, n: 'who sees its cards?', title: 'The operator can’t pick the cards.', tech: 'vrf' }]} />
      <NetBadge />
    </Paper>
  );
}

function VReceipts() {
  const frame = useCurrentFrame();
  const pool = real.receipts.filter(r => r.hand <= 2);
  const n = frame < 20 ? 0 : Math.min(pool.length, Math.floor((frame - 20) / 6) + 1);
  return (
    <Paper grain={0.08}>
      <Shot
        url={URL_T}
        style={deviceIn(frame, 210)}
        cams={[
          { at: 0, target: 'receipts', s: 1.0, dy: -80 },
          { at: 110, target: 'receipt-0', s: 1.2, dur: 24 },
        ]}
      >
        <Page path="/arenas" owner={null}>
          <TournamentView state="running" seatIds={SEATS} vrf stacks={Object.fromEntries(SEATS.map(id => [id, 1000]))} ops={OPS.slice(0, 8)} receipts={{ rows: pool.slice(pool.length - n), total: n, verified: n }} />
        </Page>
        <Spot target="receipt-0" at={124} pad={3} />
      </Shot>
      <TechTag tags={[{ at: 0, key: 'nearai' }]} />
      <Caption end={210} caps={[{ at: 0, n: 'who sees its cards?', title: 'Every move decided inside a TEE.', tech: 'nearai' }]} />
      <NetBadge />
    </Paper>
  );
}

function VProof() {
  const frame = useCurrentFrame();
  const diagram = 100;
  const ticked = frame < diagram + 16 ? 0 : Math.min(6, Math.floor((frame - diagram - 16) / 16) + 1);
  const paid = frame >= 230 ? 2 : frame >= 220 ? 1 : 0;
  return (
    <Paper grain={0.08}>
      {frame < diagram && (
        <AbsoluteFill style={{ opacity: 1 - prog(frame, diagram - 10, 10, easeInOut) }}>
          <ReplayDiagram />
        </AbsoluteFill>
      )}
      {frame >= diagram - 4 && (
        <Shot
          url={URL_T}
          style={deviceIn(frame - diagram, 300 - diagram)}
          cams={[
            { at: 0, target: 'proof', s: 0.98 },
            { at: 214, target: 'paid', s: 1.05, dur: 18 },
          ]}
        >
          <Page path="/arenas" owner={null}>
            <TournamentView state="settled" seatIds={SEATS} vrf stacks={settledStacks} proof={{ ticked, paid, button: 'RUN AGAIN' }} ops={OPS} />
          </Page>
          <Spot target="paid" at={230} pad={4} />
        </Shot>
      )}
      <TechTag tags={[{ at: 0, key: 'settle' }]} />
      <Caption
        end={300}
        caps={[
          { at: 0, n: 'who decides who won?', title: 'A replay decides who won.', tech: 'settle' },
          { at: diagram, n: 'who decides who won?', title: 'Wrong ranking? Nothing moves.', line: 'The contract only pays what the replay proves: 1.4 and 0.6 NEAR, in finalize_verified BaJXtpRq…' },
        ]}
      />
      <NetBadge />
    </Paper>
  );
}

const SEQ: { id: string; len: number; C: React.FC }[] = [
  { id: 'cover', len: 120, C: () => <Cover t={{ erode: 24, reform: 70, out: 1e9 }} /> },
  { id: 'hook', len: 180, C: () => <Hook t={{ q: [42, 82, 122], out: 168 }} /> },
  { id: 'keys', len: 180, C: VKeys },
  { id: 'shuffle', len: 180, C: VShuffle },
  { id: 'receipts', len: 210, C: VReceipts },
  { id: 'proof', len: 300, C: VProof },
  { id: 'stack', len: 90, C: () => <Stack first={4} step={6} out={80} /> },
  { id: 'close', len: 90, C: () => <Close k={0.55} /> },
];

export const VERTICAL: { id: string; from: number; len: number; C: React.FC }[] = [];
{
  let f = 0;
  for (const s of SEQ) {
    VERTICAL.push({ ...s, from: f });
    f += s.len;
  }
}
export const VERTICAL_FRAMES = VERTICAL.reduce((n, s) => n + s.len, 0);
/** Sound cues for the vertical cut, in global frames. */
export const VERTICAL_CUES = () => {
  const at = (id: string) => VERTICAL.find(s => s.id === id)!.from;
  const c: { f: number; kind: string }[] = [];
  [42, 82, 122].forEach(f => c.push({ f: at('hook') + f, kind: 'stamp' }));
  c.push({ f: at('keys') + 64, kind: 'key' });
  [T.shuffle.request, T.shuffle.yieldAt, T.shuffle.back].forEach(f => c.push({ f: at('shuffle') + f, kind: 'pulse' }));
  c.push({ f: at('shuffle') + T.shuffle.verify, kind: 'stamp' });
  for (let i = 0; i < 11; i++) c.push({ f: at('receipts') + 20 + i * 6, kind: 'seal' });
  c.push({ f: at('proof') + 4, kind: 'pulse' }, { f: at('proof') + T.result.back, kind: 'pulse' });
  for (let i = 0; i < 6; i++) c.push({ f: at('proof') + 116 + i * 16, kind: 'stamp' });
  c.push({ f: at('proof') + 220, kind: 'coin' }, { f: at('proof') + 230, kind: 'coin' });
  for (let i = 0; i < 12; i++) c.push({ f: at('stack') + 4 + i * 6, kind: 'key' });
  return c;
};
