import React from 'react';
import { useCurrentFrame } from 'remotion';
import { C, F } from '../lib/theme';
import { clamp01, easeInOut, easeOut, lerp } from '../lib/anim';
import { STAGE, useLayout } from './Shot';

/** Brand-style flow diagram: rounded boxes, mono labels, a green pulse travelling between them. */

export type Node = { id: string; x: number; y: number; w: number; h: number; title: string; sub: string; dark?: boolean };
export type Hop = { from: string; to: string; at: number; dur: number; label: string; bend?: number };

function center(n: Node) {
  return { x: n.x + n.w / 2, y: n.y + n.h / 2 };
}

export function Diagram({ nodes, hops, children, eyebrow, title }: { nodes: Node[]; hops: Hop[]; children?: React.ReactNode; eyebrow: string; title: string }) {
  const frame = useCurrentFrame();
  const layout = useLayout();
  const box = STAGE[layout].dev;
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  const h = layout === 'h';
  return (
    <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h }}>
      <div style={{ font: `500 ${h ? 20 : 24}px ${F.mono}`, color: C.greenText, letterSpacing: '0.06em' }}>{eyebrow}</div>
      <div style={{ font: `600 ${h ? 56 : 58}px/1.05 ${F.display}`, letterSpacing: '-0.03em', marginTop: 12, maxWidth: 1100 }}>{title}</div>
      <svg width={box.w} height={box.h} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
        {hops.map((hp, i) => {
          const a = center(byId[hp.from]),
            b = center(byId[hp.to]);
          const bend = hp.bend ?? 0;
          const mx = (a.x + b.x) / 2 + bend * (b.y - a.y) * 0.0,
            my = (a.y + b.y) / 2 + bend;
          const d = `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
          const shown = clamp01((frame - hp.at + 6) / 6);
          const t = easeInOut(clamp01((frame - hp.at) / hp.dur));
          const px = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x;
          const py = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * my + t * t * b.y;
          const live = frame >= hp.at && frame <= hp.at + hp.dur + 4;
          return (
            <g key={i} opacity={shown}>
              <path d={d} fill="none" stroke={frame > hp.at + hp.dur ? C.green : '#b9b9b9'} strokeWidth={3} strokeDasharray="2 10" strokeLinecap="round" />
              {live && (
                <>
                  <circle cx={px} cy={py} r={16} fill={C.green} opacity={0.22} />
                  <circle cx={px} cy={py} r={8} fill={C.green} />
                </>
              )}
              <text
                x={mx}
                y={my + (bend >= 0 ? -16 : 30)}
                textAnchor="middle"
                style={{ font: `500 ${h ? 23 : 25}px ${F.mono}`, fill: frame > hp.at + hp.dur ? C.ink : '#777' }}
              >
                {hp.label}
              </text>
            </g>
          );
        })}
      </svg>
      {nodes.map(n => (
        <div
          key={n.id}
          style={{
            position: 'absolute',
            left: n.x,
            top: n.y,
            width: n.w,
            height: n.h,
            borderRadius: 18,
            background: n.dark ? C.ink : '#fff',
            color: n.dark ? '#f2f2f0' : C.ink,
            boxShadow: '0 20px 40px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.07)',
            padding: '20px 24px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <div style={{ font: `600 ${h ? 36 : 38}px/1.1 ${F.display}`, letterSpacing: '-0.02em' }}>{n.title}</div>
          <div style={{ font: `400 ${h ? 21 : 23}px ${F.mono}`, color: n.dark ? '#a9a9a5' : C.faint }}>{n.sub}</div>
        </div>
      ))}
      {children}
    </div>
  );
}

/** A small stamp or status badge that pops in at `at`. */
export function Badge({ at, x, y, children, tone = 'green', size = 22 }: { at: number; x: number; y: number; children: React.ReactNode; tone?: 'green' | 'ink' | 'paper'; size?: number }) {
  const frame = useCurrentFrame();
  const a = clamp01((frame - at) / 8);
  if (a <= 0) return null;
  const bg = tone === 'green' ? C.green : tone === 'ink' ? C.ink : '#fff';
  const fg = tone === 'green' ? C.ink : tone === 'ink' ? '#fff' : C.ink;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: `scale(${lerp(1.4, 1, easeOut(a))}) rotate(${lerp(-6, -2, a)}deg)`,
        opacity: a,
        background: bg,
        color: fg,
        borderRadius: 10,
        padding: '10px 16px',
        font: `500 ${size}px ${F.mono}`,
        whiteSpace: 'nowrap',
        boxShadow: '0 10px 24px rgba(0,0,0,0.12)',
      }}
    >
      {children}
    </div>
  );
}
