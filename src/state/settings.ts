import { useCallback, useEffect, useState } from 'react';
import { normalizeHex } from '../lib/color';
import { evenStops, sanitizeStops } from '../lib/gradient';
import {
  DEFAULT_LIGHTING,
  DIRECTIONS,
  EFFECTS,
  WAVE_LENGTH_MAX,
  WAVE_LENGTH_MIN,
  type Direction,
  type EffectId,
  type LightingState,
} from '../hid/types';

export type Theme = 'dark' | 'light';

export interface Preset {
  id: string;
  name: string;
  lighting: LightingState;
  builtIn?: boolean;
}

export type TabId = 'lighting' | 'presets' | 'device';

export interface Settings {
  lighting: LightingState;
  presets: Preset[];
  /** Push every change to the keyboard as it happens. */
  liveSync: boolean;
  /** Commit to keyboard memory a moment after the last change. */
  autoSave: boolean;
  tab: TabId;
  theme: Theme;
}

const preset = (id: string, name: string, l: Partial<LightingState>): Preset => ({
  id,
  name,
  builtIn: true,
  lighting: { ...DEFAULT_LIGHTING, ...l },
});

export const BUILT_IN_PRESETS: Preset[] = [
  preset('nebula', 'Nebula', { effect: 'wave', color: '#8b5cf6', brightness: 85, speed: 45 }),
  preset('synthwave', 'Synthwave', { effect: 'customWave', gradient: evenStops(['#ff2d92', '#7c3aed', '#22d3ee']), brightness: 90, speed: 40 }),
  preset('sunset', 'Sunset', { effect: 'customWave', gradient: evenStops(['#ff3b30', '#ff9500', '#ffd60a', '#ff2d92']), brightness: 90, speed: 30 }),
  preset('ocean', 'Ocean', { effect: 'customWave', gradient: evenStops(['#0a84ff', '#22d3ee', '#34c759']), direction: 'left', brightness: 85, speed: 35 }),
  preset('ember', 'Ember', { effect: 'breathing', color: '#ff5a1f', brightness: 90, speed: 35 }),
  preset('glacier', 'Glacier', { effect: 'static', color: '#5ad1ff', brightness: 70 }),
  preset('aurora', 'Aurora', { effect: 'spectrum', color: '#22d3ee', brightness: 75, speed: 30 }),
  preset('typewriter', 'Typewriter', { effect: 'reactive', color: '#f5f5f4', brightness: 100, speed: 55 }),
  preset('midnight', 'Midnight', { effect: 'starlight', color: '#7c5cff', brightness: 65, speed: 40 }),
];

const STORAGE_KEY = 'opengalaxy:settings:v1';

const systemTheme = (): Theme => {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
};

const DEFAULTS: Settings = {
  lighting: DEFAULT_LIGHTING,
  presets: [],
  liveSync: true,
  autoSave: true,
  tab: 'lighting',
  theme: systemTheme(),
};

const clampPct = (n: unknown, fallback: number) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : fallback;

/** Validates untrusted JSON from localStorage field by field so a bad value never crashes startup. */
function sanitizeLighting(raw: unknown, fallback: LightingState = DEFAULT_LIGHTING): LightingState {
  const r = (raw ?? {}) as Partial<Record<keyof LightingState, unknown>>;
  const effect = EFFECTS.some((e) => e.id === r.effect) ? (r.effect as EffectId) : fallback.effect;
  return {
    effect,
    color: (typeof r.color === 'string' && normalizeHex(r.color)) || fallback.color,
    brightness: clampPct(r.brightness, fallback.brightness),
    speed: clampPct(r.speed, fallback.speed),
    direction: DIRECTIONS.includes(r.direction as Direction) ? (r.direction as Direction) : fallback.direction,
    rainbow: typeof r.rainbow === 'boolean' ? r.rainbow : fallback.rainbow,
    gradient: sanitizeStops(r.gradient) ?? fallback.gradient,
    waveLength:
      typeof r.waveLength === 'number' && Number.isFinite(r.waveLength)
        ? Math.round(Math.min(WAVE_LENGTH_MAX, Math.max(WAVE_LENGTH_MIN, r.waveLength)))
        : fallback.waveLength,
  };
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw) as Partial<Settings>;
    return {
      lighting: sanitizeLighting(p.lighting),
      presets: Array.isArray(p.presets)
        ? p.presets
            .filter((x): x is Preset => !!x && typeof x.id === 'string' && typeof x.name === 'string')
            .map((x) => ({ id: x.id, name: x.name.slice(0, 40), lighting: sanitizeLighting(x.lighting) }))
        : [],
      liveSync: typeof p.liveSync === 'boolean' ? p.liveSync : DEFAULTS.liveSync,
      autoSave: typeof p.autoSave === 'boolean' ? p.autoSave : DEFAULTS.autoSave,
      tab: p.tab === 'presets' || p.tab === 'device' ? p.tab : 'lighting',
      theme: p.theme === 'light' || p.theme === 'dark' ? p.theme : DEFAULTS.theme,
    };
  } catch {
    return DEFAULTS;
  }
}

/** Settings persisted to localStorage (writes are debounced so slider drags stay smooth). */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      } catch {
        /* storage full or blocked — preferences just won't persist */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [settings]);

  const update = useCallback(
    (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })),
    [],
  );

  const setLighting = useCallback(
    (patch: Partial<LightingState>) =>
      setSettings((s) => ({ ...s, lighting: sanitizeLighting({ ...s.lighting, ...patch }, s.lighting) })),
    [],
  );

  const savePreset = useCallback((name: string) => {
    setSettings((s) => ({
      ...s,
      presets: [
        ...s.presets,
        { id: crypto.randomUUID(), name: name.trim().slice(0, 40) || 'Untitled', lighting: s.lighting },
      ],
    }));
  }, []);

  const deletePreset = useCallback((id: string) => {
    setSettings((s) => ({ ...s, presets: s.presets.filter((p) => p.id !== id) }));
  }, []);

  return { settings, update, setLighting, savePreset, deletePreset };
}
