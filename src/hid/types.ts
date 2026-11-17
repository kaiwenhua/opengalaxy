// Shared, protocol-agnostic types for the keyboard layer.

export type EffectId =
  | 'static'
  | 'breathing'
  | 'wave'
  | 'spectrum'
  | 'reactive'
  | 'ripple'
  | 'starlight'
  | 'customWave'
  | 'off';

export type Direction = 'right' | 'left' | 'down' | 'up';
export const DIRECTIONS: readonly Direction[] = ['right', 'left', 'down', 'up'];

export interface EffectDef {
  id: EffectId;
  label: string;
  hint: string;
  usesColor: boolean;
  usesSpeed: boolean;
}

export const EFFECTS: readonly EffectDef[] = [
  { id: 'static', label: 'Static', hint: 'One solid colour', usesColor: true, usesSpeed: false },
  { id: 'breathing', label: 'Breathing', hint: 'Slow pulse', usesColor: true, usesSpeed: true },
  { id: 'wave', label: 'Wave', hint: 'Rainbow or one colour', usesColor: false, usesSpeed: true },
  { id: 'customWave', label: 'Custom wave', hint: 'Your own gradient', usesColor: false, usesSpeed: true },
  { id: 'spectrum', label: 'Spectrum', hint: 'Whole-board cycle', usesColor: false, usesSpeed: true },
  { id: 'reactive', label: 'Reactive', hint: 'Lights on keypress', usesColor: true, usesSpeed: true },
  { id: 'ripple', label: 'Ripple', hint: 'Rings from keypress', usesColor: true, usesSpeed: true },
  { id: 'starlight', label: 'Starlight', hint: 'Random twinkles', usesColor: true, usesSpeed: true },
  { id: 'off', label: 'Off', hint: 'Backlight off', usesColor: false, usesSpeed: false },
];

export const effectDef = (id: EffectId): EffectDef =>
  EFFECTS.find((e) => e.id === id) ?? (EFFECTS[0] as EffectDef);

export interface LightingState {
  effect: EffectId;
  /** #rrggbb */
  color: string;
  /** 0–100 */
  brightness: number;
  /** 0–100 */
  speed: number;
  /** Travel direction for Wave and Custom wave. */
  direction: Direction;
  /** Wave: rainbow (true) or a single-colour wave in `color` (false). */
  rainbow: boolean;
  /** Custom wave colour stops (2–16), positioned along one loop of the wave. */
  gradient: GradientStop[];
  /** Custom wave: length of one gradient loop in % of the keyboard (50–400). Longer = softer transitions. */
  waveLength: number;
}

export const WAVE_LENGTH_MIN = 50;
export const WAVE_LENGTH_MAX = 400;

/** One colour in a Custom wave gradient. `pos` ∈ [0, 1); the gradient loops from the last stop back to the first. */
export interface GradientStop {
  color: string;
  pos: number;
}

export type LightingKey = keyof LightingState;

export const GRADIENT_MIN = 2;
export const GRADIENT_MAX = 16;

export const DEFAULT_LIGHTING: LightingState = {
  effect: 'wave',
  color: '#8b5cf6',
  brightness: 80,
  speed: 50,
  direction: 'right',
  rainbow: true,
  gradient: [
    { color: '#ff2d92', pos: 0 },
    { color: '#7c3aed', pos: 1 / 3 },
    { color: '#22d3ee', pos: 2 / 3 },
  ],
  waveLength: 100,
};

/** Whether the current state uses the single `color` (Wave only in single-colour mode). */
export const usesSingleColor = (s: LightingState) =>
  effectDef(s.effect).usesColor || (s.effect === 'wave' && !s.rainbow);

/** One LED in a per-key frame. `index` is the firmware's light index. */
export interface LedColor {
  index: number;
  r: number;
  g: number;
  b: number;
}

export interface ReportInfo {
  id: number;
  /** Payload bytes, excluding the report-ID byte. */
  size: number;
}

/** One top-level HID collection as parsed from the report descriptor. */
export interface CollectionInfo {
  usagePage: number;
  usage: number;
  input: ReportInfo[];
  output: ReportInfo[];
  feature: ReportInfo[];
}

export interface DeviceInfo {
  name: string;
  vendorId: number;
  productId: number;
  /** Human readable protocol name, or null if no protocol answered. */
  protocol: string | null;
  protocolVersion: number | null;
  /** Why no protocol is active (handshake error), for the UI. */
  protocolNote: string | null;
  reportSize: number;
  collections: CollectionInfo[];
  isMock: boolean;
  /** The keyboard stores applied settings itself (no explicit save needed). */
  persistsAutomatically: boolean;
  canReadBack: boolean;
  /** Real-time per-key frames are supported (needed for Custom wave on the keyboard). */
  canStream: boolean;
  /** A static per-key colour map can be stored on the keyboard. */
  canStorePerKey: boolean;
}

/** Low-level operation for the packet console. */
export type RawOp =
  | { kind: 'output'; reportId: number; data: Uint8Array; awaitInput: boolean }
  | { kind: 'feature-set'; reportId: number; data: Uint8Array }
  | { kind: 'feature-get'; reportId: number };

export type Tap = (direction: 'tx' | 'rx', data: Uint8Array) => void;

export interface RequestOptions {
  timeoutMs?: number;
  /** Return true for the input report that answers this request. Defaults to "first report". */
  match?: (report: Uint8Array) => boolean;
}

/**
 * Byte pipe to a keyboard. Implementations: real WebHID ({@link HidTransport})
 * and an in-memory emulator ({@link MockViaKeyboard}). Protocols only talk to this.
 */
export interface Transport {
  readonly name: string;
  readonly vendorId: number;
  readonly productId: number;
  readonly reportSize: number;
  readonly isMock: boolean;
  readonly collections: CollectionInfo[];
  tap: Tap | null;
  open(): Promise<void>;
  close(): Promise<void>;
  /** Fire-and-forget output report (zero-padded to reportSize). */
  write(payload: Uint8Array): Promise<void>;
  /** Output report followed by the matching input report. Requests are serialised. */
  request(payload: Uint8Array, opts?: RequestOptions): Promise<Uint8Array>;
  /** Arbitrary report access for the packet console. Resolves with the reply, if any. */
  raw(op: RawOp): Promise<Uint8Array | null>;
}

/** Encodes lighting state into a specific firmware's packet format. */
export interface LightingProtocol {
  readonly name: string;
  /** Settings are persisted by the keyboard on apply; `save()` is a no-op. */
  readonly persistsAutomatically?: boolean;
  /** False when the firmware has no command to read the current lighting. Defaults to true. */
  readonly canReadBack?: boolean;
  /** Probe the device. Must throw if the device does not speak this protocol. */
  handshake(): Promise<{ version: number | null }>;
  readLighting(): Promise<Partial<LightingState>>;
  /** Write only the fields listed in `changed` (all fields when the set is empty). */
  writeLighting(next: LightingState, changed: ReadonlySet<LightingKey>): Promise<void>;
  /** Persist current settings to the keyboard's EEPROM / flash. */
  save(): Promise<void>;
  /** Optional: show one real-time per-key frame (not saved; the keyboard reverts when frames stop). */
  sendLiveFrame?(leds: LedColor[]): Promise<void>;
  /** Optional: store a static per-key colour map on the keyboard. `brightness` is 0–100. */
  writePerKey?(leds: LedColor[], brightness: number): Promise<void>;
  /** Optional: put the keyboard into a mode where live frames are visible. */
  prepareLive?(state: LightingState): Promise<void>;
  /** Optional: the packets writePerKey would send, for replay by the desktop launcher. */
  planPerKey?(leds: LedColor[], brightness: number): Promise<PlanStep[]>;
}

/**
 * One step of a recorded packet sequence (64-byte feature reports, report ID 0).
 * 'get' reads the reply and waits until it echoes the previous 'set' (bytes 0–1).
 */
export interface PlanStep {
  op: 'set' | 'get';
  data?: number[];
  /** Pause after this step. */
  delayMs: number;
}

/** A packet sequence plus the HID interface it is meant for. */
export interface DevicePlan {
  vendorId: number;
  productId: number;
  usagePage: number;
  steps: PlanStep[];
}

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}
