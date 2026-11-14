import { useEffect, useRef, useState } from 'react';
import { formatId } from '../hid/devices';
import { keyboard, type ControllerSnapshot } from '../hid/KeyboardController';
import type { LightingState, ReportInfo } from '../hid/types';
import { parseHexBytes } from '../lib/color';
import { Button, SectionTitle, Toggle, cx } from './ui';

export function DevicePanel({
  kb,
  liveSync,
  autoSave,
  onSettings,
  onReadLighting,
}: {
  kb: ControllerSnapshot;
  liveSync: boolean;
  autoSave: boolean;
  onSettings: (patch: { liveSync?: boolean; autoSave?: boolean }) => void;
  onReadLighting: (l: Partial<LightingState>) => void;
}) {
  const d = kb.device;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.3fr]">
      <div className="space-y-8">
        <section>
          <SectionTitle>Device</SectionTitle>
          <dl className="divide-y divide-fg/[0.05] rounded-xl border border-fg/[0.07] bg-shade/20 text-sm">
            <Row k="Name" v={d?.name ?? '—'} />
            <Row k="Vendor ID" v={d && !d.isMock ? formatId(d.vendorId) : '—'} mono />
            <Row k="Product ID" v={d && !d.isMock ? formatId(d.productId) : '—'} mono />
            <Row k="Protocol" v={d ? (d.protocol ?? 'Unknown (raw mode)') : '—'} />
            <Row k="Protocol version" v={d?.protocolVersion != null ? `0x${d.protocolVersion.toString(16).padStart(4, '0')}` : '—'} mono />
            <Row k="Report size" v={d ? `${d.reportSize} bytes` : '—'} mono />
          </dl>
          {d?.protocolNote && <p className="mt-2 text-xs text-amber-700 dark:text-amber-200/80">{d.protocolNote}</p>}
          <div className="mt-3 flex gap-2">
            <Button
              disabled={!kb.canControlLighting || !d?.canReadBack}
              title={d && !d.canReadBack ? 'This keyboard cannot report its current lighting' : undefined}
              onClick={async () => {
                const l = await keyboard.readLighting();
                if (l) onReadLighting(l);
              }}
            >
              Read from keyboard
            </Button>
            {!d?.persistsAutomatically && (
              <Button disabled={!kb.canControlLighting} onClick={() => void keyboard.saveToDevice()}>
                Save to keyboard
              </Button>
            )}
          </div>
          {d?.persistsAutomatically && (
            <p className="mt-2 text-xs text-ink-400">This keyboard stores lighting automatically when it is applied.</p>
          )}
        </section>

        {d && d.collections.length > 0 && (
          <section>
            <SectionTitle>HID collections</SectionTitle>
            <div className="overflow-x-auto rounded-xl border border-fg/[0.07] bg-shade/20">
              <table className="w-full font-mono text-xs">
                <thead className="text-ink-400">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium">Usage page</th>
                    <th className="px-3 py-2 font-medium">Usage</th>
                    <th className="px-3 py-2 font-medium">In</th>
                    <th className="px-3 py-2 font-medium">Out</th>
                    <th className="px-3 py-2 font-medium">Feature</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-fg/[0.05]">
                  {d.collections.map((c, i) => (
                    <tr key={i} className={c.usagePage >= 0xff00 ? 'text-ink-100' : 'text-ink-400'}>
                      <td className="px-3 py-2">{formatId(c.usagePage)}</td>
                      <td className="px-3 py-2">0x{c.usage.toString(16).padStart(2, '0')}</td>
                      <td className="px-3 py-2">{fmtReports(c.input)}</td>
                      <td className="px-3 py-2">{fmtReports(c.output)}</td>
                      <td className="px-3 py-2">{fmtReports(c.feature)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-ink-400">Format: report ID: size in bytes. Vendor pages (0xFF00+) are highlighted.</p>
          </section>
        )}

        <section>
          <SectionTitle>Sync</SectionTitle>
          <div className="space-y-3">
            <Toggle
              label="Live sync"
              hint="Send every change to the keyboard instantly"
              checked={liveSync}
              onChange={(v) => onSettings({ liveSync: v })}
            />
            {!d?.persistsAutomatically && (
              <Toggle
                label="Auto-save to keyboard"
                hint="Commit to on-board memory 2 s after the last change"
                checked={autoSave}
                onChange={(v) => onSettings({ autoSave: v })}
              />
            )}
          </div>
        </section>
      </div>

      <RawConsole kb={kb} />
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <dt className="text-ink-400">{k}</dt>
      <dd className={cx('text-right text-ink-100', mono && 'font-mono')}>{v}</dd>
    </div>
  );
}

const fmtReports = (r: ReportInfo[]) => (r.length ? r.map((x) => `${x.id}:${x.size}`).join(' ') : '–');

type ConsoleMode = 'output-wait' | 'output' | 'feature-set' | 'feature-get';

const MODES: { id: ConsoleMode; label: string }[] = [
  { id: 'output-wait', label: 'Output → wait for input' },
  { id: 'output', label: 'Output only' },
  { id: 'feature-set', label: 'Set feature report' },
  { id: 'feature-get', label: 'Get feature report' },
];

function RawConsole({ kb }: { kb: ControllerSnapshot }) {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<ConsoleMode>('output-wait');
  const [reportIdText, setReportIdText] = useState('0');
  const [err, setErr] = useState<string | null>(null);
  const logBox = useRef<HTMLDivElement>(null);
  const connected = kb.status === 'connected';

  // Keep the newest entry visible without scrolling the page itself.
  useEffect(() => {
    const el = logBox.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [kb.logs.length]);

  const send = async () => {
    setErr(null);
    try {
      const reportId = parseInt(reportIdText.replace(/^0x/i, ''), 16);
      if (!Number.isInteger(reportId) || reportId < 0 || reportId > 255) throw new Error('Report ID must be a hex byte (00–FF)');
      if (mode === 'feature-get') {
        await keyboard.sendRaw({ kind: 'feature-get', reportId });
        return;
      }
      const data = parseHexBytes(input);
      if (!data.length) throw new Error('Enter at least one byte');
      await keyboard.sendRaw(
        mode === 'feature-set'
          ? { kind: 'feature-set', reportId, data }
          : { kind: 'output', reportId, data, awaitInput: mode === 'output-wait' },
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="flex min-h-0 flex-col">
      <SectionTitle
        aside={
          <button onClick={() => keyboard.clearLogs()} className="text-xs text-ink-400 hover:text-ink-100">
            Clear
          </button>
        }
      >
        Packet log
      </SectionTitle>
      <div ref={logBox} className="h-72 overflow-auto rounded-xl border border-fg/[0.07] bg-shade/40 p-3 font-mono text-[11.5px] leading-relaxed">
        {kb.logs.length === 0 && <div className="text-ink-400">No traffic yet.</div>}
        {kb.logs.map((l) => (
          <div key={l.id} className="flex gap-3 whitespace-pre-wrap">
            <span className="shrink-0 text-ink-600">{new Date(l.time).toLocaleTimeString([], { hour12: false })}</span>
            <span
              className={cx(
                'w-6 shrink-0 font-semibold',
                l.kind === 'tx' && 'text-sky-400',
                l.kind === 'rx' && 'text-emerald-400',
                l.kind === 'info' && 'text-ink-400',
                l.kind === 'error' && 'text-rose-400',
              )}
            >
              {l.kind === 'tx' ? '→' : l.kind === 'rx' ? '←' : l.kind === 'error' ? '!' : '·'}
            </span>
            <span className={cx('break-all', l.kind === 'error' ? 'text-rose-600 dark:text-rose-300' : 'text-ink-300')}>{l.text}</span>
          </div>
        ))}
      </div>
      <form
        className="mt-3 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className="flex gap-2">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as ConsoleMode)}
            disabled={!connected}
            aria-label="Report type"
            className="h-10 min-w-0 flex-1 rounded-xl border border-fg/[0.07] bg-ink-850 px-3 text-sm outline-none focus:border-[var(--accent)] disabled:opacity-40"
          >
            {MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <label className="flex h-10 items-center gap-2 rounded-xl border border-fg/[0.07] bg-shade/25 px-3 focus-within:border-[var(--accent)]">
            <span className="text-xs text-ink-400">ID 0x</span>
            <input
              value={reportIdText}
              onChange={(e) => setReportIdText(e.target.value)}
              disabled={!connected}
              aria-label="Report ID (hex)"
              spellCheck={false}
              className="w-8 bg-transparent font-mono text-sm outline-none disabled:opacity-40"
            />
          </label>
        </div>
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={mode === 'feature-get' ? 'No payload needed' : 'Payload bytes (hex), e.g. 01 02 ff'}
            spellCheck={false}
            disabled={!connected || mode === 'feature-get'}
            className="h-10 min-w-0 flex-1 rounded-xl border border-fg/[0.07] bg-shade/25 px-3.5 font-mono text-sm outline-none placeholder:text-ink-400 focus:border-[var(--accent)] disabled:opacity-40"
          />
          <Button type="submit" disabled={!connected}>
            Send
          </Button>
        </div>
      </form>
      <p className={cx('mt-2 text-xs', err ? 'text-rose-600 dark:text-rose-300' : 'text-ink-400')}>
        {err ??
          'Payloads are zero-padded to the size the descriptor declares for that report. Only send packets you have seen the official software send.'}
      </p>
    </section>
  );
}
