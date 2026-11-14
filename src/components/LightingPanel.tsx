import {
  EFFECTS,
  WAVE_LENGTH_MAX,
  WAVE_LENGTH_MIN,
  effectDef,
  usesSingleColor,
  type Direction,
  type EffectId,
  type LightingState,
} from '../hid/types';
import { gradientCss } from '../lib/gradient';
import { ColorPicker } from './ColorPicker';
import { GradientEditor, type CustomWaveStatus } from './GradientEditor';
import { SectionTitle, Slider, cx } from './ui';

const RAINBOW = 'linear-gradient(90deg,#f43f5e,#f59e0b,#22c55e,#06b6d4,#8b5cf6)';

/** Small swatch hinting at what each effect looks like. */
function effectSwatch(id: EffectId, l: LightingState): string {
  switch (id) {
    case 'static':
      return 'var(--accent)';
    case 'breathing':
      return 'radial-gradient(circle, var(--accent), transparent 70%)';
    case 'wave':
      return RAINBOW;
    case 'customWave':
      return gradientCss(l.gradient, '90deg', 24);
    case 'spectrum':
      return 'conic-gradient(#f43f5e,#f59e0b,#22c55e,#06b6d4,#8b5cf6,#f43f5e)';
    case 'reactive':
      return 'radial-gradient(circle at 30% 40%, var(--accent) 0 18%, transparent 22%), var(--swatch-bg)';
    case 'ripple':
      return 'repeating-radial-gradient(circle, var(--accent) 0 2px, transparent 3px 7px)';
    case 'starlight':
      return 'radial-gradient(circle at 20% 30%, var(--accent) 0 8%, transparent 10%), radial-gradient(circle at 70% 60%, var(--accent) 0 6%, transparent 8%), radial-gradient(circle at 45% 80%, var(--accent) 0 5%, transparent 7%), var(--swatch-bg)';
    case 'off':
      return 'var(--swatch-bg)';
  }
}

export function LightingPanel({
  lighting,
  onChange,
  customWave,
}: {
  lighting: LightingState;
  onChange: (patch: Partial<LightingState>) => void;
  /** Keyboard status for Custom wave, shown under the gradient editor. */
  customWave: CustomWaveStatus;
}) {
  const def = effectDef(lighting.effect);
  const isWave = lighting.effect === 'wave';
  const isCustom = lighting.effect === 'customWave';

  return (
    <div className="grid gap-8 lg:grid-cols-[1.15fr_1fr]">
      <div className="space-y-8">
        <section>
          <SectionTitle>Effect</SectionTitle>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
            {EFFECTS.map((e) => {
              const active = e.id === lighting.effect;
              return (
                <button
                  key={e.id}
                  onClick={() => onChange({ effect: e.id })}
                  aria-pressed={active}
                  className={cx(
                    'group rounded-xl border p-3 text-left transition-all',
                    active
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] shadow-[0_0_0_1px_var(--accent),0_10px_30px_-12px_var(--accent)]'
                      : 'border-fg/[0.08] bg-fg/[0.02] hover:border-fg/15 hover:bg-fg/[0.04]',
                  )}
                >
                  <div
                    className="mb-3 h-8 rounded-lg ring-1 ring-fg/10 transition-transform group-hover:scale-[1.03]"
                    style={{ background: effectSwatch(e.id, lighting) }}
                  />
                  <div className="text-sm font-medium text-ink-100">{e.label}</div>
                  <div className="text-xs text-ink-400">{e.hint}</div>
                </button>
              );
            })}
          </div>
        </section>

        {(isWave || isCustom) && (
          <section className="space-y-4">
            <SectionTitle>Wave</SectionTitle>
            {isWave && (
              <Segmented
                label="Colours"
                value={lighting.rainbow ? 'rainbow' : 'single'}
                options={[
                  { id: 'rainbow', label: 'Rainbow' },
                  { id: 'single', label: 'One colour' },
                ]}
                onChange={(v) => onChange({ rainbow: v === 'rainbow' })}
              />
            )}
            <DirectionPicker value={lighting.direction} onChange={(direction) => onChange({ direction })} />
            {isCustom && (
              <div className="pt-2">
                <Slider
                  label="Wave length"
                  value={lighting.waveLength}
                  min={WAVE_LENGTH_MIN}
                  max={WAVE_LENGTH_MAX}
                  step={10}
                  format={(v) => `×${(v / 100).toFixed(1)}`}
                  suffix=""
                  onChange={(waveLength) => onChange({ waveLength })}
                />
                <p className="mt-2 text-xs text-ink-400">
                  How long one pass through your colours is, in keyboard widths. Longer gives each transition more keys
                  and looks smoother, especially with many colours.
                </p>
              </div>
            )}
          </section>
        )}

        <section className="space-y-6">
          <SectionTitle>Output</SectionTitle>
          <Slider
            label="Brightness"
            value={lighting.brightness}
            onChange={(brightness) => onChange({ brightness })}
            disabled={lighting.effect === 'off'}
          />
          <Slider
            label="Animation speed"
            value={lighting.speed}
            onChange={(speed) => onChange({ speed })}
            disabled={!def.usesSpeed}
          />
        </section>
      </div>

      {isCustom ? (
        <GradientEditor stops={lighting.gradient} onChange={(gradient) => onChange({ gradient })} status={customWave} />
      ) : (
        <section>
          <SectionTitle
            aside={!usesSingleColor(lighting) && <span className="text-xs text-ink-400">Not used by {def.label}</span>}
          >
            Colour
          </SectionTitle>
          <ColorPicker
            value={lighting.color}
            onChange={(color) => onChange({ color })}
            disabled={!usesSingleColor(lighting)}
          />
        </section>
      )}
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-ink-300">{label}</span>
      <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl border border-fg/[0.08] bg-shade/30 p-1">
        {options.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={value === o.id}
            onClick={() => onChange(o.id)}
            className={cx(
              'h-8 rounded-lg px-3.5 text-sm font-medium transition-all',
              value === o.id ? 'bg-fg/[0.1] text-ink-100' : 'text-ink-400 hover:text-ink-100',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const ARROWS: Record<Direction, { label: string; path: string }> = {
  right: { label: 'Left to right', path: 'M4 10h11M11 5l5 5-5 5' },
  left: { label: 'Right to left', path: 'M16 10H5M9 5l-5 5 5 5' },
  down: { label: 'Top to bottom', path: 'M10 4v11M5 11l5 5 5-5' },
  up: { label: 'Bottom to top', path: 'M10 16V5M5 9l5-5 5 5' },
};

function DirectionPicker({ value, onChange }: { value: Direction; onChange: (d: Direction) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-ink-300">Direction</span>
      <div role="radiogroup" aria-label="Direction" className="inline-flex gap-1 rounded-xl border border-fg/[0.08] bg-shade/30 p-1">
        {(Object.keys(ARROWS) as Direction[]).map((d) => (
          <button
            key={d}
            role="radio"
            aria-checked={value === d}
            aria-label={ARROWS[d].label}
            title={ARROWS[d].label}
            onClick={() => onChange(d)}
            className={cx(
              'grid h-8 w-9 place-items-center rounded-lg transition-all',
              value === d ? 'bg-[var(--accent)] text-[var(--accent-fg)]' : 'text-ink-400 hover:bg-fg/[0.06] hover:text-ink-100',
            )}
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={ARROWS[d].path} />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
