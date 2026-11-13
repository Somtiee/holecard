import { useCurrentFrame } from 'remotion';
import { C, F } from '../lib/theme';
import { clamp01, easeOut, enter, prog, easeInOut } from '../lib/anim';
import { ORDER, TECH } from '../lib/tech';
import { T } from '../timeline';
import { NetBadge } from '../ui/Caption';
import { Paper, useLayout } from '../ui/Shot';

/** Scene 13: all twelve NEAR technologies tick on, two per beat. */
export function Stack({ first = T.stack.first, step = T.stack.step, out = 168 }: { first?: number; step?: number; out?: number }) {
  const frame = useCurrentFrame();
  const layout = useLayout();
  const h = layout === 'h';
  const head = enter(frame, 0);
  const leave = prog(frame, out, 12, easeInOut);
  return (
    <Paper>
      <div style={{ position: 'absolute', inset: 0, opacity: 1 - leave }}>
        <div style={{ position: 'absolute', left: h ? 100 : 50, top: h ? 70 : 150, opacity: head.opacity, transform: `translateY(${head.y}px)` }}>
          <div style={{ font: `500 ${h ? 22 : 28}px ${F.mono}`, color: C.greenText, letterSpacing: '0.06em' }}>the_near_stack</div>
          <div style={{ font: `600 ${h ? 64 : 72}px/1 ${F.display}`, letterSpacing: '-0.035em', marginTop: 10 }}>Twelve NEAR technologies. One poker table.</div>
        </div>
        <div
          style={{
            position: 'absolute',
            left: h ? 100 : 50,
            right: h ? 100 : 50,
            top: h ? 250 : 380,
            display: 'grid',
            gridTemplateColumns: h ? 'repeat(4, 1fr)' : 'repeat(2, 1fr)',
            gap: h ? 18 : 20,
          }}
        >
          {ORDER.map((k, i) => {
            const tech = TECH[k];
            const a = clamp01((frame - (first + i * step)) / 6);
            const [brand, ...rest] = tech.tag.split(' · ');
            return (
              <div
                key={k}
                style={{
                  opacity: 0.15 + 0.85 * a,
                  transform: `translateY(${(1 - easeOut(a)) * 16}px)`,
                  background: a >= 1 ? C.ink : '#fff',
                  color: a >= 1 ? '#f2f2f0' : C.ink,
                  borderRadius: 16,
                  padding: h ? '22px 24px' : '24px 26px',
                  minHeight: h ? 220 : 196,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  boxShadow: '0 16px 30px rgba(0,0,0,0.08)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, font: `500 ${h ? 17 : 21}px ${F.mono}`, color: a >= 1 ? '#a9a9a5' : C.faint }}>
                  <span style={{ width: 10, height: 10, borderRadius: 5, background: C.green }} />
                  {String(tech.n).padStart(2, '0')} · {brand}
                </div>
                <div style={{ font: `600 ${h ? 32 : 36}px/1.05 ${F.display}`, letterSpacing: '-0.02em' }}>{rest.join(' · ') || brand}</div>
                <div style={{ font: `400 ${h ? 20 : 24}px/1.35 ${F.sans}`, color: a >= 1 ? '#cfcfcb' : '#555', marginTop: 'auto' }}>{tech.short}</div>
              </div>
            );
          })}
        </div>
      </div>
      <NetBadge />
    </Paper>
  );
}
