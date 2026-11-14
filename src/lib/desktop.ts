/**
 * Integration with the portable desktop launcher (desktop/ in the repo).
 *
 * When the app is served by OpenGalaxy.exe, the page tells the launcher it's still open
 * (heartbeat) and when it closes (goodbye beacon), so the launcher can exit once the
 * window is gone. On any other host the ping fails and nothing else happens.
 */
const PING = '/__opengalaxy/ping';
const HEARTBEAT = '/__opengalaxy/heartbeat';
const BYE = '/__opengalaxy/bye';
const INTERVAL_MS = 5000;

export async function connectToDesktopLauncher(): Promise<boolean> {
  if (location.hostname !== '127.0.0.1') return false;
  try {
    const res = await fetch(PING, { cache: 'no-store' });
    if (!res.ok || !res.headers.get('X-OpenGalaxy')) return false;
  } catch {
    return false;
  }

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
