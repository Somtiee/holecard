import { useEffect, useRef } from 'react';

/**
 * The hero logos as living grain. Each mark is sampled into a few thousand particles that hold its
 * shape with a faint shimmer, erode into drifting smoke along a flow field, then pull back together.
 * A pointer moving through the ink pushes the grain aside and stirs the smoke. The halos stay as the
 * layout anchors: particles follow their position, drift and parallax every frame.
 */

const INK = '#141414',
  GREEN = '#1cc744',
  LIGHT = '#e6e6e3';
const COLORS = [INK, GREEN, LIGHT];
const TAU = Math.PI * 2,
  DEG = Math.PI / 180,
  RASTER = 200;
// Cycle (fraction of the period): hold the shape, erode into smoke, then reform.
const HOLD_END = 0.52,
  SMOKE_END = 0.8;

type Shape = { nx: Float32Array; ny: Float32Array; col: Uint8Array };
type Glyph = {
  el: HTMLElement;
  scale: number; // glyph box as a fraction of the halo width
  period: number;
  t0: number;
  from: number; // first particle index
  to: number;
};

function drawMark(c: CanvasRenderingContext2D) {
  // The Holecard mark (components/Brand.tsx), in its 24-unit viewBox, tilted like .halo-mark.
  c.translate(RASTER / 2, RASTER / 2);
  c.rotate(-6 * DEG);
  c.scale(RASTER / 24, RASTER / 24);
  c.translate(-12, -12);
  const card = (x: number, y: number, angle: number, cx: number, cy: number) => {
    c.translate(cx, cy);
    c.rotate(angle * DEG);
    c.translate(-cx, -cy);
    c.beginPath();
    if (c.roundRect) c.roundRect(x, y, 11.2, 15.6, 2.2);
    else c.rect(x, y, 11.2, 15.6);
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
  // The poker chip in the second halo (.halo-chip): dark disc, dashed rim, green inlay ring.
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

/** Rasterize a shape and pick `count` particles from its filled pixels, keeping small accents dense. */
function sample(draw: (c: CanvasRenderingContext2D) => void, count: number): Shape {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = RASTER;
  const c = canvas.getContext('2d', { willReadFrequently: true })!;
  draw(c);
  const { data } = c.getImageData(0, 0, RASTER, RASTER);
  const filled: number[] = [];
  const kind: number[] = [];
  for (let i = 0; i < RASTER * RASTER; i++) {
    const o = i * 4;
    if (data[o + 3] < 140) continue;
    const [r, g] = [data[o], data[o + 1]];
    filled.push(i);
    kind.push(g > 150 && r < 120 ? 1 : r > 170 ? 2 : 0);
  }
  const accent = kind.filter(k => k === 1).length;
  const nx = new Float32Array(count),
    ny = new Float32Array(count),
    col = new Uint8Array(count);
  for (let n = 0; n < count; n++) {
    // The first few percent of particles prefer the green accent, so the small core stays readable.
    const wantAccent = accent > 0 && n < Math.min(count * 0.06, accent * 3);
    let j = 0;
    for (let tries = 0; tries < 12; tries++) {
      j = (Math.random() * filled.length) | 0;
      if (!wantAccent || kind[j] === 1) break;
    }
    const p = filled[j];
    nx[n] = ((p % RASTER) + Math.random()) / RASTER - 0.5;
    ny[n] = (Math.floor(p / RASTER) + Math.random()) / RASTER - 0.5;
    col[n] = kind[j];
  }
  return { nx, ny, col };
}

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

export function InkMarks({ intro, onReady }: { intro: boolean; onReady: (on: boolean) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const introRef = useRef(intro);

  useEffect(() => {
    const canvas = ref.current;
    const art = canvas?.parentElement;
    const ctx = canvas?.getContext('2d');
    const halos = [art?.querySelector<HTMLElement>('.halo-a'), art?.querySelector<HTMLElement>('.halo-b')];
    if (!canvas || !ctx || reduced() || !halos[0] || !halos[1]) return;

    const small = innerWidth < 700;
    const markShape = sample(drawMark, small ? 1500 : 2700);
    const chipShape = sample(drawChip, small ? 1800 : 3400);
    const shapes = [markShape, chipShape];
    const total = markShape.nx.length + chipShape.nx.length;
    const P = {
      nx: new Float32Array(total),
      ny: new Float32Array(total),
      col: new Uint8Array(total),
      x: new Float32Array(total),
      y: new Float32Array(total),
      vx: new Float32Array(total),
      vy: new Float32Array(total),
      a: new Float32Array(total),
      rel: new Float32Array(total),
      spd: new Float32Array(total),
    };
    const glyphs: Glyph[] = [];
    let at = 0;
    shapes.forEach((s, gi) => {
      const n = s.nx.length;
      P.nx.set(s.nx, at);
      P.ny.set(s.ny, at);
      P.col.set(s.col, at);
      for (let i = 0; i < n; i++) {
        // Erosion sweeps across the mark from one edge, with noise, so the smoke peels off in wisps.
        P.spd[at + i] = 0.6 + Math.random() * 0.8;
        P.rel[at + i] = Math.min(
          1,
          Math.max(0, 0.6 * (s.nx[i] + 0.5) + 0.25 * (0.5 - s.ny[i]) + 0.3 * Math.random() - 0.1),
        );
      }
      const period = gi === 0 ? 12.5 : 14.2;
      const start = introRef.current ? SMOKE_END + (gi === 0 ? 0.02 : 0) : gi === 0 ? 0.08 : 0.3;
      glyphs.push({ el: halos[gi]!, scale: gi === 0 ? 0.56 : 0.46, period, t0: start * period, from: at, to: at + n });
      at += n;
    });

    let W = 0,
      H = 0,
      dpr = 1;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(2, devicePixelRatio || 1);
      W = r.width;
      H = r.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // Where each halo is now, in canvas coordinates (follows the CSS drift and pointer parallax).
    const anchor = (g: Glyph) => {
      const c = canvas.getBoundingClientRect(),
        r = g.el.getBoundingClientRect();
      return { cx: r.left + r.width / 2 - c.left, cy: r.top + r.height / 2 - c.top, size: g.el.offsetWidth * g.scale };
    };

    // Place every particle: on its home when the page opens normally, scattered as grain for the intro.
    glyphs.forEach(g => {
      const { cx, cy, size } = anchor(g);
      for (let i = g.from; i < g.to; i++) {
        const spread = introRef.current ? size * 1.5 : 0;
        P.x[i] = cx + P.nx[i] * size + gauss() * spread;
        P.y[i] = cy + P.ny[i] * size + gauss() * spread;
        P.a[i] = introRef.current ? 0 : 1;
      }
    });

    const pointer = { x: -1e4, y: -1e4, vx: 0, vy: 0, lx: 0, ly: 0, on: false };
    const onMove = (e: PointerEvent) => {
      const c = canvas.getBoundingClientRect();
      const x = e.clientX - c.left,
        y = e.clientY - c.top;
      if (pointer.on) {
        pointer.vx = Math.max(-40, Math.min(40, x - pointer.lx));
        pointer.vy = Math.max(-40, Math.min(40, y - pointer.ly));
      }
      pointer.x = pointer.lx = x;
      pointer.y = pointer.ly = y;
      pointer.on = y > -40 && y < H + 40;
      if (!pointer.on) pointer.x = pointer.y = -1e4;
    };
    const onLeave = () => {
      pointer.on = false;
      pointer.x = pointer.y = -1e4;
    };
    addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);

    const flow = (x: number, y: number, t: number) =>
      Math.sin(x * 0.009 + t * 0.35) * 1.6 +
      Math.cos(y * 0.012 - t * 0.27) * 1.4 +
      Math.sin((x - y) * 0.004 + t * 0.2) * 1.2 -
      0.7;

    const R = small ? 60 : 85,
      R2 = R * R;
    const simulate = (t: number) => {
      for (const g of glyphs) {
        const { cx, cy, size } = anchor(g);
        const u = ((((t + g.t0) / g.period) % 1) + 1) % 1;
        const smoke = u >= HOLD_END && u < SMOKE_END ? ((u - HOLD_END) / (SMOKE_END - HOLD_END)) * 1.15 : -1;
        const reform = u >= SMOKE_END ? (u - SMOKE_END) / (1 - SMOKE_END) : -1;
        const pull = reform >= 0 ? 0.012 + 0.05 * reform * reform * (3 - 2 * reform) : 0;
        for (let i = g.from; i < g.to; i++) {
          const x = P.x[i],
            y = P.y[i];
          let vx = P.vx[i],
            vy = P.vy[i];
          const hx = cx + P.nx[i] * size,
            hy = cy + P.ny[i] * size;
          if (smoke > P.rel[i]) {
            // Released: ride the flow field and an updraft, each grain at its own pace with a little
            // diffusion, so a stream spreads into a soft cloud instead of a thin line.
            const ang = flow(x, y, t),
              k = P.spd[i];
            vx = vx * 0.965 + Math.cos(ang) * 0.05 * k + 0.022 + (Math.random() - 0.5) * 0.14;
            vy = vy * 0.965 + Math.sin(ang) * 0.05 * k - 0.024 + (Math.random() - 0.5) * 0.14;
            P.a[i] = Math.max(0.16, P.a[i] - 0.0035);
          } else if (reform >= 0) {
            vx = vx * 0.88 + (hx - x) * pull;
            vy = vy * 0.88 + (hy - y) * pull;
            P.a[i] += (1 - P.a[i]) * 0.05;
          } else {
            // Holding the shape: a stiff spring plus a little jitter, so the grain shimmers.
            vx = vx * 0.8 + (hx - x) * 0.09 + (Math.random() - 0.5) * 0.16;
            vy = vy * 0.8 + (hy - y) * 0.09 + (Math.random() - 0.5) * 0.16;
            P.a[i] += (1 - P.a[i]) * 0.08;
          }
          const dx = x - pointer.x,
            dy = y - pointer.y,
            d2 = dx * dx + dy * dy;
          if (d2 < R2 && d2 > 0.01) {
            const d = Math.sqrt(d2),
              f = (1 - d / R) ** 2;
            vx += (dx / d) * f * 2.4 + pointer.vx * f * 0.3;
            vy += (dy / d) * f * 2.4 + pointer.vy * f * 0.3;
          }
          P.x[i] = x + vx;
          P.y[i] = y + vy;
          P.vx[i] = vx;
          P.vy[i] = vy;
        }
      }
      pointer.vx *= 0.85;
      pointer.vy *= 0.85;
    };

    const SIZES = [1.6, 1.8, 1.5];
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = COLORS[k];
        const s = SIZES[k],
          h = s / 2;
        for (let i = 0; i < total; i++) {
          if (P.col[i] !== k) continue;
          const x = P.x[i],
            y = P.y[i];
          if (x < -2 || y < -2 || x > W + 2 || y > H + 2) continue;
          ctx.globalAlpha = P.a[i];
          ctx.fillRect(x - h, y - h, s, s);
        }
      }
      ctx.globalAlpha = 1;
    };

    let raf = 0,
      visible = true,
      clock = 0,
      last = 0,
      acc = 0,
      ready = false;
    const STEP = 1 / 60;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) {
        last = 0;
        return;
      }
      const dt = last ? Math.min(0.05, (now - last) / 1000) : STEP;
      last = now;
      // Fixed 60 Hz steps so the motion looks the same on 60 and 120 Hz displays.
      acc += dt;
      while (acc >= STEP) {
        clock += STEP;
        simulate(clock);
        acc -= STEP;
      }
      draw();
      if (!ready) {
        ready = true;
        onReady(true);
      }
    };
    raf = requestAnimationFrame(frame);
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      onReady(false);
    };
  }, [onReady]);

  return <canvas ref={ref} className="ink-canvas" />;
}
