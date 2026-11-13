import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const INTRO_KEY = 'hc-intro-seen';

/** Home entrance: the logos develop out of the grain on a full-height hero, then the hero settles,
 * the header drops in and the headline rises. Plays once per browser session. */
export function useIntro() {
  const [phase, setPhase] = useState<'pre' | 'develop' | 'settle' | ''>(() => {
    try {
      return reduced() || sessionStorage.getItem(INTRO_KEY) ? '' : 'pre';
    } catch {
      return '';
    }
  });
  useLayoutEffect(() => {
    if (phase !== 'pre') return;
    try {
      sessionStorage.setItem(INTRO_KEY, '1');
    } catch {
      /* storage blocked: the intro simply replays */
    }
    const root = document.documentElement;
    root.classList.add('intro');
    // The timers start from the first painted frame. A tab opened in the background gets no frames
    // until it is shown, so the intro waits for the viewer instead of finishing unseen and then
    // being rewound by a late frame (which left the headline hidden).
    let raf = 0,
      t1 = 0,
      t2 = 0;
    raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        setPhase('develop');
        t1 = window.setTimeout(() => {
          setPhase('settle');
          root.classList.add('intro-settle');
        }, 1150);
        t2 = window.setTimeout(() => {
          setPhase('');
          root.classList.remove('intro', 'intro-settle');
        }, 2900);
      });
    });
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      root.classList.remove('intro', 'intro-settle');
    };
  }, []);
  return phase;
}

/** Adds `.in` to every `.reveal` element below `root` as it scrolls into view. */
export function useReveal(deps: unknown[] = []) {
  useEffect(() => {
    const root = document.documentElement;
    if (reduced() || typeof IntersectionObserver !== 'function') return;
    root.classList.add('js-reveal');
    const io = new IntersectionObserver(
      entries =>
        entries.forEach(e => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }),
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    document.querySelectorAll('.reveal:not(.in)').forEach(el => io.observe(el));
    // A fast scroll or a jump can skip past an element between observer frames; never leave it hidden.
    let raf = 0;
    const sweep = () => {
      raf = 0;
      document.querySelectorAll('.reveal:not(.in)').forEach(el => {
        if (el.getBoundingClientRect().top < innerHeight) el.classList.add('in');
      });
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(sweep);
    };
    addEventListener('scroll', onScroll, { passive: true });
    return () => {
      io.disconnect();
      removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, deps);
}

/** Counts from 0 to `value` the first time the element is on screen. */
export function useCountUp(value: number, ms = 900) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(() => (reduced() ? value : 0));
  const started = useRef(false);
  useEffect(() => {
    if (reduced() || typeof IntersectionObserver !== 'function') return setShown(value);
    if (started.current) return setShown(value);
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      started.current = true;
      const t0 = performance.now();
      const tick = (t: number) => {
        const k = Math.min(1, (t - t0) / ms);
        setShown(Math.round(value * (1 - (1 - k) ** 3)));
        if (k < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value]);
  return { ref, shown };
}

/** Pointer position over an element as CSS vars --px/--py in [-1, 1], for gentle parallax. */
export function parallax(e: PointerEvent<HTMLElement>) {
  if (e.pointerType !== 'mouse' || reduced()) return;
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--px', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
  e.currentTarget.style.setProperty('--py', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
}
