import { bytesToHex } from '../lib/color';
import { GENERIC_VIA, PROFILES, pickInterface, profileFor } from './devices';
import { HidTransport } from './HidTransport';
import { MockViaKeyboard } from './MockViaKeyboard';
import type {
  DeviceInfo,
  DevicePlan,
  LedColor,
  LightingKey,
  LightingProtocol,
  LightingState,
  RawOp,
  Transport,
} from './types';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export interface LogEntry {
  id: number;
  time: number;
  kind: 'tx' | 'rx' | 'info' | 'error';
  text: string;
}

export interface ControllerSnapshot {
  status: ConnectionStatus;
  device: DeviceInfo | null;
  /** True when connected and a lighting protocol answered the handshake. */
  canControlLighting: boolean;
  error: string | null;
  syncing: boolean;
  logs: readonly LogEntry[];
}

const MAX_LOGS = 250;
const LIGHTING_KEYS: LightingKey[] = ['effect', 'color', 'brightness', 'speed', 'direction', 'rainbow', 'gradient', 'waveLength'];

const sameValue = (a: unknown, b: unknown) =>
  typeof a === 'object' && typeof b === 'object' ? JSON.stringify(a) === JSON.stringify(b) : a === b;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * High-level keyboard API used by the UI. Owns the transport + protocol pair,
 * exposes an immutable snapshot for React (useSyncExternalStore), coalesces rapid
 * lighting changes (slider drags) into the minimum set of HID writes, and keeps a
 * packet log for debugging / reverse-engineering.
 */
export class KeyboardController {
  private transport: Transport | null = null;
  private protocol: LightingProtocol | null = null;
  private listeners = new Set<() => void>();
  private logSeq = 0;
  private autoReconnectTried = false;
  /** Serialises multi-packet protocol sequences so they never interleave. */
  private lock: Promise<unknown> = Promise.resolve();
  /** Suppresses per-packet logging (live frames). */
  private quiet = false;

  private pending: LightingState | null = null;
  private lastSent: LightingState | null = null;
  private flushing: Promise<void> | null = null;

  private snapshot: ControllerSnapshot = {
    status: 'disconnected',
    device: null,
    canControlLighting: false,
    error: null,
    syncing: false,
    logs: [],
  };

  constructor() {
    if (KeyboardController.isWebHidSupported) {
      navigator.hid.addEventListener('disconnect', (e) => {
        if (this.transport instanceof HidTransport && this.transport.device === e.device) {
          this.log('error', 'Keyboard was unplugged');
          void this.teardown('Keyboard disconnected');
        }
      });
    }
  }

  static get isWebHidSupported(): boolean {
    return typeof navigator !== 'undefined' && 'hid' in navigator;
  }

  // ── React store plumbing ────────────────────────────────────────────────────

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.snapshot;

  private set(patch: Partial<ControllerSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  private log(kind: LogEntry['kind'], text: string) {
    const entry: LogEntry = { id: ++this.logSeq, time: Date.now(), kind, text };
    const logs = [...this.snapshot.logs, entry];
    this.set({ logs: logs.length > MAX_LOGS ? logs.slice(-MAX_LOGS) : logs });
  }

  clearLogs() {
    this.set({ logs: [] });
  }

  /** Adds an informational line to the packet log. */
  note(text: string, kind: 'info' | 'error' = 'info') {
    this.log(kind, text);
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.lock.then(task, task);
    this.lock = run.catch(() => undefined);
    return run;
  }

  // ── Connection lifecycle ───────────────────────────────────────────────────

  /** Opens the browser device picker. `showAll` drops the filters (useful for unknown firmware). */
  async connect({ showAll = false } = {}) {
    if (!KeyboardController.isWebHidSupported) {
      this.set({ error: 'WebHID is not available. Use Chrome or Edge on desktop.' });
      return;
    }
    let devices: HIDDevice[];
    try {
      devices = await navigator.hid.requestDevice({
        filters: showAll ? [] : PROFILES.flatMap((p) => p.filters),
      });
    } catch (e) {
      this.set({ error: errorText(e) });
      return;
    }
    const device = pickInterface(devices);
    if (!device) return; // user cancelled the picker
    await this.attach(new HidTransport(device));
  }

  /** Silently reconnects to a keyboard the user already granted access to. */
  async autoReconnect(): Promise<boolean> {
    if (!KeyboardController.isWebHidSupported || this.snapshot.status !== 'disconnected') return false;
    if (this.autoReconnectTried) return false; // once per page load (StrictMode double-mounts)
    this.autoReconnectTried = true;
    const granted = await navigator.hid.getDevices();
    const device = granted.find((d) => profileFor(d));
    if (!device) return false;
    await this.attach(new HidTransport(device));
    return this.getSnapshot().status === 'connected';
  }

  async connectMock() {
    await this.attach(new MockViaKeyboard());
  }

  async disconnect() {
    await this.teardown(null);
    this.log('info', 'Disconnected');
  }

  private async attach(transport: Transport) {
    await this.teardown(null);
    this.set({ status: 'connecting', error: null });
    this.log('info', `Opening ${transport.name}…`);

    transport.tap = (dir, data) => {
      if (!this.quiet) this.log(dir, bytesToHex(data, true));
    };
    try {
      await transport.open();
    } catch (e) {
      this.set({ status: 'disconnected', error: `Could not open device: ${errorText(e)}` });
      this.log('error', errorText(e));
      return;
    }
    this.transport = transport;

    // Probe for a lighting protocol. A board that doesn't answer stays connected
    // in "raw" mode so the packet console can still be used to explore it.
    // Unrecognised devices are never probed: we don't send guessed commands to them.
    const profile = transport instanceof HidTransport ? profileFor(transport.device) : GENERIC_VIA;
    let version: number | null = null;
    let protocolNote: string | null = null;
    if (profile) {
      this.log('info', `Matched profile: ${profile.name}`);
      const candidate = profile.createProtocol(transport);
      try {
        ({ version } = await candidate.handshake());
        this.protocol = candidate;
        this.log('info', `${candidate.name} ready${version != null ? ` (protocol v${version})` : ''}`);
      } catch (e) {
        protocolNote = errorText(e);
        this.log('error', protocolNote);
      }
    } else {
      protocolNote = 'This device does not match any known profile, so no commands were sent to it.';
      this.log('info', protocolNote);
    }

    this.lastSent = null;
    this.set({
      status: 'connected',
      canControlLighting: this.protocol !== null,
      device: {
        name: transport.name,
        vendorId: transport.vendorId,
        productId: transport.productId,
        protocol: this.protocol?.name ?? null,
        protocolVersion: version,
        protocolNote,
        reportSize: transport.reportSize,
        collections: transport.collections,
        persistsAutomatically: this.protocol?.persistsAutomatically ?? false,
        canReadBack: this.protocol ? this.protocol.canReadBack !== false : false,
        canStream: typeof this.protocol?.sendLiveFrame === 'function',
        canStorePerKey: typeof this.protocol?.writePerKey === 'function',
        isMock: transport.isMock,
      },
    });
  }

  private async teardown(error: string | null) {
    const t = this.transport;
    this.transport = null;
    this.protocol = null;
    this.pending = null;
    this.lastSent = null;
    if (t) {
      t.tap = null;
      await t.close().catch(() => undefined);
    }
    this.set({ status: 'disconnected', device: null, canControlLighting: false, syncing: false, error });
  }

  // ── Lighting ────────────────────────────────────────────────────────────────

  /**
   * Queue a lighting state. Calls made while a write is in flight replace each
   * other, so dragging a slider sends the latest value instead of a backlog.
   */
  applyLighting(state: LightingState): Promise<void> {
    if (!this.protocol) return Promise.resolve();
    this.pending = state;
    this.flushing ??= this.flush().finally(() => {
      this.flushing = null;
      // A state may have been queued after the loop's last check.
      if (this.pending) void this.applyLighting(this.pending);
    });
    return this.flushing;
  }

  private async flush() {
    this.set({ syncing: true });
    try {
      while (this.pending && this.protocol) {
        const next = this.pending;
        this.pending = null;
        const prev = this.lastSent;
        const changed = new Set(prev ? LIGHTING_KEYS.filter((k) => !sameValue(prev[k], next[k])) : []);
        if (prev && changed.size === 0) continue;
        const protocol = this.protocol;
        await this.exclusive(() => protocol.writeLighting(next, changed));
        this.lastSent = next;
      }
      if (this.snapshot.error) this.set({ error: null });
    } catch (e) {
      this.log('error', `Lighting write failed: ${errorText(e)}`);
      this.set({ error: errorText(e) });
    } finally {
      this.set({ syncing: false });
    }
  }

  async readLighting(): Promise<Partial<LightingState> | null> {
    const protocol = this.protocol;
    if (!protocol) return null;
    try {
      const state = await this.exclusive(() => protocol.readLighting());
      this.log('info', `Read lighting: ${JSON.stringify(state)}`);
      return state;
    } catch (e) {
      this.log('error', `Read failed: ${errorText(e)}`);
      return null;
    }
  }

  /**
   * Explicit "Save" button: writes the complete lighting state (not just changes)
   * and commits it to keyboard memory. Resolves true on success.
   */
  async saveLighting(state: LightingState): Promise<boolean> {
    const protocol = this.protocol;
    if (!protocol) return false;
    await this.flushing;
    this.lastSent = null; // force a full write
    await this.applyLighting(state);
    if (this.snapshot.error) return false;
    if (!protocol.persistsAutomatically) {
      try {
        await this.exclusive(() => protocol.save());
      } catch (e) {
        this.log('error', `Save failed: ${errorText(e)}`);
        this.set({ error: errorText(e) });
        return false;
      }
    }
    this.log('info', 'Lighting saved to keyboard');
    return true;
  }

  /** Commit current lighting to the keyboard's persistent memory. */
  async saveToDevice(): Promise<boolean> {
    const protocol = this.protocol;
    if (!protocol) return false;
    if (protocol.persistsAutomatically) return true; // stored on apply
    try {
      await this.flushing;
      await this.exclusive(() => protocol.save());
      this.log('info', 'Saved to keyboard memory');
      return true;
    } catch (e) {
      this.log('error', `Save failed: ${errorText(e)}`);
      return false;
    }
  }

  /**
   * Shows one real-time per-key frame (Custom wave). Not saved: the keyboard returns
   * to its stored effect when frames stop. Throws on failure so the caller can stop.
   */
  async sendLiveFrame(leds: LedColor[]): Promise<void> {
    const protocol = this.protocol;
    if (!protocol?.sendLiveFrame) throw new Error('This keyboard does not support live frames');
    await this.exclusive(async () => {
      this.quiet = true;
      try {
        await protocol.sendLiveFrame!(leds);
      } finally {
        this.quiet = false;
      }
    });
  }

  /** Puts the keyboard into a mode where live frames are visible (before streaming). */
  async prepareLive(state: LightingState): Promise<void> {
    const protocol = this.protocol;
    if (!protocol?.prepareLive) return;
    await this.flushing;
    await this.exclusive(() => protocol.prepareLive!(state));
    this.lastSent = null; // the firmware effect changed behind the coalescer's back
  }

  /**
   * The packets that would store `leds` as a still image, plus the HID interface they
   * belong to. Nothing is sent. Used by the desktop launcher on close.
   */
  async stillImagePlan(leds: LedColor[], brightness: number): Promise<DevicePlan | null> {
    const protocol = this.protocol;
    const t = this.transport;
    if (!protocol?.planPerKey || !t || t.isMock) return null;
    const usagePage = t.collections.find((c) => c.usagePage >= 0xff00 && c.feature.length > 0)?.usagePage;
    if (usagePage === undefined) return null;
    return { vendorId: t.vendorId, productId: t.productId, usagePage, steps: await protocol.planPerKey(leds, brightness) };
  }

  /** Stores a static per-key colour map on the keyboard. */
  async storePerKey(leds: LedColor[], brightness: number): Promise<boolean> {
    const protocol = this.protocol;
    if (!protocol?.writePerKey) return false;
    try {
      await this.flushing;
      await this.exclusive(() => protocol.writePerKey!(leds, brightness));
      this.log('info', `Stored ${leds.length} key colours on the keyboard`);
      return true;
    } catch (e) {
      this.log('error', `Storing key colours failed: ${errorText(e)}`);
      this.set({ error: errorText(e) });
      return false;
    }
  }

  // ── Raw access (reverse-engineering / debugging) ───────────────────────────

  async sendRaw(op: RawOp): Promise<Uint8Array | null> {
    const t = this.transport;
    if (!t) throw new Error('Not connected');
    const res = await this.exclusive(() => t.raw(op));
    if (op.kind === 'output' && !op.awaitInput) this.log('info', 'Sent (not waiting for a reply)');
    return res;
  }
}

/** App-wide singleton. */
export const keyboard = new KeyboardController();
