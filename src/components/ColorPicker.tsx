import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { clamp, hexToRgb, hsvToRgb, normalizeHex, rgbToHex, rgbToHsv, type HSV } from '../lib/color';
import { cx } from './ui';

const SWATCHES = ['#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#22d3ee', '#0a84ff', '#8b5cf6', '#ff2d92', '#ffffff'];

/** Saturation/value pad + hue rail + HEX/RGB inputs. Holds HSV internally so hue survives greys. */
export function ColorPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
}) {
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(hexToRgb(value) ?? { r: 255, g: 255, b: 255 }));
  const [hexDraft, setHexDraft] = useState(value);
  const pad = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef(value);

  // Sync when the value changes from outside (preset applied, read from device…).
  useEffect(() => {
    setHexDraft(value);
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    const rgb = hexToRgb(value);
    if (rgb) setHsv(rgbToHsv(rgb));
  }, [value]);

  const emit = (next: HSV) => {
    setHsv(next);
    const hex = rgbToHex(hsvToRgb(next));
    lastEmitted.current = hex;
    onChange(hex);
  };

  const onPad = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || (e.type === 'pointermove' && e.buttons !== 1)) return;
    const r = pad.current!.getBoundingClientRect();
    emit({
      h: hsv.h,
      s: clamp((e.clientX - r.left) / r.width, 0, 1),
      v: clamp(1 - (e.clientY - r.top) / r.height, 0, 1),
    });
  };

  const rgb = hexToRgb(value) ?? { r: 0, g: 0, b: 0 };

  return (
    <div className={cx('space-y-4', disabled && 'pointer-events-none opacity-40')}>
      <div
        ref={pad}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          onPad(e);
        }}
        onPointerMove={onPad}
        className="relative h-40 cursor-crosshair touch-none overflow-hidden rounded-xl ring-1 ring-fg/10"
        style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-white to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent" />
        <div
          className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4),0_4px_12px_rgba(0,0,0,0.5)]"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: value }}
        />
      </div>

      <input
        type="range"
        min={0}
        max={359}
        value={Math.round(hsv.h)}
        onChange={(e) => emit({ ...hsv, h: Number(e.target.value) })}
        className="range hue-range"
        aria-label="Hue"
      />

      <div className="grid grid-cols-[1.6fr_1fr_1fr_1fr] gap-2">
        <Field label="HEX">
          <input
            value={hexDraft}
            spellCheck={false}
            onChange={(e) => {
              setHexDraft(e.target.value);
              const hex = normalizeHex(e.target.value);
              if (hex && e.target.value.replace('#', '').length === 6) {
                lastEmitted.current = '';
                onChange(hex);
              }
            }}
            onBlur={() => setHexDraft(value)}
            className="w-full bg-transparent font-mono text-sm uppercase outline-none"
          />
        </Field>
        {(['r', 'g', 'b'] as const).map((ch) => (
          <Field key={ch} label={ch.toUpperCase()}>
            <input
              type="number"
              min={0}
              max={255}
              value={rgb[ch]}
              onChange={(e) => {
                lastEmitted.current = '';
                onChange(rgbToHex({ ...rgb, [ch]: clamp(Number(e.target.value) || 0, 0, 255) }));
              }}
              className="w-full bg-transparent font-mono text-sm tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
            />
          </Field>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {SWATCHES.map((s) => (
          <button
            key={s}
            type="button"
            aria-label={`Use ${s}`}
            onClick={() => {
              lastEmitted.current = '';
              onChange(s);
            }}
            className={cx(
              'h-7 w-7 rounded-full border border-fg/20 transition-transform hover:scale-110',
              value.toLowerCase() === s && 'outline-2 outline-offset-2 outline-ink-100',
            )}
            style={{ backgroundColor: s, boxShadow: `0 4px 14px -4px ${s}` }}
          />
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="rounded-lg border border-fg/[0.07] bg-shade/25 px-2.5 py-1.5 focus-within:border-[var(--accent)]">
      <span className="block text-[10px] font-semibold tracking-wider text-ink-400">{label}</span>
      {children}
    </label>
  );
}
