import { useCurrentFrame } from 'remotion';
import { C, F } from '../lib/theme';
import { clamp01, easeOut, enter } from '../lib/anim';
import { TECH, type TechKey } from '../lib/tech';
import { STAGE, useLayout } from './Shot';

export type Cap = {
  at: number;
  n: string;
  title: string;
  line?: string;
  tech?: TechKey;
};

/** Caption panel: scene number, tech tag, headline, supporting line, and the three lines for a NEAR technology. */
export function Caption({ caps, end }: { caps: Cap[]; end: number }) {
  const frame = useCurrentFrame();
  const layout = useLayout();
  const box = STAGE[layout].cap;
  const idx = caps.reduce((acc, c, i) => (frame >= c.at ? i : acc), -1);
  if (idx < 0) return null;
  const cap = caps[idx];
  const next = caps[idx + 1]?.at ?? end;
  const e = enter(frame, cap.at, next, 12);
  const tech = cap.tech ? TECH[cap.tech] : null;
  const h = layout === 'h';
  const sz = h
    ? { title: 58, line: 27, label: 16, body: 24, gap: 26 }
    : { title: 60, line: 30, label: 18, body: 26, gap: 18 };
  return (
    <div
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y,
        width: box.w,
        opacity: e.opacity,
        transform: `translateY(${e.y}px)`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
        <span style={{ font: `500 ${sz.label + 2}px ${F.mono}`, color: C.faint, letterSpacing: '0.06em' }}>{cap.n}</span>
        <span style={{ flex: 1, height: 1, background: '#cfcfcf' }} />
      </div>
      <h2
        style={{
          font: `600 ${sz.title}px/1.02 ${F.display}`,
          letterSpacing: '-0.03em',
          color: C.ink,
          margin: 0,
          textWrap: 'balance',
        }}
      >
        {cap.title}
      </h2>
      {cap.line && (
        <p style={{ font: `400 ${sz.line}px/1.4 ${F.sans}`, color: '#3a3a3a', margin: `${sz.gap - 6}px 0 0`, textWrap: 'pretty' }}>
          {cap.line}
        </p>
      )}
      {tech && (
        <div
          style={{
            marginTop: sz.gap + 4,
            background: C.ink,
            color: '#f2f2f0',
            borderRadius: 14,
            padding: h ? '22px 26px 24px' : '26px 30px 28px',
            display: 'grid',
            gap: h ? 14 : 16,
          }}
        >
          {(
            [
              ['what it is', tech.what],
              ['in holecard', tech.does],
              ['proof on screen', tech.proof],
            ] as const
          ).map(([label, text], i) => {
            const a = clamp01((frame - cap.at - 2 - i * 4) / 8);
            return (
              <div key={label} style={{ opacity: a, transform: `translateX(${(1 - easeOut(a)) * 14}px)` }}>
                <div
                  style={{
                    font: `500 ${sz.label}px ${F.mono}`,
                    color: i === 2 ? C.green : '#9a9a96',
                    letterSpacing: '0.04em',
                    marginBottom: 4,
                  }}
                >
                  {label.replace(/ /g, '_')}
                </div>
                <div style={{ font: `${i === 2 ? 500 : 400} ${sz.body}px/1.36 ${F.sans}`, textWrap: 'pretty' }}>{text}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Corner tag for the NEAR technology on screen: Geist Mono, green dot. */
export function TechTag({ tags }: { tags: { at: number; key: TechKey }[]; end?: number }) {
  const frame = useCurrentFrame();
  const layout = useLayout();
  const idx = tags.reduce((acc, t, i) => (frame >= t.at ? i : acc), -1);
  if (idx < 0) return null;
  const t = tags[idx];
  const a = clamp01((frame - t.at) / 8);
  const tech = TECH[t.key];
  const h = layout === 'h';
  return (
    <div
      style={{
        position: 'absolute',
        left: h ? 64 : 40,
        top: h ? 30 : 62,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: h ? '10px 18px 10px 14px' : '14px 22px 14px 18px',
        background: C.ink,
        color: '#f2f2f0',
        borderRadius: 999,
        font: `500 ${h ? 21 : 27}px ${F.mono}`,
        letterSpacing: '0.01em',
        opacity: a,
        transform: `translateY(${(1 - easeOut(a)) * -10}px)`,
      }}
    >
      <span
        style={{
          width: h ? 11 : 14,
          height: h ? 11 : 14,
          borderRadius: '50%',
          background: C.green,
          boxShadow: `0 0 0 ${3 + Math.sin(frame / 5) * 2}px rgba(28,199,68,0.25)`,
        }}
      />
      {tech.tag}
    </div>
  );
}

/** Persistent NEAR testnet badge, top right. */
export function NetBadge({ dark }: { dark?: boolean }) {
  const layout = useLayout();
  const h = layout === 'h';
  return (
    <div
      style={{
        position: 'absolute',
        right: h ? 64 : 40,
        top: h ? 34 : 66,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: h ? '8px 16px' : '11px 20px',
        border: `1.5px solid ${dark ? '#444' : '#bdbdbd'}`,
        borderRadius: 999,
        font: `500 ${h ? 18 : 24}px ${F.mono}`,
        color: dark ? '#cfcfcf' : '#333',
        background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.5)',
        letterSpacing: '0.02em',
        zIndex: 50,
      }}
    >
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: C.green }} />
      near_testnet
    </div>
  );
}
