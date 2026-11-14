import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'ghost' | 'subtle' | 'danger';

export function Button({
  variant = 'subtle',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 h-10 text-sm font-medium whitespace-nowrap',
        'transition-all duration-150 select-none outline-none',
        'focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950',
        'disabled:opacity-40 disabled:pointer-events-none',
        variant === 'primary' &&
          'bg-[var(--accent)] text-[var(--accent-fg)] shadow-[0_8px_30px_-8px_var(--accent)] hover:brightness-110 active:brightness-95',
        variant === 'subtle' && 'bg-fg/[0.06] text-ink-100 hover:bg-fg/[0.1] border border-fg/[0.06]',
        variant === 'ghost' && 'text-ink-300 hover:text-ink-100 hover:bg-fg/[0.05]',
        variant === 'danger' && 'text-rose-600 dark:text-rose-300 hover:bg-rose-500/10',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Slider({
  label,
  value,
  onChange,
  disabled,
  suffix = '%',
  min = 0,
  max = 100,
  step = 1,
  format = String,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Formats the displayed value (the slider itself stays numeric). */
  format?: (v: number) => string;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className={cx('block', disabled && 'opacity-50')}>
      <div className="mb-2.5 flex items-baseline justify-between">
        <span className="text-sm text-ink-300">{label}</span>
        <span className="font-mono text-sm tabular-nums text-ink-100">
          {format(value)}
          <span className="text-ink-400">{suffix}</span>
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="range"
        style={{ '--fill': `${fill}%` } as CSSProperties}
      />
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-1">
      <span>
        <span className="block text-sm text-ink-100">{label}</span>
        {hint && <span className="block text-xs text-ink-400">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors',
          checked ? 'bg-[var(--accent)]' : 'bg-ink-600',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
            checked && 'translate-x-5',
          )}
        />
      </button>
    </label>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h3 className="text-xs font-semibold tracking-[0.14em] text-ink-400 uppercase">{children}</h3>
      {aside}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" className="inline-flex rounded-xl bg-shade/30 p-1 border border-fg/[0.06]">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            'h-8 rounded-lg px-4 text-sm font-medium transition-all',
            value === t.id
              ? 'bg-fg/[0.09] text-ink-100 shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]'
              : 'text-ink-400 hover:text-ink-100',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
