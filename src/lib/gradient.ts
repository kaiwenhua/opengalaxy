import type { GradientStop } from '../hid/types';
import { GRADIENT_MAX, GRADIENT_MIN } from '../hid/types';
import { hexToRgb, normalizeHex, rgbToHex, type RGB } from './color';

const frac = (x: number) => x - Math.floor(x);

/** Evenly spaced stops for a list of colours. */
export const evenStops = (colors: string[]): GradientStop[] =>
  colors.map((color, i) => ({ color, pos: i / colors.length }));

export const sortStops = (stops: readonly GradientStop[]) => [...stops].sort((a, b) => a.pos - b.pos);

// ── Colour spaces ───────────────────────────────────────────────────────────
// Gradients blend in OKLab (perceptually even steps, no grey or overly bright
// midpoints between distant hues). Averaging light over a key uses linear RGB.

export const srgbToLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
export const linearToSrgb = (v: number) => {
  const x = Math.min(1, Math.max(0, v));
  return 255 * (x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055);
};

export interface Lab {
  L: number;
  a: number;
  b: number;
}

export function rgbToOklab({ r, g, b }: RGB): Lab {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabToRgb({ L, a, b }: Lab): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

export interface RgbStop {
  rgb: RGB;
  lab: Lab;
  pos: number;
}

export const toRgbStops = (stops: readonly GradientStop[]): RgbStop[] =>
  sortStops(stops).map((s) => {
    const rgb = hexToRgb(s.color) ?? { r: 0, g: 0, b: 0 };
    return { rgb, lab: rgbToOklab(rgb), pos: frac(s.pos) };
  });

/**
 * Samples a looping gradient at p (any real number; only the fractional part matters).
 * Between the last stop and the first stop (+1) the colour wraps around.
 * `stops` must be sorted by position (use toRgbStops).
 */
export function sampleStops(stops: readonly RgbStop[], p: number): RGB {
  const n = stops.length;
  if (n === 0) return { r: 0, g: 0, b: 0 };
  if (n === 1) return stops[0]!.rgb;
  const x = frac(p);
  // Find the segment [a, b) containing x, with wrap-around.
  let a = stops[n - 1]!;
  let b = stops[0]!;
  let aPos = a.pos - 1;
  let bPos = b.pos;
  for (let i = 0; i < n; i++) {
    const s = stops[i]!;
    if (s.pos > x) {
      b = s;
      bPos = s.pos;
      break;
    }
    a = s;
    aPos = s.pos;
    b = stops[(i + 1) % n]!;
    bPos = i + 1 < n ? b.pos : b.pos + 1;
  }
  const span = bPos - aPos;
  const t = span > 1e-6 ? (x - aPos) / span : 0;
  if (t <= 0) return a.rgb;
  if (t >= 1) return b.rgb;
  return oklabToRgb({
    L: a.lab.L + (b.lab.L - a.lab.L) * t,
    a: a.lab.a + (b.lab.a - a.lab.a) * t,
    b: a.lab.b + (b.lab.b - a.lab.b) * t,
  });
}

/** Colour of the gradient at a position, as #rrggbb (used when adding a stop). */
export const colorAt = (stops: readonly GradientStop[], p: number) => rgbToHex(sampleStops(toRgbStops(stops), p));

/**
 * CSS linear-gradient for one loop of the gradient. Sampled with the same OKLab
 * blending as the keyboard, so the on-screen bar matches what the keys show.
 */
export function gradientCss(stops: readonly GradientStop[], angle = '90deg', samples = 48): string {
  const rgbStops = toRgbStops(stops);
  const parts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const p = i / samples;
    parts.push(`${rgbToHex(sampleStops(rgbStops, p))} ${(p * 100).toFixed(2)}%`);
  }
  return `linear-gradient(${angle}, ${parts.join(', ')})`;
}

/** Validates gradient data from storage. Accepts the old `string[]` format (evenly spaced). */
export function sanitizeStops(raw: unknown): GradientStop[] | null {
  if (!Array.isArray(raw)) return null;
  const stops: GradientStop[] = [];
  raw.forEach((item, i) => {
    if (typeof item === 'string') {
      const color = normalizeHex(item);
      if (color) stops.push({ color, pos: i / raw.length });
    } else if (item && typeof item === 'object') {
      const { color, pos } = item as { color?: unknown; pos?: unknown };
      const hex = typeof color === 'string' ? normalizeHex(color) : null;
      if (hex && typeof pos === 'number' && Number.isFinite(pos)) stops.push({ color: hex, pos: Math.min(0.999, Math.max(0, pos)) });
    }
  });
  return stops.length >= GRADIENT_MIN ? stops.slice(0, GRADIENT_MAX) : null;
}

export const sameStops = (a: readonly GradientStop[], b: readonly GradientStop[]) =>
  a.length === b.length && a.every((s, i) => s.color === b[i]!.color && Math.abs(s.pos - b[i]!.pos) < 1e-4);
