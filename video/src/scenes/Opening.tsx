import { useCallback } from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { C, F } from '../lib/theme';
import { clamp01, easeInOut, easeOut, enter, prog } from '../lib/anim';
import { T } from '../timeline';
import { Halo, InkLogos, type GlyphState } from '../ui/Ink';
import { Mark } from '../ui/App';
import { NetBadge } from '../ui/Caption';
import { Paper, useLayout } from '../ui/Shot';

/** Hero geometry for each cut (mirrors .halo-a / .halo-b and the hero copy). */
const HERO = {
  h: { a: { cx: 640, cy: 330, size: 400 }, b: { cx: 1150, cy: 372, size: 400 }, copy: { x: 236, y: 610 }, h1: 148 },
  v: { a: { cx: 360, cy: 600, size: 420 }, b: { cx: 740, cy: 720, size: 420 }, copy: { x: 80, y: 1080 }, h1: 132 },
};

export function HeroLogos({ state, dim = 1 }: { state: (g: number, f: number) => GlyphState; dim?: number }) {
  const layout = useLayout();
  const g = HERO[layout];
  const W = layout === 'h' ? 1920 : 1080,
    H = layout === 'h' ? 1080 : 1920;
  return (
    <AbsoluteFill style={{ opacity: dim }}>
      <Halo cx={g.a.cx} cy={g.a.cy} size={g.a.size} />
      <Halo cx={g.b.cx} cy={g.b.cy} size={g.b.size} reverse />
      <InkLogos
        width={W}
        height={H}
        dot={2.4}
        glyphs={[
          { cx: g.a.cx, cy: g.a.cy, size: g.a.size * 0.56 },
          { cx: g.b.cx, cy: g.b.cy, size: g.b.size * 0.46 },
        ]}
        state={state}
      />
    </AbsoluteFill>
  );
}

function HeroCopy({ lines, eyebrow, out = 1e9, lockup = true, size }: { lines: string[]; eyebrow: string; out?: number; lockup?: boolean; size?: number }) {
  const frame = useCurrentFrame();
  const layout = useLayout();
  const g = HERO[layout];
  const fs = size ?? g.h1;
  const leave = prog(frame, out, 18, easeInOut);
  return (
    <div style={{ position: 'absolute', left: g.copy.x, top: g.copy.y, opacity: 1 - leave, transform: `translateY(${-leave * 30}px)` }}>
      <div
        style={{
          position: 'absolute',
          inset: '-26% -12%',
          background: 'radial-gradient(closest-side, rgba(235,235,235,0.92), rgba(235,235,235,0.75) 55%, rgba(235,235,235,0))',
          zIndex: -1,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, font: `500 ${layout === 'h' ? 24 : 30}px ${F.mono}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.faint }}>
        <span style={{ width: 14, height: 14, background: C.green }} />
        {eyebrow}
      </div>
      <h1
        style={{
          font: `600 ${fs}px/0.96 ${F.display}`,
          letterSpacing: '-0.025em',
          textTransform: 'uppercase',
          margin: '26px 0 0',
          color: C.ink,
        }}
      >
        {lines.map(l => (
          <span key={l} style={{ display: 'block', paddingBottom: '0.05em' }}>
            {l}
          </span>
        ))}
      </h1>
      {lockup && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 30, font: `600 ${layout === 'h' ? 32 : 38}px ${F.display}`, letterSpacing: '-0.02em' }}>
          <Mark size={layout === 'h' ? 38 : 46} />
          <span>Holecard</span>
          <span style={{ color: C.green, fontWeight: 500 }}>×</span>
          <span>NEAR AI · OutLayer</span>
        </div>
      )}
    </div>
  );
}

/** Scene 1: the cover. Frame 0 is a finished thumbnail; then the ink breathes out into smoke and back. */
export function Cover({ t = T.cover }: { t?: { erode: number; reform: number; out: number } }) {
  const state = useCallback(
    (g: number, f: number): GlyphState => {
      const d = g === 1 ? 8 : 0;
      return {
        scatter: 0,
        smoke: clamp01((f - t.erode - d) / 60) * 1.15,
        reform: clamp01((f - t.reform - d) / 50),
      };
    },
    [t.erode, t.reform],
  );
  return (
    <Paper>
      <HeroLogos state={state} />
      <HeroCopy lines={['Nobody sees', 'their cards.']} eyebrow="AI agent poker · NEAR testnet" out={t.out} />
      <NetBadge />
    </Paper>
  );
}

/** Scene 14: the close. Grain gathers back into the logos, then the line and the call to action. */
export function Close({ k = 1 }: { k?: number }) {
  const frame = useCurrentFrame() / k;
  const layout = useLayout();
  const h = layout === 'h';
  const state = useCallback((g: number, f: number): GlyphState => ({ scatter: 1 - clamp01((f - 4 - g * 6) / 50), smoke: 0, reform: 0 }), []);
  const a = enter(frame, 40);
  const b = enter(frame, 70);
  const c = enter(frame, 96);
  return (
    <Paper>
      <HeroLogos state={state} />
      <div style={{ position: 'absolute', left: h ? 236 : 80, top: h ? 620 : 1090 }}>
        <div style={{ opacity: a.opacity, transform: `translateY(${a.y}px)`, font: `600 ${h ? 132 : 112}px/0.96 ${F.display}`, letterSpacing: '-0.03em', textTransform: 'uppercase' }}>
          Verifiable
          <br />
          AI poker.
        </div>
        <div
          style={{
            opacity: b.opacity,
            transform: `translateY(${b.y}px)`,
            marginTop: 36,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 18,
            background: C.ink,
            color: '#fff',
            padding: h ? '20px 30px' : '24px 34px',
            borderRadius: 999,
            font: `500 ${h ? 34 : 40}px ${F.sans}`,
          }}
        >
          <span style={{ width: 14, height: 14, borderRadius: 7, background: C.green }} />
          Play free at holecard.fun
        </div>
        <div style={{ opacity: c.opacity, marginTop: 30, font: `400 ${h ? 22 : 26}px/1.5 ${F.mono}`, color: '#444' }}>
          Every claim checkable on NEAR testnet · agent-arena-ad7b13.testnet
        </div>
      </div>
      <NetBadge />
    </Paper>
  );
}

/** Scene 2: the hook, then the three questions. */
export function Hook({ t = T.hook }: { t?: { q: readonly number[]; out: number } }) {
  const frame = useCurrentFrame();
  const layout = useLayout();
  const h = layout === 'h';
  const words = 'Would you let an AI play poker with your money?'.split(' ');
  const shrink = prog(frame, t.q[0] - 10, 20, easeInOut);
  const leave = prog(frame, t.out, 15, easeInOut);
  const qs = ['Who holds its keys?', 'Who sees its cards?', 'Who decides who won?'];
  return (
    <Paper>
      <AbsoluteFill style={{ opacity: 1 - leave, transform: `scale(${1 + leave * 0.04})` }}>
        <div
          style={{
            position: 'absolute',
            left: h ? 150 : 70,
            right: h ? 150 : 70,
            top: h ? 380 - shrink * 220 : 700 - shrink * 420,
            font: `600 ${(h ? 112 : 104) - shrink * (h ? 44 : 36)}px/1.0 ${F.display}`,
            letterSpacing: '-0.035em',
            textWrap: 'balance',
          }}
        >
          {words.map((w, i) => {
            const a = clamp01((frame - 4 - i * 4) / 8);
            return (
              <span key={i} style={{ display: 'inline-block', marginRight: '0.24em', opacity: a, transform: `translateY(${(1 - easeOut(a)) * 26}px)` }}>
                {w === 'money?' ? <span style={{ boxShadow: `inset 0 -0.16em 0 ${C.green}` }}>{w}</span> : w}
              </span>
            );
          })}
        </div>
        <div
          style={{
            position: 'absolute',
            left: h ? 150 : 70,
            right: h ? 150 : 70,
            top: h ? 400 : 700,
            display: 'grid',
            gridTemplateColumns: h ? 'repeat(3, 1fr)' : '1fr',
            gap: h ? 28 : 30,
          }}
        >
          {qs.map((q, i) => {
            const a = clamp01((frame - t.q[i]) / 10);
            return (
              <div
                key={q}
                style={{
                  opacity: a,
                  transform: `translateY(${(1 - easeOut(a)) * 40}px) scale(${0.96 + 0.04 * easeOut(a)})`,
                  background: '#fff',
                  borderRadius: 16,
                  padding: h ? '34px 34px 40px' : '36px 40px 42px',
                  boxShadow: '0 20px 40px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.06)',
                  minHeight: h ? 380 : 0,
                }}
              >
                <div style={{ font: `500 ${h ? 22 : 26}px ${F.mono}`, color: C.greenText, letterSpacing: '0.06em' }}>question_0{i + 1}</div>
                <div style={{ font: `600 ${h ? 76 : 76}px/1.02 ${F.display}`, letterSpacing: '-0.03em', marginTop: 22 }}>{q}</div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
      <NetBadge />
    </Paper>
  );
}
