import React, { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { C, F, NOISE } from '../lib/theme';
import { clamp01, easeInOut, lerp } from '../lib/anim';

/* ---------- layout ---------- */

export type Layout = 'h' | 'v';
export const LayoutCtx = createContext<Layout>('h');
export const useLayout = () => useContext(LayoutCtx);

/** Where the browser frame and the caption column sit in each cut. */
export const STAGE = {
  h: { W: 1920, H: 1080, dev: { x: 64, y: 96, w: 1196, h: 900 }, cap: { x: 1312, y: 150, w: 548 } },
  v: { W: 1080, H: 1920, dev: { x: 40, y: 150, w: 1000, h: 1050 }, cap: { x: 60, y: 1250, w: 960 } },
};

/* ---------- paper and grain ---------- */

export function Paper({ children, grain = 0.16 }: { children?: React.ReactNode; grain?: number }) {
  const frame = useCurrentFrame();
  // The grain shifts every other frame so the paper feels alive, like film.
  const j = Math.floor(frame / 2);
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: 'hidden' }}>
      {children}
      <AbsoluteFill
        style={{
          backgroundImage: NOISE,
          backgroundPosition: `${(j * 37) % 180}px ${(j * 71) % 180}px`,
          opacity: grain,
          pointerEvents: 'none',
          mixBlendMode: 'multiply',
        }}
      />
    </AbsoluteFill>
  );
}

/** Device entrance/exit: rises in over the first frames, eases out over the last ones. */
export function deviceIn(frame: number, len: number, inLen = 14, outLen = 12): React.CSSProperties {
  const a = easeInOut(clamp01(frame / inLen));
  const b = easeInOut(clamp01((frame - (len - outLen)) / outLen));
  return { opacity: a * (1 - b), transform: `translateY(${(1 - a) * 40 - b * 20}px) scale(${0.97 + 0.03 * a - 0.02 * b})` };
}

/* ---------- measurement of [data-cam] targets inside the page ---------- */

type Rect = { x: number; y: number; w: number; h: number };
const TargetsCtx = createContext<Record<string, Rect>>({});
export const useTargets = () => useContext(TargetsCtx);

function offsetIn(el: HTMLElement, root: HTMLElement) {
  let x = 0,
    y = 0,
    node: HTMLElement | null = el;
  while (node && node !== root) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x, y };
}

/* ---------- camera keyframes ---------- */

export type Cam = { at: number; target?: string; x?: number; y?: number; s: number; dur?: number; dx?: number; dy?: number };

function camAt(frame: number, cams: Cam[], targets: Record<string, Rect>, pageW: number) {
  const point = (c: Cam) => {
    const r = c.target ? targets[c.target] : undefined;
    return {
      x: (r ? r.x + r.w / 2 : (c.x ?? pageW / 2)) + (c.dx ?? 0),
      y: (r ? r.y + r.h / 2 : (c.y ?? 0)) + (c.dy ?? 0),
      s: c.s,
    };
  };
  let cur = point(cams[0]);
  for (let i = 1; i < cams.length; i++) {
    const c = cams[i];
    const dur = c.dur ?? 24;
    if (frame < c.at) break;
    const t = easeInOut(clamp01((frame - c.at) / dur));
    const nxt = point(c);
    cur = { x: lerp(cur.x, nxt.x, t), y: lerp(cur.y, nxt.y, t), s: lerp(cur.s, nxt.s, t) };
  }
  return cur;
}

/* ---------- the browser frame ---------- */

export function Shot({
  url,
  cams,
  pageW: pageWProp,
  children,
  overlay,
  tilt = 0,
  style,
  box,
}: {
  url: string;
  cams: Cam[];
  pageW?: number;
  children: React.ReactNode;
  overlay?: React.ReactNode;
  tilt?: number;
  style?: React.CSSProperties;
  box?: { x: number; y: number; w: number; h: number };
}) {
  const layout = useLayout();
  const frame = useCurrentFrame();
  const pageW = pageWProp ?? (layout === 'v' && !box ? 820 : 1280);
  const dev = box ?? STAGE[layout].dev;
  const chrome = layout === 'h' ? 46 : 52;
  const vw = dev.w,
    vh = dev.h - chrome;
  const k = vw / pageW;
  const root = useRef<HTMLDivElement>(null);
  const [targets, setTargets] = useState<Record<string, Rect>>({});
  const [contentH, setContentH] = useState(2000);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const next: Record<string, Rect> = {};
    el.querySelectorAll<HTMLElement>('[data-cam]').forEach(n => {
      const { x, y } = offsetIn(n, el);
      next[n.dataset.cam!] = { x, y, w: n.offsetWidth, h: n.offsetHeight };
    });
    const h = el.scrollHeight;
    if (JSON.stringify(next) !== JSON.stringify(targets)) setTargets(next);
    if (h !== contentH) setContentH(h);
  });
  const cam = camAt(frame, cams, targets, pageW);
  const s = cam.s * k;
  // Keep the page filling the viewport: clamp the pan so no empty edge shows.
  let tx = vw / 2 - cam.x * s,
    ty = vh / 2 - cam.y * s;
  tx = Math.min(0, Math.max(vw - pageW * s, tx));
  ty = Math.min(0, Math.max(vh - contentH * s, ty));
  return (
    <TargetsCtx.Provider value={targets}>
      <div
        style={{
          position: 'absolute',
          left: dev.x,
          top: dev.y,
          width: dev.w,
          height: dev.h,
          borderRadius: 18,
          overflow: 'hidden',
          background: '#fff',
          boxShadow: '0 40px 80px rgba(0,0,0,0.16), 0 0 0 1px rgba(0,0,0,0.08)',
          transform: tilt ? `perspective(2400px) rotateY(${tilt}deg)` : undefined,
          ...style,
        }}
      >
        <div
          style={{
            height: chrome,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '0 18px',
            background: '#f6f6f5',
            borderBottom: '1px solid #dedede',
          }}
        >
          {['#ff5f57', '#febc2e', '#28c840'].map(c => (
            <span key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c, opacity: 0.85 }} />
          ))}
          <div
            style={{
              marginLeft: 18,
              flex: 1,
              height: chrome - 18,
              borderRadius: 9,
              background: '#e9e9e7',
              display: 'flex',
              alignItems: 'center',
              padding: '0 16px',
              font: `400 ${layout === 'h' ? 17 : 20}px ${F.mono}`,
              color: '#444',
              letterSpacing: '0.01em',
            }}
          >
            <span style={{ color: '#999' }}>https://</span>
            {url}
          </div>
        </div>
        <div style={{ position: 'relative', width: vw, height: vh, overflow: 'hidden', background: C.bg }}>
          <div
            ref={root}
            className={`app-shot${pageW < 1000 ? ' narrow' : ''}`}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: pageW,
              transformOrigin: '0 0',
              transform: `translate(${tx}px, ${ty}px) scale(${s})`,
            }}
          >
            {children}
          </div>
          {overlay && (
            <div style={{ position: 'absolute', left: 0, top: 0, width: pageW / 1.6, height: vh / k / 1.6, transformOrigin: '0 0', transform: `scale(${k * 1.6})` }}>
              {overlay}
            </div>
          )}
        </div>
      </div>
    </TargetsCtx.Provider>
  );
}

/* ---------- cursor with a visible touch ---------- */

export type Move = { at: number; target: string; click?: boolean; dx?: number; dy?: number };

/** Lives inside the page (so it zooms with the camera). Moves between targets and shows a ripple on clicks. */
export function Cursor({ moves, from = { x: 1100, y: 700 }, hideAfter }: { moves: Move[]; from?: { x: number; y: number }; hideAfter?: number }) {
  const frame = useCurrentFrame();
  const targets = useTargets();
  if (hideAfter !== undefined && frame > hideAfter) return null;
  if (!moves.length || frame < moves[0].at - 26) return null;
  const appear = clamp01((frame - (moves[0].at - 26)) / 8);
  const pos = (m: Move) => {
    const r = targets[m.target];
    return r ? { x: r.x + r.w / 2 + (m.dx ?? 0), y: r.y + r.h / 2 + (m.dy ?? 0) } : from;
  };
  let p = from;
  let ripple: { x: number; y: number; t: number } | null = null;
  for (const m of moves) {
    const travel = 16;
    if (frame < m.at - travel) break;
    const t = easeInOut(clamp01((frame - (m.at - travel)) / travel));
    const q = pos(m);
    p = { x: lerp(p.x, q.x, t), y: lerp(p.y, q.y, t) };
    if (m.click && frame >= m.at && frame < m.at + 18) ripple = { ...q, t: (frame - m.at) / 18 };
  }
  const press = ripple && ripple.t < 0.3 ? 0.86 : 1;
  return (
    <>
      {ripple && (
        <div
          style={{
            position: 'absolute',
            left: ripple.x - 40,
            top: ripple.y - 40,
            width: 80,
            height: 80,
            borderRadius: '50%',
            border: `3px solid ${C.green}`,
            transform: `scale(${0.3 + ripple.t * 0.9})`,
            opacity: 1 - ripple.t,
            zIndex: 999,
            pointerEvents: 'none',
          }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          left: p.x - 16,
          top: p.y - 16,
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: 'rgba(17,17,17,0.22)',
          border: '2px solid rgba(255,255,255,0.95)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          opacity: appear,
          transform: `scale(${press})`,
          zIndex: 1000,
          pointerEvents: 'none',
        }}
      />
    </>
  );
}

/** A soft green focus ring drawn around a target inside the page. */
export function Spot({ target, at, end, pad = 8 }: { target: string; at: number; end?: number; pad?: number }) {
  const frame = useCurrentFrame();
  const targets = useTargets();
  const r = targets[target];
  if (!r || frame < at || (end !== undefined && frame > end)) return null;
  const a = clamp01((frame - at) / 10) * (end === undefined ? 1 : clamp01((end - frame) / 8));
  return (
    <div
      style={{
        position: 'absolute',
        left: r.x - pad,
        top: r.y - pad,
        width: r.w + pad * 2,
        height: r.h + pad * 2,
        borderRadius: 10,
        border: `3px solid ${C.green}`,
        boxShadow: `0 0 0 6px rgba(28,199,68,0.18)`,
        opacity: a,
        zIndex: 900,
        pointerEvents: 'none',
      }}
    />
  );
}

/** An annotation chip pinned next to a target inside the page (video annotation, not app UI). */
export function Callout({ target, at, end, children, side = 'right', dx = 0, dy = 0 }: { target: string; at: number; end?: number; children: React.ReactNode; side?: 'right' | 'left' | 'top' | 'bottom'; dx?: number; dy?: number }) {
  const frame = useCurrentFrame();
  const targets = useTargets();
  const r = targets[target];
  if (!r || frame < at || (end !== undefined && frame > end)) return null;
  const a = clamp01((frame - at) / 8) * (end === undefined ? 1 : clamp01((end - frame) / 6));
  const pos: React.CSSProperties =
    side === 'right'
      ? { left: r.x + r.w + 14 + dx, top: r.y + r.h / 2 + dy, transform: `translate(${(1 - a) * -10}px, -50%)` }
      : side === 'left'
        ? { left: r.x - 14 + dx, top: r.y + r.h / 2 + dy, transform: `translate(calc(-100% + ${(1 - a) * 10}px), -50%)` }
        : side === 'top'
          ? { left: r.x + dx, top: r.y - 12 + dy, transform: `translate(0, calc(-100% + ${(1 - a) * 8}px))` }
          : { left: r.x + dx, top: r.y + r.h + 12 + dy, transform: `translate(0, ${(1 - a) * -8}px)` };
  return (
    <div
      style={{
        position: 'absolute',
        ...pos,
        opacity: a,
        background: C.green,
        color: C.ink,
        borderRadius: 999,
        padding: '7px 14px',
        font: `500 15px ${F.mono}`,
        whiteSpace: 'nowrap',
        zIndex: 950,
        boxShadow: '0 8px 20px rgba(0,0,0,0.12)',
      }}
    >
      {children}
    </div>
  );
}
