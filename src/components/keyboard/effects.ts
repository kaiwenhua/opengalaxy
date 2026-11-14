import { hexToRgb, hsvToRgb, type RGB } from '../../lib/color';
import { linearToSrgb, sampleStops, srgbToLinear, toRgbStops } from '../../lib/gradient';
import type { Direction, LedColor, LightingState } from '../../hid/types';
import { BOARD_H, BOARD_W, LIGHT_INDEX, type KeyDef } from './layout';

export interface Hit {
  x: number;
  y: number;
  t: number;
  key: number;
}

const BLACK: RGB = { r: 0, g: 0, b: 0 };
const scale = (c: RGB, k: number): RGB => ({ r: c.r * k, g: c.g * k, b: c.b * k });
const hue = (h: number) => hsvToRgb({ h, s: 1, v: 1 });

/** Deterministic per-key pseudo-random in [0,1). */
const rand = (i: number) => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Position of a key along the travel direction, 0 at the start edge → 1 at the far edge. */
function along(dir: Direction, cx: number, cy: number) {
  switch (dir) {
    case 'right':
      return cx / BOARD_W;
    case 'left':
      return 1 - cx / BOARD_W;
    case 'down':
      return cy / BOARD_H;
    case 'up':
      return 1 - cy / BOARD_H;
  }
}

/**
 * Approximates firmware effects for the on-screen preview, and renders Custom wave
 * frames for live streaming. `t` is seconds, `hits` are recent keypresses.
 */
export function renderFrame(keys: KeyDef[], s: LightingState, t: number, hits: Hit[]): RGB[] {
  const base = hexToRgb(s.color) ?? { r: 255, g: 255, b: 255 };
  const sp = 0.25 + (s.speed / 100) * 2.25;
  const level = s.brightness / 100;
  const stops = toRgbStops(s.gradient);

  return keys.map((k, i) => {
    const cx = k.x + k.w / 2;
    const cy = k.y + 0.5;
    let c: RGB;
    switch (s.effect) {
      case 'off':
        c = BLACK;
        break;
      case 'static':
        c = base;
        break;
      case 'breathing':
        c = scale(base, 0.08 + 0.92 * (0.5 - 0.5 * Math.cos(t * sp * Math.PI)));
        break;
      case 'wave': {
        // Pattern moves towards the travel direction: f(p − v·t).
        const p = along(s.direction, cx, cy) - t * sp * 0.25;
        c = s.rainbow ? hue(-p * 360) : scale(base, 0.12 + 0.88 * (0.5 + 0.5 * Math.cos(p * 2 * Math.PI)));
        break;
      }
      case 'customWave': {
        const len = Math.max(0.1, s.waveLength / 100);
        const shift = t * sp * 0.2; // keyboard lengths per second, independent of wave length
        // Average the gradient over the key's whole extent along the travel axis, so wide
        // keys (Space, Shift, Enter) blend smoothly instead of jumping with their centre point.
        const horizontal = s.direction === 'left' || s.direction === 'right';
        const extent = horizontal ? k.w : 1;
        const n = Math.max(3, Math.ceil(extent * 3));
        let lr = 0;
        let lg = 0;
        let lb = 0;
        for (let j = 0; j < n; j++) {
          const off = ((j + 0.5) / n - 0.5) * extent * 0.9;
          const p = along(s.direction, horizontal ? cx + off : cx, horizontal ? cy : cy + off);
          const col = sampleStops(stops, (p - shift) / len);
          lr += srgbToLinear(col.r);
          lg += srgbToLinear(col.g);
          lb += srgbToLinear(col.b);
        }
        c = { r: linearToSrgb(lr / n), g: linearToSrgb(lg / n), b: linearToSrgb(lb / n) };
        break;
      }
      case 'spectrum':
        c = hue(t * sp * 40);
        break;
      case 'reactive': {
        let e = 0;
        for (const h of hits) if (h.key === i) e = Math.max(e, 1 - (t - h.t) * sp * 0.9);
        c = scale(base, Math.max(0.04, e));
        break;
      }
      case 'ripple': {
        let e = 0;
        for (const h of hits) {
          const age = t - h.t;
          const r = age * sp * 9;
          const d = Math.hypot(cx - h.x, cy - h.y) - r;
          e += Math.exp(-(d * d) / 0.9) * Math.max(0, 1 - age / 2.2);
        }
        c = scale(base, Math.max(0.04, Math.min(1, e)));
        break;
      }
      case 'starlight': {
        const phase = rand(i) * 40;
        const tw = Math.max(0, Math.sin(t * sp * (0.6 + rand(i + 99)) + phase)) ** 10;
        c = scale(base, 0.06 + tw * 0.94);
        break;
      }
    }
    return scale(c, level);
  });
}

/** Converts a rendered frame to firmware LED entries (keys without a light index are skipped). */
export function frameToLeds(keys: KeyDef[], colors: RGB[]): LedColor[] {
  const leds: LedColor[] = [];
  keys.forEach((k, i) => {
    const index = LIGHT_INDEX[k.code];
    const c = colors[i];
    if (index === undefined || !c) return;
    const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
    leds.push({ index, r: byte(c.r), g: byte(c.g), b: byte(c.b) });
  });
  return leds;
}
