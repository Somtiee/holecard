import { loadFont as loadDisplay } from '@remotion/google-fonts/SpaceGrotesk';
import { loadFont as loadSans } from '@remotion/google-fonts/Inter';
import { loadFont as loadMono } from '@remotion/google-fonts/GeistMono';

loadDisplay('normal', { weights: ['400', '500', '600', '700'], subsets: ['latin'] });
loadSans('normal', { weights: ['400', '500', '600'], subsets: ['latin'] });
loadMono('normal', { weights: ['400', '500'], subsets: ['latin'] });

export const C = {
  bg: '#ebebeb',
  ink: '#111111',
  green: '#1cc744',
  greenText: '#0e7a2c',
  dark: '#0b0b0b',
  muted: '#555555',
  faint: '#666666',
  rule: '#d4d4d4',
  panel: '#ffffff',
};
export const F = {
  display: "'Space Grotesk', 'Inter', sans-serif",
  sans: "'Inter', system-ui, sans-serif",
  mono: "'Geist Mono', ui-monospace, Menlo, monospace",
};
export const FPS = 30;
/** 120 BPM: one beat is half a second, one bar (4 beats) is two seconds. */
export const BEAT = 15;
export const BAR = 60;
export const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 2.2 -.75'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";
