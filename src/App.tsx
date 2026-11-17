import { useEffect, useRef, useState } from 'react';
import { DevicePanel } from './components/DevicePanel';
import { Header } from './components/Header';
import { frameToLeds, renderFrame } from './components/keyboard/effects';
import { KeyboardPreview } from './components/keyboard/KeyboardPreview';
import { KEYS } from './components/keyboard/layout';
import { LightingPanel } from './components/LightingPanel';
import { PresetsPanel } from './components/PresetsPanel';
import { Button, Tabs, cx } from './components/ui';
import { KeyboardController, keyboard } from './hid/KeyboardController';
import { usesSingleColor, type LightingState } from './hid/types';
import { hexToRgb, rgbToHsv } from './lib/color';
import { sortStops } from './lib/gradient';
import { useSettings, type TabId } from './state/settings';
import { useKeyboard } from './state/useKeyboard';

const TABS: { id: TabId; label: string }[] = [
  { id: 'lighting', label: 'Lighting' },
  { id: 'presets', label: 'Presets' },
  { id: 'device', label: 'Device' },
];

const FALLBACK_ACCENT = '#8b5cf6';
/** Target interval between live Custom wave frames (~25 fps; the keyboard may manage less). */
const FRAME_MS = 40;
/** Consecutive failed frames (with growing back-off, ~5 s in total) before streaming stops. */
const MAX_FRAME_FAILURES = 6;

export default function App() {
  const kb = useKeyboard();
  const { settings, update, setLighting, savePreset, deletePreset } = useSettings();
  const { lighting, liveSync, autoSave, tab, theme } = settings;
  const canSync = kb.status === 'connected' && kb.canControlLighting;

  // Re-open a previously authorised keyboard without prompting.
  useEffect(() => {
    void keyboard.autoReconnect();
  }, []);

  // Light / dark theme.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f4f4f8' : '#09090d');
  }, [theme]);

  // Theme accent follows the chosen colour (when the effect uses one and it's not too dark/light).
  const accentSource =
    lighting.effect === 'customWave' ? sortStops(lighting.gradient)[0]?.color : usesSingleColor(lighting) ? lighting.color : undefined;
  useEffect(() => {
    const rgb = accentSource ? hexToRgb(accentSource) : null;
    const hsv = rgb ? rgbToHsv(rgb) : null;
    // In light mode a near-white accent would vanish against the page.
    const usable = hsv && hsv.v > 0.35 && !(theme === 'light' && hsv.s < 0.15);
    const accent = usable ? accentSource! : FALLBACK_ACCENT;
    const a = hexToRgb(accent)!;
    const luminance = (0.2126 * a.r + 0.7152 * a.g + 0.0722 * a.b) / 255;
    const root = document.documentElement.style;
    root.setProperty('--accent', accent);
    root.setProperty('--accent-fg', luminance > 0.62 ? '#0b0b10' : '#ffffff');
  }, [accentSource, theme]);

  // Lighting as it was when the keyboard connected. Connecting alone must not overwrite
  // the keyboard's own lighting; only changes made afterwards are sent.
  const lightingAtConnect = useRef<LightingState | null>(null);
  useEffect(() => {
    lightingAtConnect.current = canSync ? lighting : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- capture only on (dis)connect
  }, [canSync]);

  // Live sync: stream changes to the keyboard (controller coalesces rapid updates).
  useEffect(() => {
    if (canSync && liveSync && lighting !== lightingAtConnect.current) void keyboard.applyLighting(lighting);
  }, [lighting, canSync, liveSync]);

  // Auto-save: commit to on-board memory once the user stops fiddling.
  useEffect(() => {
    if (!canSync || !liveSync || !autoSave || lighting === lightingAtConnect.current) return;
    const t = setTimeout(() => void keyboard.saveToDevice(), 2000);
    return () => clearTimeout(t);
  }, [lighting, canSync, liveSync, autoSave]);

  // Custom wave: render frames here and stream them to the keyboard while the page is open.
  const lightingRef = useRef(lighting);
  lightingRef.current = lighting;
  const canStream = canSync && !!kb.device?.canStream;
  const streamActive = canStream && liveSync && lighting.effect === 'customWave';
  const [stream, setStream] = useState<{ fps: number | null; error: string | null }>({ fps: null, error: null });

  useEffect(() => {
    if (!streamActive) return;
    let stopped = false;
    setStream({ fps: null, error: null });
    keyboard.note('Custom wave: live streaming started');
    void (async () => {
      let frames = 0;
      let windowStart = performance.now();
      let failures = 0;
      while (!stopped) {
        const start = performance.now();
        const leds = frameToLeds(KEYS, renderFrame(KEYS, lightingRef.current, start / 1000, []));
        try {
          await keyboard.sendLiveFrame(leds);
          failures = 0;
        } catch (e) {
          if (stopped) return;
          const msg = e instanceof Error ? e.message : String(e);
          // Brief hiccups (keyboard busy saving, USB glitch): back off and keep going.
          // Only give up after repeated failures over several seconds.
          failures++;
          if (failures === 1) keyboard.note(`Custom wave: frame failed, retrying (${msg})`, 'error');
          if (failures >= MAX_FRAME_FAILURES) {
            keyboard.note(`Custom wave stopped: ${msg}`, 'error');
            setStream({ fps: null, error: msg });
            return;
          }
          await new Promise((r) => setTimeout(r, 250 * failures));
          continue;
        }
        frames++;
        const now = performance.now();
        if (now - windowStart > 2000) {
          setStream({ fps: Math.round((frames * 1000) / (now - windowStart)), error: null });
          frames = 0;
          windowStart = now;
        }
        const wait = FRAME_MS - (now - start);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
    })();
    return () => {
      stopped = true;
      keyboard.note('Custom wave: live streaming stopped');
    };
  }, [streamActive]);

  // Save button: writes the full lighting to the keyboard and keeps it after the app closes.
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  useEffect(() => {
    if (saveState !== 'saved' && saveState !== 'failed') return;
    const t = setTimeout(() => setSaveState('idle'), 2500);
    return () => clearTimeout(t);
  }, [saveState]);

  const save = async () => {
    setSaveState('saving');
    let ok: boolean;
    if (lighting.effect === 'customWave' && kb.device?.canStorePerKey) {
      // The keyboard can't animate a custom gradient by itself: store a still frame.
      // Colours at full intensity; the keyboard applies the brightness level itself.
      const frame = renderFrame(KEYS, { ...lighting, brightness: 100 }, 0, []);
      ok = await keyboard.storePerKey(frameToLeds(KEYS, frame), lighting.brightness);
    } else {
      ok = await keyboard.saveLighting(lighting);
    }
    setSaveState(ok ? 'saved' : 'failed');
  };

  const isStillImageSave = lighting.effect === 'customWave' && !!kb.device?.canStorePerKey;

  const customWaveStatus =((): Parameters<typeof LightingPanel>[0]['customWave'] => {
    if (kb.status !== 'connected') return { tone: 'info', note: 'Preview only. Connect the keyboard to run this wave on it.' };
    if (!canStream) return { tone: 'warn', note: "This keyboard can't show app-rendered waves, so this is a preview only." };
    if (!liveSync) return { tone: 'info', note: 'Live sync is off (Device tab), so the wave only runs in the preview.' };
    if (stream.error) return { tone: 'warn', note: `Streaming stopped: ${stream.error}. Pick the effect again to retry.` };
    return {
      tone: 'ok',
      note:
        `Running live on your keyboard${stream.fps ? ` (~${stream.fps} fps)` : ''}. The keyboard can't animate a ` +
        "custom gradient by itself, so the wave only flows while this app is open. When you close it, the keyboard " +
        'shows its saved lighting.' +
        (kb.device?.canStorePerKey
          ? ' "Save still image" makes that a frozen snapshot of this gradient. For a wave that keeps moving without ' +
            'the app, use the Wave effect (rainbow or one colour) and save that.'
          : ''),
    };
  })();

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6 pb-16 sm:px-8 sm:pt-8">
      <Header kb={kb} theme={theme} onThemeChange={(t) => update({ theme: t })} />

      <Banners kb={kb} />

      <section className="mt-8 sm:mt-10">
        <div className="mx-auto max-w-5xl">
          <KeyboardPreview lighting={lighting} />
        </div>
        <p className="mt-10 text-center text-xs text-ink-400">
          {kb.status === 'connected'
            ? liveSync
              ? 'Changes are sent to your keyboard live.'
              : 'Live sync is off — preview only.'
            : 'Preview — type or click keys to try reactive effects.'}
        </p>
      </section>

      <main className="panel mt-6 p-5 sm:p-7">
        <div className="mb-7 flex flex-wrap items-center justify-between gap-3">
          <Tabs tabs={TABS} value={tab} onChange={(id) => update({ tab: id })} />
          {canSync && (
            <Button
              variant={saveState === 'saved' ? 'subtle' : 'primary'}
              onClick={() => void save()}
              disabled={saveState === 'saving'}
              title={
                isStillImageSave
                  ? 'The keyboard cannot animate a custom gradient by itself: this stores a frozen snapshot it shows when the app is closed. The wave keeps flowing while the app is open.'
                  : 'Writes the current lighting to the keyboard'
              }
              className={cx('min-w-32', saveState === 'failed' && 'text-rose-600 dark:text-rose-300')}
            >
              {saveState === 'saving' && 'Saving…'}
              {saveState === 'saved' && (
                <>
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-emerald-500">
                    <path d="m4.5 10.5 3.5 3.5 7.5-8" />
                  </svg>
                  Saved
                </>
              )}
              {saveState === 'failed' && 'Save failed'}
              {saveState === 'idle' && (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V3Z" />
                    <path d="M8 3v5h7V3M8 21v-7h8v7" />
                  </svg>
                  {isStillImageSave ? 'Save still image' : 'Save to keyboard'}
                </>
              )}
            </Button>
          )}
        </div>

        {tab === 'lighting' && (
          <LightingPanel lighting={lighting} onChange={setLighting} customWave={customWaveStatus} />
        )}
        {tab === 'presets' && (
          <PresetsPanel
            lighting={lighting}
            presets={settings.presets}
            onApply={(l) => setLighting(l)}
            onSave={savePreset}
            onDelete={deletePreset}
          />
        )}
        {tab === 'device' && (
          <DevicePanel
            kb={kb}
            liveSync={liveSync}
            autoSave={autoSave}
            onSettings={update}
            onReadLighting={setLighting}
          />
        )}
      </main>

      <footer className="mt-8 text-center text-xs text-ink-600">
        OpenGalaxy · open-source · not affiliated with Epomaker
      </footer>
    </div>
  );
}

function Banners({ kb }: { kb: ReturnType<typeof useKeyboard> }) {
  const items: { tone: 'warn' | 'error' | 'info'; text: string }[] = [];
  if (!KeyboardController.isWebHidSupported) {
    // Browsers only expose WebHID on secure origins (HTTPS or localhost).
    const insecure = typeof window !== 'undefined' && !window.isSecureContext;
    items.push({
      tone: insecure ? 'warn' : 'info',
      text: insecure
        ? `This page was opened over plain HTTP (${location.host}), and browsers only allow keyboard access over HTTPS or on localhost. Open it via https:// — demo mode still works.`
        : 'This browser has no WebHID. Use Chrome or Edge on desktop to control a real keyboard — demo mode still works.',
    });
  }
  if (kb.status === 'connected' && !kb.canControlLighting)
    items.push({
      tone: 'warn',
      text: `Connected in raw mode — lighting changes stay in the preview for now. ${kb.device?.protocolNote ?? ''}`.trim(),
    });
  if (kb.error) items.push({ tone: 'error', text: kb.error });
  if (!items.length) return null;

  return (
    <div className="mt-6 space-y-2">
      {items.map((b) => (
        <div
          key={b.text}
          className={cx(
            'rounded-xl border px-4 py-3 text-sm',
            b.tone === 'error' && 'border-rose-500/25 bg-rose-500/[0.07] text-rose-700 dark:text-rose-200',
            b.tone === 'warn' && 'border-amber-500/25 bg-amber-500/[0.07] text-amber-800 dark:text-amber-100',
            b.tone === 'info' && 'border-fg/10 bg-fg/[0.03] text-ink-300',
          )}
        >
          {b.text}
        </div>
      ))}
    </div>
  );
}
