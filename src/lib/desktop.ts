/**
 * Integration with the portable desktop launcher (desktop/ in the repo).
 *
 * When the app is served by OpenGalaxy.exe, the page tells the launcher it's still open
 * (heartbeat) and when it closes (goodbye beacon), so the launcher can exit once the
 * window is gone. It can also hand the launcher an "exit plan": HID packets the launcher
 * sends after the window has closed (used to store a Custom wave still image).
 * On any other host the ping fails and nothing else happens.
 */
import { useSyncExternalStore } from 'react';
import { BOARD_H, BOARD_W, KEYS, LIGHT_INDEX } from '../components/keyboard/layout';
import type { DevicePlan, LightingState } from '../hid/types';

const PING = '/__opengalaxy/ping';
const HEARTBEAT = '/__opengalaxy/heartbeat';
const BYE = '/__opengalaxy/bye';
const ON_EXIT = '/__opengalaxy/on-exit';
const BACKGROUND = '/__opengalaxy/background';
const INTERVAL_MS = 5000;

let present = false;
const listeners = new Set<() => void>();

/** True when running inside OpenGalaxy.exe (React hook). */
export function useDesktopLauncher(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => present,
  );
}

export async function connectToDesktopLauncher(): Promise<boolean> {
  if (location.hostname !== '127.0.0.1') return false;
  try {
    const res = await fetch(PING, { cache: 'no-store' });
    if (!res.ok || !res.headers.get('X-OpenGalaxy')) return false;
  } catch {
    return false;
  }
  present = true;
  listeners.forEach((fn) => fn());

  const beat = () => {
    void fetch(HEARTBEAT, { method: 'POST', keepalive: true }).catch(() => undefined);
  };
  beat();
  setInterval(beat, INTERVAL_MS);
  // Coming back from a minimised (throttled) state: report in right away.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') beat();
  });
  window.addEventListener('pagehide', () => {
    navigator.sendBeacon(BYE);
  });
  return true;
}

/**
 * Everything the launcher needs to keep rendering the Custom wave by itself once the window
 * is closed (desktop/render.go mirrors renderFrame's Custom wave branch).
 */
export interface BackgroundWaveSpec {
  vendorId: number;
  productId: number;
  usagePage: number;
  frameMs: number;
  /** Date.now() − performance.now() in seconds, so the launcher continues the same phase. */
  clockOffset: number;
  boardW: number;
  boardH: number;
  keys: { index: number; x: number; y: number; w: number }[];
  lighting: Pick<LightingState, 'gradient' | 'direction' | 'waveLength' | 'speed' | 'brightness'>;
}

export function backgroundWaveSpec(plan: DevicePlan, l: LightingState): BackgroundWaveSpec {
  return {
    vendorId: plan.vendorId,
    productId: plan.productId,
    usagePage: plan.usagePage,
    frameMs: 40,
    clockOffset: (Date.now() - performance.now()) / 1000,
    boardW: BOARD_W,
    boardH: BOARD_H,
    keys: KEYS.flatMap((k) => {
      const index = LIGHT_INDEX[k.code];
      return index === undefined ? [] : [{ index, x: k.x, y: k.y, w: k.w }];
    }),
    lighting: {
      gradient: l.gradient,
      direction: l.direction,
      waveLength: l.waveLength,
      speed: l.speed,
      brightness: l.brightness,
    },
  };
}

/** Sets (or clears, with null) the Custom wave the launcher keeps running after the window closes. */
export async function setBackgroundWave(spec: BackgroundWaveSpec | null): Promise<void> {
  if (!present) return;
  await fetch(BACKGROUND, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(spec ?? {}),
  }).catch(() => undefined);
}

/** Sets (or clears, with null) the packets the launcher sends to the keyboard on exit. */
export async function setExitPlan(plan: DevicePlan | null): Promise<void> {
  if (!present) return;
  await fetch(ON_EXIT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(plan ?? { steps: [] }),
  }).catch(() => undefined);
}
