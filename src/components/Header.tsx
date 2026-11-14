import { useState } from 'react';
import { KeyboardController, keyboard, type ControllerSnapshot } from '../hid/KeyboardController';
import type { Theme } from '../state/settings';
import { Button, cx } from './ui';

export function Header({
  kb,
  theme,
  onThemeChange,
}: {
  kb: ControllerSnapshot;
  theme: Theme;
  onThemeChange: (t: Theme) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const supported = KeyboardController.isWebHidSupported;
  const connected = kb.status === 'connected';

  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="relative grid h-10 w-10 place-items-center rounded-xl bg-ink-800 ring-1 ring-fg/10 shadow-[0_8px_24px_-10px_var(--accent)]">
          <div className="h-4 w-4 rounded-full border-[3px] border-[var(--accent)]" />
          <div className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-cyan-300" />
        </div>
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight">OpenGalaxy</h1>
          <p className="text-xs text-ink-400">Galaxy80 lighting studio</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <ThemeToggle theme={theme} onChange={onThemeChange} />
        <StatusPill kb={kb} />
        {connected ? (
          <Button variant="ghost" onClick={() => void keyboard.disconnect()}>
            Disconnect
          </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              className="px-3"
              onClick={() => void keyboard.connectMock()}
              disabled={kb.status === 'connecting'}
            >
              Demo<span className="hidden sm:inline"> mode</span>
            </Button>
            <div className="relative flex">
              <Button
                variant="primary"
                className="rounded-r-none pr-3"
                disabled={!supported || kb.status === 'connecting'}
                title={supported ? undefined : 'WebHID needs Chrome or Edge on desktop'}
                onClick={() => void keyboard.connect()}
              >
                <PlugIcon />
                {kb.status === 'connecting' ? (
                  'Connecting…'
                ) : (
                  <>
                    Connect<span className="hidden sm:inline"> keyboard</span>
                  </>
                )}
              </Button>
              <Button
                variant="primary"
                className="rounded-l-none border-l border-shade/20 px-2.5"
                disabled={!supported || kb.status === 'connecting'}
                aria-label="More connection options"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((o) => !o)}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </Button>
              {menuOpen && (
                <div className="absolute top-12 right-0 z-20 w-64 rounded-xl border border-fg/10 bg-ink-850 p-1.5 shadow-2xl">
                  <button
                    className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-fg/[0.06]"
                    onClick={() => {
                      setMenuOpen(false);
                      void keyboard.connect({ showAll: true });
                    }}
                  >
                    Show all HID devices
                    <span className="block text-xs text-ink-400">If your keyboard isn't listed by default</span>
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </header>
  );
}

function StatusPill({ kb }: { kb: ControllerSnapshot }) {
  const label =
    kb.status === 'connected'
      ? kb.device?.isMock
        ? 'Demo device'
        : kb.device?.name ?? 'Connected'
      : kb.status === 'connecting'
        ? 'Connecting'
        : 'Not connected';
  return (
    <div className="hidden h-10 items-center gap-2 rounded-xl border border-fg/[0.07] bg-fg/[0.03] px-3.5 text-sm sm:flex">
      <span className="relative flex h-2 w-2">
        {kb.status !== 'disconnected' && (
          <span
            className={cx(
              'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60',
              kb.status === 'connected' ? 'bg-emerald-400' : 'bg-amber-400',
            )}
          />
        )}
        <span
          className={cx(
            'relative inline-flex h-2 w-2 rounded-full',
            kb.status === 'connected' ? 'bg-emerald-400' : kb.status === 'connecting' ? 'bg-amber-400' : 'bg-ink-400',
          )}
        />
      </span>
      <span className="max-w-[14rem] truncate text-ink-300">{label}</span>
      {kb.syncing && <span className="text-xs text-ink-400">syncing…</span>}
    </div>
  );
}

function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (t: Theme) => void }) {
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={theme === 'light'}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => onChange(next)}
      className="relative grid h-10 w-10 place-items-center rounded-xl border border-fg/[0.08] bg-fg/[0.03] text-ink-300 transition hover:bg-fg/[0.07] hover:text-ink-100 focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
    >
      {theme === 'dark' ? (
        // Moon: currently dark
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      ) : (
        // Sun: currently light
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )}
    </button>
  );
}

function PlugIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v5" />
    </svg>
  );
}
