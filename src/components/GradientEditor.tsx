import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { GRADIENT_MAX, GRADIENT_MIN, type GradientStop } from '../hid/types';
import { colorAt, evenStops, gradientCss, sameStops, sortStops } from '../lib/gradient';
import { downloadGradients, mergeGradients, parseGradientFile } from '../lib/gradientFile';
import { MAX_SAVED_GRADIENTS, type SavedGradient } from '../state/settings';
import { ColorPicker } from './ColorPicker';
import { Button, SectionTitle, cx } from './ui';

export interface CustomWaveStatus {
  note: string;
  tone: 'ok' | 'warn' | 'info';
  action?: { label: string; onClick: () => void };
}

const QUICK_GRADIENTS: { name: string; stops: GradientStop[] }[] = [
  { name: 'Synthwave', stops: evenStops(['#ff2d92', '#7c3aed', '#22d3ee']) },
  { name: 'Sunset', stops: evenStops(['#ff3b30', '#ff9500', '#ffd60a', '#ff2d92']) },
  { name: 'Ocean', stops: evenStops(['#0a84ff', '#22d3ee', '#34c759']) },
  {
    name: 'Fire',
    stops: [
      { color: '#ff0000', pos: 0 },
      { color: '#ff7a00', pos: 0.35 },
      { color: '#ffd000', pos: 0.45 },
      { color: '#ff3000', pos: 0.6 },
    ],
  },
  { name: 'Mint', stops: evenStops(['#00f5a0', '#00d9f5']) },
  { name: 'Candy', stops: evenStops(['#ff9ff3', '#feca57', '#48dbfb']) },
  {
    name: 'Police',
    stops: [
      { color: '#ff0000', pos: 0 },
      { color: '#ff0000', pos: 0.4 },
      { color: '#0033ff', pos: 0.5 },
      { color: '#0033ff', pos: 0.9 },
    ],
  },
  { name: 'Rainbow', stops: evenStops(['#ff0000', '#ff8800', '#ffee00', '#22dd22', '#00ccff', '#3344ff', '#aa22ff']) },
];

/** The user's saved gradients: save the current one under a name, apply or delete saved ones. */
function MyGradients({
  library,
  stops,
  onApply,
}: {
  library: GradientLibrary;
  stops: GradientStop[];
  onApply: (stops: GradientStop[]) => void;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const current = library.saved.find((g) => sameStops(sortStops(g.stops), sortStops(stops)));

  const importFile = async (file: File) => {
    try {
      const incoming = parseGradientFile(await file.text());
      const r = mergeGradients(library.saved, incoming);
      library.onReplaceAll(r.gradients);
      const parts = [`Imported ${r.added} gradient${r.added === 1 ? '' : 's'}`];
      if (r.skipped) parts.push(`${r.skipped} already saved`);
      if (r.dropped) parts.push(`${r.dropped} not added (limit of ${MAX_SAVED_GRADIENTS} reached)`);
      setMessage({ tone: 'ok', text: parts.join(' · ') });
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const save = () => {
    const finalName = name.trim() || `Gradient ${library.saved.length + 1}`;
    library.onSave(finalName, stops);
    setNaming(false);
    setName('');
    setJustSaved(finalName);
    setTimeout(() => setJustSaved(null), 2500);
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs whitespace-nowrap text-ink-400">
          My gradients{library.saved.length > 0 && ` · ${library.saved.length}/${MAX_SAVED_GRADIENTS}`}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            title="Add gradients from an exported .json file"
            className="rounded-md px-2 py-1 text-xs text-ink-400 hover:bg-fg/[0.06] hover:text-ink-100"
          >
            Import
          </button>
          <button
            type="button"
            onClick={() => {
              downloadGradients(library.saved);
              setMessage({ tone: 'ok', text: `Exported ${library.saved.length} gradient${library.saved.length === 1 ? '' : 's'} to your Downloads folder` });
            }}
            disabled={library.saved.length === 0}
            title="Save all your gradients to a .json file"
            className="rounded-md px-2 py-1 text-xs text-ink-400 hover:bg-fg/[0.06] hover:text-ink-100 disabled:pointer-events-none disabled:opacity-40"
          >
            Export
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            aria-label="Import gradients file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ''; // allow importing the same file again
              if (file) void importFile(file);
            }}
          />
        </div>
      </div>

      {!naming && (
        <button
          type="button"
          onClick={() => setNaming(true)}
          className="-ml-2 mb-2 max-w-full truncate rounded-md px-2 py-1 text-left text-xs font-medium text-[var(--accent)] hover:bg-fg/[0.06]"
        >
          {justSaved ? `✓ Saved "${justSaved}"` : current ? `✓ Saved as "${current.name}" · save again` : '+ Save current gradient'}
        </button>
      )}

      {message && (
        <p
          role="status"
          className={cx(
            'mb-2 text-xs',
            message.tone === 'ok' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300',
          )}
        >
          {message.text}
        </p>
      )}

      {naming && (
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setNaming(false)}
            placeholder={current?.name ?? `Gradient ${library.saved.length + 1}`}
            maxLength={40}
            aria-label="Gradient name"
            className="h-9 min-w-0 flex-1 rounded-lg border border-fg/[0.08] bg-shade/25 px-3 text-sm outline-none placeholder:text-ink-400 focus:border-[var(--accent)]"
          />
          <Button type="submit" variant="primary" className="h-9 px-3 text-xs">
            Save
          </Button>
          <Button type="button" variant="ghost" className="h-9 px-3 text-xs" onClick={() => setNaming(false)}>
            Cancel
          </Button>
        </form>
      )}

      {library.saved.length === 0 ? (
        !naming && <p className="text-xs text-ink-400">Save the current gradient to find it here again.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {library.saved.map((g) => {
            const active = current?.id === g.id;
            return (
              <span
                key={g.id}
                className={cx(
                  'group flex items-center rounded-lg border text-xs transition',
                  active
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-ink-100'
                    : 'border-fg/[0.08] bg-fg/[0.03] text-ink-300 hover:border-fg/20 hover:text-ink-100',
                )}
              >
                <button type="button" onClick={() => onApply(g.stops)} className="flex items-center gap-2 py-1 pr-1.5 pl-1">
                  <span className="h-5 w-8 rounded-md" style={{ background: gradientCss(g.stops, '90deg', 16) }} />
                  <span className="max-w-32 truncate">{g.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => library.onDelete(g.id)}
                  aria-label={`Delete gradient ${g.name}`}
                  title="Delete"
                  className="mr-1 rounded px-1 text-ink-400 opacity-0 transition hover:text-rose-600 group-hover:opacity-100 focus:opacity-100 dark:hover:text-rose-300"
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Dragging a handle this far (px) above/below the bar removes the colour on release. */
const REMOVE_DISTANCE = 48;
const MAX_POS = 0.999;
const clampPos = (p: number) => Math.min(MAX_POS, Math.max(0, p));

/**
 * Gradient bar with draggable colour handles (Synapse-style):
 * - drag a handle to move its colour; the gradient follows
 * - click the bar to add a colour there
 * - drag a handle away from the bar, or press Delete, to remove it
 * - arrow keys nudge the selected handle (Shift = 5 %)
 */
export interface GradientLibrary {
  saved: SavedGradient[];
  onSave: (name: string, stops: GradientStop[]) => void;
  onDelete: (id: string) => void;
  /** Replaces the library (import, after merging). */
  onReplaceAll: (gradients: SavedGradient[]) => void;
}

export function GradientEditor({
  stops,
  onChange,
  status,
  library,
}: {
  stops: GradientStop[];
  onChange: (stops: GradientStop[]) => void;
  status: CustomWaveStatus;
  library: GradientLibrary;
}) {
  const [selected, setSelected] = useState(0);
  const [removing, setRemoving] = useState<number | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number; moved: boolean } | null>(null);
  const sel = Math.min(selected, stops.length - 1);
  const current = stops[sel];
  const canAdd = stops.length < GRADIENT_MAX;
  const canRemove = stops.length > GRADIENT_MIN;

  const update = (i: number, patch: Partial<GradientStop>) =>
    onChange(stops.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const posFromEvent = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return clampPos((clientX - r.left) / r.width);
  };

  const add = (pos: number) => {
    if (!canAdd) return;
    onChange([...stops, { color: colorAt(stops, pos), pos }]);
    setSelected(stops.length);
  };

  const remove = (i: number) => {
    if (!canRemove) return;
    onChange(stops.filter((_, j) => j !== i));
    setSelected(Math.max(0, Math.min(i, stops.length - 2)));
  };

  // ── Handle dragging ──
  const onHandleDown = (e: ReactPointerEvent<HTMLButtonElement>, i: number) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    drag.current = { index: i, moved: false };
    setSelected(i);
  };

  const onHandleMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || !bar.current) return;
    d.moved = true;
    const r = bar.current.getBoundingClientRect();
    const away = e.clientY < r.top - REMOVE_DISTANCE || e.clientY > r.bottom + REMOVE_DISTANCE;
    setRemoving(away && canRemove ? d.index : null);
    if (!away) update(d.index, { pos: posFromEvent(e.clientX) });
  };

  const onHandleUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && removing === d.index) remove(d.index);
    setRemoving(null);
  };

  const onHandleKey = (e: ReactKeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') update(i, { pos: clampPos(stops[i]!.pos - step) });
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') update(i, { pos: clampPos(stops[i]!.pos + step) });
    else if (e.key === 'Delete' || e.key === 'Backspace') remove(i);
    else return;
    e.preventDefault();
  };

  return (
    <section className="space-y-5">
      <SectionTitle aside={<span className="text-xs text-ink-400">{stops.length}/{GRADIENT_MAX} colours</span>}>
        Gradient
      </SectionTitle>

      <div className="px-3">
        <div
          ref={bar}
          onPointerDown={(e) => {
            if (e.button === 0) add(posFromEvent(e.clientX));
          }}
          title={canAdd ? 'Click to add a colour here' : undefined}
          className={cx('relative h-11 rounded-xl ring-1 ring-fg/10 select-none touch-none', canAdd ? 'cursor-copy' : 'cursor-default')}
          style={{ background: gradientCss(stops) }}
        >
          {/* DOM order stays fixed during drags (re-ordering would drop pointer capture); z-index lifts the selection. */}
          {stops.map((s, i) => {
            const isSel = i === sel;
            const isRemoving = removing === i;
            return (
              <button
                key={i}
                type="button"
                aria-label={`Colour ${i + 1}, ${s.color}, at ${Math.round(s.pos * 100)}%`}
                aria-pressed={isSel}
                onPointerDown={(e) => onHandleDown(e, i)}
                onPointerMove={onHandleMove}
                onPointerUp={onHandleUp}
                onPointerCancel={onHandleUp}
                onKeyDown={(e) => onHandleKey(e, i)}
                onFocus={() => setSelected(i)}
                className={cx(
                  'absolute top-1/2 h-14 w-5 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-lg border-2 shadow-[0_4px_14px_rgba(0,0,0,0.45)] transition-[opacity,transform,width] outline-none active:cursor-grabbing',
                  isSel ? 'z-10 w-6 border-white' : 'border-white/70 hover:border-white',
                  'focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900',
                  isRemoving && 'scale-75 opacity-40',
                )}
                style={{ left: `${s.pos * 100}%`, backgroundColor: s.color }}
              />
            );
          })}
        </div>
      </div>

      <p className="text-xs text-ink-400">
        Drag the handles to move colours · click the bar to add one · drag a handle off the bar or press Delete to remove
        it. The right end flows into the left end, so the wave loops seamlessly.
      </p>

      {current && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-9 items-center gap-2 rounded-lg border border-fg/[0.08] bg-shade/25 px-3 focus-within:border-[var(--accent)]">
            <span className="text-xs text-ink-400">Position</span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={Math.round(current.pos * 100)}
              onChange={(e) => update(sel, { pos: clampPos(Number(e.target.value) / 100) })}
              className="w-12 bg-transparent text-right font-mono text-sm tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-xs text-ink-400">%</span>
          </label>
          <Button className="h-9 px-3 text-xs" onClick={() => add(clampPos(current.pos + 0.05))} disabled={!canAdd}>
            + Add colour
          </Button>
          <Button variant="danger" className="h-9 px-3 text-xs" onClick={() => remove(sel)} disabled={!canRemove}>
            Remove
          </Button>
          <span className="flex-1" />
          <Button
            variant="ghost"
            className="h-9 px-3 text-xs"
            title="Keep the colours, space them evenly"
            onClick={() => onChange(evenStops(sortStops(stops).map((s) => s.color)))}
          >
            Spread evenly
          </Button>
          <Button
            variant="ghost"
            className="h-9 px-3 text-xs"
            title="Mirror the gradient"
            onClick={() => onChange(stops.map((s) => ({ ...s, pos: clampPos(s.pos === 0 ? 0 : 1 - s.pos) })))}
          >
            Reverse
          </Button>
        </div>
      )}

      {current && <ColorPicker value={current.color} onChange={(color) => update(sel, { color })} />}

      <MyGradients
        library={library}
        stops={stops}
        onApply={(s) => {
          onChange(s.map((x) => ({ ...x })));
          setSelected(0);
        }}
      />

      <div>
        <span className="mb-2 block text-xs text-ink-400">Quick gradients</span>
        <div className="flex flex-wrap gap-2">
          {QUICK_GRADIENTS.map((g) => (
            <button
              key={g.name}
              onClick={() => {
                onChange(g.stops);
                setSelected(0);
              }}
              className="flex items-center gap-2 rounded-lg border border-fg/[0.08] bg-fg/[0.03] py-1 pr-2.5 pl-1 text-xs text-ink-300 transition hover:border-fg/20 hover:text-ink-100"
            >
              <span className="h-5 w-8 rounded-md" style={{ background: gradientCss(g.stops, '90deg', 16) }} />
              {g.name}
            </button>
          ))}
        </div>
      </div>

      <div
        className={cx(
          'rounded-xl border px-4 py-3 text-xs leading-relaxed',
          status.tone === 'ok' && 'border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-700 dark:text-emerald-200',
          status.tone === 'warn' && 'border-amber-500/25 bg-amber-500/[0.07] text-amber-800 dark:text-amber-100',
          status.tone === 'info' && 'border-fg/10 bg-fg/[0.03] text-ink-300',
        )}
      >
        {status.note}
        {status.action && (
          <Button className="mt-3 h-8 w-full text-xs" onClick={status.action.onClick}>
            {status.action.label}
          </Button>
        )}
      </div>
    </section>
  );
}
