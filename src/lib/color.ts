export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** h: 0–360, s: 0–1, v: 0–1 */
export interface HSV {
  h: number;
  s: number;
  v: number;
}

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: RGB): string {
  return (
    '#' +
    [r, g, b]
      .map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0'))
      .join('')
  );
}

/** Returns a canonical lowercase #rrggbb string, or null when the input is not a colour. */
export function normalizeHex(hex: string): string | null {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHex(rgb) : null;
}

export function rgbToHsv({ r, g, b }: RGB): HSV {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export const toHexByte = (n: number) => n.toString(16).padStart(2, '0');

export function bytesToHex(bytes: Uint8Array, trimTrailingZeros = false): string {
  let end = bytes.length;
  if (trimTrailingZeros) while (end > 1 && bytes[end - 1] === 0) end--;
  return Array.from(bytes.subarray(0, end), toHexByte).join(' ');
}

/** Parses "07 03 01 ff", "0x07,0x03" or "070301ff" into bytes. Throws on invalid input. */
export function parseHexBytes(input: string): Uint8Array {
  const cleaned = input.replace(/0x/gi, ' ').replace(/[,;]/g, ' ').trim();
  if (!cleaned) return new Uint8Array();
  const tokens = cleaned.includes(' ')
    ? cleaned.split(/\s+/)
    : (cleaned.match(/.{1,2}/g) ?? []);
  return Uint8Array.from(
    tokens.map((t) => {
      if (!/^[0-9a-f]{1,2}$/i.test(t)) throw new Error(`"${t}" is not a hex byte`);
      return parseInt(t, 16);
    }),
  );
}
