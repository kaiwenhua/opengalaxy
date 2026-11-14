import { useState, type CSSProperties } from 'react';
import { effectDef, usesSingleColor, type LightingState } from '../hid/types';
import { gradientCss, sameStops, sortStops } from '../lib/gradient';
import { BUILT_IN_PRESETS, type Preset } from '../state/settings';
import { Button, SectionTitle, cx } from './ui';

const sameLighting = (a: LightingState, b: LightingState) =>
  a.effect === b.effect &&
  a.brightness === b.brightness &&
  a.speed === b.speed &&
  (!usesSingleColor(a) || a.color === b.color) &&
  (a.effect !== 'wave' || (a.rainbow === b.rainbow && a.direction === b.direction)) &&
  (a.effect !== 'customWave' || (sameStops(a.gradient, b.gradient) && a.direction === b.direction));

function presetSwatch(l: LightingState): CSSProperties {
  if (l.effect === 'customWave') {
    return {
      background: gradientCss(l.gradient, '135deg', 16),
      boxShadow: `0 6px 18px -6px ${sortStops(l.gradient)[0]?.color}`,
    };
  }
  if (usesSingleColor(l)) return { background: l.color, boxShadow: `0 6px 18px -6px ${l.color}` };
  if (l.effect === 'off') return { background: 'var(--swatch-bg)' };
  return {
    background: 'conic-gradient(#f43f5e,#f59e0b,#22c55e,#06b6d4,#8b5cf6,#f43f5e)',
    boxShadow: '0 6px 18px -6px #8b5cf6',
  };
}

export function PresetsPanel({
  lighting,
  presets,
  onApply,
  onSave,
  onDelete,
}: {
  lighting: LightingState;
  presets: Preset[];
  onApply: (l: LightingState) => void;
  onSave: (name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState('');

  return (
    <div className="space-y-8">
      <section>
        <SectionTitle>Save current lighting</SectionTitle>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(name);
            setName('');
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Preset name"
            maxLength={40}
            className="h-10 flex-1 rounded-xl border border-fg/[0.07] bg-shade/25 px-3.5 text-sm outline-none placeholder:text-ink-400 focus:border-[var(--accent)]"
          />
          <Button type="submit" variant="primary">
            Save preset
          </Button>
        </form>
      </section>

      {presets.length > 0 && (
        <section>
          <SectionTitle>Your presets</SectionTitle>
          <PresetGrid presets={presets} lighting={lighting} onApply={onApply} onDelete={onDelete} />
        </section>
      )}

      <section>
        <SectionTitle>Built-in</SectionTitle>
        <PresetGrid presets={BUILT_IN_PRESETS} lighting={lighting} onApply={onApply} />
      </section>
    </div>
  );
}

function PresetGrid({
  presets,
  lighting,
  onApply,
  onDelete,
}: {
  presets: Preset[];
  lighting: LightingState;
  onApply: (l: LightingState) => void;
  onDelete?: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {presets.map((p) => {
        const active = sameLighting(p.lighting, lighting);
        const def = effectDef(p.lighting.effect);
        return (
          <div
            key={p.id}
            className={cx(
              'group relative flex items-center gap-3 rounded-xl border p-3 transition-all',
              active ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-fg/[0.07] bg-fg/[0.02] hover:border-fg/15',
            )}
          >
            <button className="absolute inset-0 rounded-xl" aria-label={`Apply ${p.name}`} onClick={() => onApply(p.lighting)} />
            <span
              className="h-9 w-9 shrink-0 rounded-lg ring-1 ring-fg/10"
              style={presetSwatch(p.lighting)}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{p.name}</span>
              <span className="block text-xs text-ink-400">
                {def.label} · {p.lighting.brightness}%
              </span>
            </span>
            {onDelete && (
              <button
                onClick={() => onDelete(p.id)}
                aria-label={`Delete ${p.name}`}
                className="relative z-10 rounded-md px-2 py-1 text-xs text-ink-400 opacity-0 transition hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-300 group-hover:opacity-100 focus:opacity-100"
              >
                Delete
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
