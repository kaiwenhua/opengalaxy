import { useEffect, useRef } from 'react';
import type { LightingState } from '../../hid/types';
import { renderFrame, type Hit } from './effects';
import { BOARD_H, BOARD_W, KEYS } from './layout';

const codeToIndex = new Map(KEYS.map((k, i) => [k.code, i]));

/**
 * Live, animated preview of the current lighting. Runs one rAF loop that writes a
 * CSS variable per key (no React re-render per frame). Typing on your real keyboard
 * or clicking keys triggers the reactive / ripple effects.
 */
export function KeyboardPreview({ lighting }: { lighting: LightingState }) {
  const keyEls = useRef<(HTMLDivElement | null)[]>([]);
  const glowEl = useRef<HTMLDivElement | null>(null);
  const lightingRef = useRef(lighting);
  const hits = useRef<Hit[]>([]);
  const lastHit = useRef(0);

  lightingRef.current = lighting;

  const press = (i: number) => {
    const k = KEYS[i];
    if (!k) return;
    const t = performance.now() / 1000;
    hits.current = [...hits.current.filter((h) => t - h.t < 3), { x: k.x + k.w / 2, y: k.y + 0.5, t, key: i }].slice(-24);
    lastHit.current = t;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't react to typing inside inputs (hex field, preset name…)
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const i = codeToIndex.get(e.code);
      if (i !== undefined) press(i);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    let raf = 0;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const frame = () => {
      const t = reduceMotion ? 0 : performance.now() / 1000;
      const s = lightingRef.current;

      // Ghost typing keeps reactive modes alive when the user isn't typing.
      if ((s.effect === 'reactive' || s.effect === 'ripple') && t - lastHit.current > 1.2 && !reduceMotion) {
        if (Math.random() < 0.06) press(Math.floor(Math.random() * KEYS.length));
      }

      const colors = renderFrame(KEYS, s, t, hits.current);
      let sr = 0;
      let sg = 0;
      let sb = 0;
      colors.forEach((c, i) => {
        const el = keyEls.current[i];
        if (el) el.style.setProperty('--c', `rgb(${c.r | 0} ${c.g | 0} ${c.b | 0})`);
        sr += c.r;
        sg += c.g;
        sb += c.b;
      });
      const n = colors.length || 1;
      glowEl.current?.style.setProperty('--glow', `rgb(${(sr / n) | 0} ${(sg / n) | 0} ${(sb / n) | 0})`);
      if (!reduceMotion) raf = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [lighting]);

  return (
    <div className="relative">
      {/* underglow cast on the desk */}
      <div
        ref={glowEl}
        aria-hidden
        className="pointer-events-none absolute -inset-x-2 sm:-inset-x-6 -bottom-8 top-10 rounded-[40%] opacity-60 blur-3xl transition-[background] duration-300"
        style={{ background: 'radial-gradient(closest-side, var(--glow, transparent), transparent)' }}
      />
      {/* case */}
      <div className="relative rounded-[1.4rem] bg-gradient-to-b from-[#24242e] to-[#14141b] p-[1.6%] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.08)] ring-1 ring-black/60">
        <div className="rounded-[0.9rem] bg-[#09090d] p-[0.9%] shadow-[inset_0_2px_8px_rgba(0,0,0,0.8)]">
          <div className="board" role="img" aria-label="Keyboard lighting preview">
            {KEYS.map((k, i) => (
              <div
                key={k.code}
                ref={(el) => {
                  keyEls.current[i] = el;
                }}
                className="key"
                style={{
                  left: `${(k.x / BOARD_W) * 100}%`,
                  top: `${(k.y / BOARD_H) * 100}%`,
                  width: `${(k.w / BOARD_W) * 100}%`,
                  height: `${(1 / BOARD_H) * 100}%`,
                }}
                onPointerDown={() => press(i)}
              >
                <div className="cap">{k.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
