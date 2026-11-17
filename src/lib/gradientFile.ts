/**
 * Export / import of saved gradients as a small JSON file, so they can move between the
 * browser version and the desktop app (which keep separate settings).
 */
import { sameStops, sanitizeStops, sortStops } from './gradient';
import { MAX_SAVED_GRADIENTS, type SavedGradient } from '../state/settings';

const FORMAT = 'opengalaxy-gradients';
const VERSION = 1;
const MAX_FILE_BYTES = 1 << 20;

export interface GradientFile {
  format: typeof FORMAT;
  version: number;
  exportedAt: string;
  gradients: { name: string; stops: SavedGradient['stops'] }[];
}

export function serializeGradients(list: SavedGradient[]): string {
  const file: GradientFile = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    gradients: list.map((g) => ({ name: g.name, stops: g.stops })),
  };
  return JSON.stringify(file, null, 2);
}

/** Triggers a download of the gradients as opengalaxy-gradients-YYYY-MM-DD.json. */
export function downloadGradients(list: SavedGradient[]) {
  const blob = new Blob([serializeGradients(list)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `opengalaxy-gradients-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Parses an exported file (or a bare array of {name, stops}). Invalid entries are dropped. */
export function parseGradientFile(text: string): { name: string; stops: SavedGradient['stops'] }[] {
  if (text.length > MAX_FILE_BYTES) throw new Error('File is too large to be a gradient export.');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This is not a valid JSON file.');
  }
  const list = Array.isArray(data) ? data : (data as Partial<GradientFile> | null)?.gradients;
  if (!Array.isArray(list)) throw new Error('No gradients found in this file.');
  const out = list
    .map((g) => {
      const item = (g ?? {}) as { name?: unknown; stops?: unknown };
      const stops = sanitizeStops(item.stops);
      const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 40) : null;
      return stops && name ? { name, stops } : null;
    })
    .filter((g): g is { name: string; stops: SavedGradient['stops'] } => g !== null);
  if (out.length === 0) throw new Error('No valid gradients found in this file.');
  return out;
}

export interface MergeResult {
  gradients: SavedGradient[];
  added: number;
  skipped: number;
  dropped: number;
}

/**
 * Adds imported gradients to the library without losing anything: identical ones are
 * skipped, a different gradient with an existing name is added as "Name (2)".
 */
export function mergeGradients(
  existing: SavedGradient[],
  incoming: { name: string; stops: SavedGradient['stops'] }[],
  newId: () => string = () => crypto.randomUUID(),
): MergeResult {
  const result = [...existing];
  let added = 0;
  let skipped = 0;
  let dropped = 0;
  for (const g of incoming) {
    if (result.some((e) => sameStops(sortStops(e.stops), sortStops(g.stops)))) {
      skipped++;
      continue;
    }
    if (result.length >= MAX_SAVED_GRADIENTS) {
      dropped++;
      continue;
    }
    let name = g.name;
    const taken = (n: string) => result.some((e) => e.name.toLowerCase() === n.toLowerCase());
    for (let i = 2; taken(name); i++) name = `${g.name.slice(0, 34)} (${i})`;
    result.push({ id: newId(), name, stops: g.stops.map((s) => ({ ...s })) });
    added++;
  }
  return { gradients: result, added, skipped, dropped };
}
