import { useEffect, useMemo, useRef } from 'react';
import { useCurrentFrame } from 'remotion';
import { NOISE } from '../lib/theme';
import { clamp01, easeInOut, rng } from '../lib/anim';

/**
 * The home hero's living ink (src/ui/components/InkMarks.tsx), ported to be a pure function of the frame:
 * the Holecard mark and the poker chip are sampled into grain that can be scattered, eroded into smoke
 * and pulled back into shape. Same rasters, colours and particle counts as the app.
 */

const INK = '#141414',
  GREEN = '#1cc744',
  LIGHT = '#e6e6e3';
const COLORS = [INK, GREEN, LIGHT];
const TAU = Math.PI * 2,
  DEG = Math.PI / 180,
  RASTER = 200;

function drawMark(c: CanvasRenderingContext2D) {
  c.translate(RASTER / 2, RASTER / 2);
  c.rotate(-6 * DEG);
  c.scale(RASTER / 24, RASTER / 24);
  c.translate(-12, -12);
  const card = (x: number, y: number, angle: number, cx: number, cy: number) => {
    c.translate(cx, cy);
    c.rotate(angle * DEG);
    c.translate(-cx, -cy);
    c.beginPath();
    c.roundRect(x, y, 11.2, 15.6, 2.2);
  };
  c.fillStyle = INK;
  c.save();
  card(2.6, 5.2, -13, 8.2, 13);
  c.fill();
  c.restore();
  c.save();
  card(9.6, 3, 9, 15.2, 10.8);
  c.globalCompositeOperation = 'destination-out';
  c.lineWidth = 1.8;
  c.stroke();
  c.globalCompositeOperation = 'source-over';
  c.fill();
  c.restore();
  c.globalCompositeOperation = 'destination-out';
  c.beginPath();
  c.arc(15.2, 10.8, 2.7, 0, TAU);
  c.fill();
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = GREEN;
  c.beginPath();
  c.arc(15.2, 10.8, 1.5, 0, TAU);
  c.fill();
}

function drawChip(c: CanvasRenderingContext2D) {
  const r = RASTER / 2,
    rim = RASTER * 0.1;
  c.fillStyle = INK;
  c.beginPath();
  c.arc(r, r, r, 0, TAU);
  c.fill();
  const rimR = r - rim / 2 - RASTER * 0.01;
  c.strokeStyle = LIGHT;
  c.lineWidth = rim;
  c.setLineDash([(TAU * rimR) / 16, (TAU * rimR) / 16]);
  c.beginPath();
  c.arc(r, r, rimR, 0, TAU);
  c.stroke();
  c.setLineDash([]);
  c.strokeStyle = GREEN;
  c.lineWidth = RASTER * 0.035;
  c.beginPath();
  c.arc(r, r, RASTER * 0.22, 0, TAU);
  c.stroke();
}

type Particles = {
  nx: Float32Array;
  ny: Float32Array;
  col: Uint8Array;
  sx: Float32Array; // scatter offset (unit)
  sy: Float32Array;
  rel: Float32Array; // erosion threshold
  vx: Float32Array; // smoke drift speeds
  vy: Float32Array;
  ph: Float32Array;
  lag: Float32Array; // formation delay
};

function sample(draw: (c: CanvasRenderingContext2D) => void, count: number, seed: number): Particles {
  const r = rng(seed);
  const gauss = () => (r() + r() + r() - 1.5) / 1.5;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = RASTER;
  const c = canvas.getContext('2d', { willReadFrequently: true })!;
  draw(c);
  const { data } = c.getImageData(0, 0, RASTER, RASTER);
  const filled: number[] = [],
    kind: number[] = [];
  for (let i = 0; i < RASTER * RASTER; i++) {
    const o = i * 4;
    if (data[o + 3] < 140) continue;
    filled.push(i);
    kind.push(data[o + 1] > 150 && data[o] < 120 ? 1 : data[o] > 170 ? 2 : 0);
  }
  const accent = kind.filter(k => k === 1).length;
  const P: Particles = {
    nx: new Float32Array(count),
    ny: new Float32Array(count),
    col: new Uint8Array(count),
    sx: new Float32Array(count),
    sy: new Float32Array(count),
    rel: new Float32Array(count),
    vx: new Float32Array(count),
    vy: new Float32Array(count),
    ph: new Float32Array(count),
    lag: new Float32Array(count),
  };
  for (let n = 0; n < count; n++) {
    const wantAccent = accent > 0 && n < Math.min(count * 0.06, accent * 3);
    let j = 0;
    for (let tries = 0; tries < 12; tries++) {
      j = (r() * filled.length) | 0;
      if (!wantAccent || kind[j] === 1) break;
    }
    const p = filled[j];
    const nx = ((p % RASTER) + r()) / RASTER - 0.5,
      ny = (Math.floor(p / RASTER) + r()) / RASTER - 0.5;
    P.nx[n] = nx;
    P.ny[n] = ny;
    P.col[n] = kind[j];
    P.sx[n] = gauss();
    P.sy[n] = gauss();
    P.rel[n] = clamp01(0.6 * (nx + 0.5) + 0.25 * (0.5 - ny) + 0.3 * r() - 0.1);
    P.vx[n] = 0.05 + r() * 0.12;
    P.vy[n] = 0.08 + r() * 0.14;
    P.ph[n] = r() * TAU;
    P.lag[n] = r() * 0.45;
  }
  return P;
}

export type GlyphState = {
  /** 1 = loose grain cloud, 0 = formed */
  scatter: number;
  /** erosion progress: particles with rel < smoke have been released into smoke */
  smoke: number;
  /** 0..1 pull from smoke back home */
  reform: number;
};

export type Glyph = { cx: number; cy: number; size: number };

export function InkLogos({
  width,
  height,
  glyphs,
  state,
  dot = 2.2,
  counts = [4600, 5800],
}: {
  width: number;
  height: number;
  glyphs: [Glyph, Glyph];
  state: (glyph: number, frame: number) => GlyphState;
  dot?: number;
  counts?: [number, number];
}) {
  const frame = useCurrentFrame();
  const ref = useRef<HTMLCanvasElement>(null);
  const shapes = useMemo(
    () => [sample(drawMark, counts[0], 11), sample(drawChip, counts[1], 29)],
    [counts[0], counts[1]],
  );
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const sizes = [dot * 0.9, dot, dot * 0.85];
    for (let k = 0; k < 3; k++) {
      ctx.fillStyle = COLORS[k];
      const s = sizes[k],
        h = s / 2;
      shapes.forEach((P, gi) => {
        const g = glyphs[gi];
        const st = state(gi, frame);
        const size = g.size;
        for (let i = 0; i < P.nx.length; i++) {
          if (P.col[i] !== k) continue;
          let x = g.cx + P.nx[i] * size,
            y = g.cy + P.ny[i] * size,
            a = 1;
          // shimmer while holding the shape
          x += Math.sin(frame * 0.9 + P.ph[i] * 7) * 0.45;
          y += Math.cos(frame * 0.8 + P.ph[i] * 5) * 0.45;
          // erosion into smoke: released grain rides an updraft that curls to the right
          const tau = Math.max(0, st.smoke - P.rel[i]) * 60;
          if (tau > 0) {
            const k2 = size / 300;
            const dx = (tau * P.vx[i] * 17 + Math.sin(tau * 0.06 + P.ph[i]) * 22 * Math.sqrt(tau) * 0.6) * k2;
            const dy = (-tau * P.vy[i] * 14 + Math.cos(tau * 0.05 + P.ph[i] * 1.7) * 16 * Math.sqrt(tau) * 0.6) * k2;
            const back = easeInOut(clamp01((st.reform - P.lag[i] * 0.5) / 0.75));
            x += dx * (1 - back);
            y += dy * (1 - back);
            a = 1 - (1 - Math.max(0.16, 1 - tau * 0.012)) * (1 - back);
          }
          // scattered grain for intros
          if (st.scatter > 0) {
            const s2 = easeInOut(clamp01((st.scatter - P.lag[i] * (1 - st.scatter)) / (1 - P.lag[i] * 0.5)));
            const spread = size * 1.5;
            x += P.sx[i] * spread * s2 + Math.sin(frame * 0.05 + P.ph[i]) * 14 * s2;
            y += P.sy[i] * spread * s2 + Math.cos(frame * 0.04 + P.ph[i]) * 14 * s2;
            a *= 1 - s2 * 0.75;
          }
          if (x < -4 || y < -4 || x > width + 4 || y > height + 4) continue;
          ctx.globalAlpha = a;
          ctx.fillRect(x - h, y - h, s, s);
        }
      });
    }
    ctx.globalAlpha = 1;
  }, [frame, width, height, shapes, glyphs, state, dot]);
  return <canvas ref={ref} width={width} height={height} style={{ position: 'absolute', inset: 0 }} />;
}

/** The spray-painted ring from the hero (.halo:before), spun by the frame instead of a CSS timer. */
export function Halo({ cx, cy, size, reverse, opacity = 1 }: { cx: number; cy: number; size: number; reverse?: boolean; opacity?: number }) {
  const frame = useCurrentFrame();
  const rot = (frame / (60 * 30)) * 360 * (reverse ? -1 : 1);
  return (
    <div
      style={{
        position: 'absolute',
        left: cx - size / 2,
        top: cy - size / 2,
        width: size,
        height: size,
        borderRadius: '50%',
        opacity,
        background:
          'radial-gradient(closest-side, transparent 58%, rgba(17,17,17,0.9) 72%, rgba(17,17,17,0.55) 82%, transparent 100%)',
        WebkitMaskImage: NOISE,
        maskImage: NOISE,
        WebkitMaskSize: '180px',
        maskSize: '180px',
        filter: 'blur(1.5px)',
        transform: `rotate(${rot}deg)`,
      }}
    />
  );
}
