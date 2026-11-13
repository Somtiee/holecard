import { Easing, interpolate } from 'remotion';

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);
export const easeOut = Easing.bezier(0.2, 0.7, 0.2, 1);
export const spring = Easing.bezier(0.34, 1.56, 0.64, 1);

/** 0..1 progress of a window that opens at `start` and lasts `dur` frames. */
export const prog = (frame: number, start: number, dur: number, ease: (t: number) => number = easeOut) =>
  ease(clamp01((frame - start) / Math.max(1, dur)));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Fade/slide in at `start`, optionally out at `end`. */
export function enter(frame: number, start: number, end?: number, len = 12) {
  const a = prog(frame, start, len);
  const b = end === undefined ? 0 : prog(frame, end - len, len, easeInOut);
  return { opacity: a * (1 - b), y: (1 - a) * 18 - b * 10 };
}

/** Characters of `text` typed so far, starting at `start`, `perChar` frames per character. */
export const typed = (text: string, frame: number, start: number, perChar = 2) =>
  text.slice(0, Math.max(0, Math.floor((frame - start) / perChar)));

/** A counter that rolls from a to b. */
export const count = (frame: number, start: number, dur: number, a: number, b: number) =>
  interpolate(frame, [start, start + dur], [a, b], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: easeOut,
  });

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const short = (v: string, n = 8) => (v.length > 2 * n + 1 ? `${v.slice(0, n)}…${v.slice(-n + 2)}` : v);
