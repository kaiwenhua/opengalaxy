import { hexToRgb } from '../../lib/color';
import {
  ProtocolError,
  type EffectId,
  type LedColor,
  type LightingProtocol,
  type LightingState,
  type Transport,
} from '../types';

/**
 * Galaxy80 lighting protocol: the "MUI / rgb-keyboard" OEM driver family
 * (VTER Driver, AJAZZ AK820 Pro, Aula/Epomaker F108 Pro).
 *
 * ⚠ EXPERIMENTAL. Built from public reverse-engineering of sibling keyboards that
 * use the same Windows driver, and from the Galaxy80 driver's own config files:
 *   - parsiya/f108-pro   ai-docs/hid-protocol.md  (Ghidra of the same driver)
 *   - hcristosm/ak820-linux  docs/PROTOCOL.md
 * Not yet confirmed with a capture from the Galaxy80 itself.
 *
 * Transport: 64-byte HID feature reports, no report ID, on the usage-page 0xFF13
 * interface. ~35 ms between packets (`cmd_delaytime` in the driver's layout XML).
 *
 * Effect sequence:
 *   SET 04 18                     begin        → GET readback, expect 04 18 .. 01
 *   SET 04 13 00 00 00 00 00 00 01 lighting header (1 data packet follows) → GET readback
 *   SET <data>                    mode, R, G, B, …, rainbow, brightness, speed, direction, …, AA 55
 *   SET 04 02                     apply        → GET readback
 *   SET 04 F0                     finalize
 *
 * The keyboard is write-only (no command returns the current lighting) and keeps
 * applied settings itself, so there is no separate save step.
 */

/** Firmware effect IDs, from the driver's language file (521 Static … 540 LED Off). */
export const GALAXY80_MODES = {
  off: 0,
  static: 1,
  singleOn: 2,
  singleOff: 3,
  glittering: 4,
  falling: 5,
  colourful: 6,
  breath: 7,
  spectrum: 8,
  outward: 9,
  scrolling: 10,
  rolling: 11,
  rotating: 12,
  explode: 13,
  launch: 14,
  ripples: 15,
  flowing: 16,
  pulsating: 17,
  tilt: 18,
  shuttle: 19,
} as const;

interface FirmwareEffect {
  mode: number;
  rainbow: boolean;
  direction: number;
}

/**
 * Closest firmware effect for each app effect, or null when the effect isn't a
 * firmware effect (Custom wave is rendered by the app and streamed as live frames).
 *
 * Wave direction is EXPERIMENTAL: the AK820 project documents direction 0 = left→right
 * or downwards and 1 = right→left or upwards. We assume Rolling is the horizontal
 * wave (it's the factory default) and Scrolling the vertical one.
 */
function firmwareEffect(s: LightingState): FirmwareEffect | null {
  const m = GALAXY80_MODES;
  const simple = (mode: number, rainbow = false): FirmwareEffect => ({ mode, rainbow, direction: 0 });
  const map: Record<EffectId, FirmwareEffect | null> = {
    off: simple(m.off),
    static: simple(m.static),
    breathing: simple(m.breath),
    wave: {
      mode: s.direction === 'down' || s.direction === 'up' ? m.scrolling : m.rolling,
      rainbow: s.rainbow,
      direction: s.direction === 'left' || s.direction === 'up' ? 1 : 0,
    },
    spectrum: simple(m.spectrum, true),
    reactive: simple(m.singleOn),
    ripple: simple(m.ripples),
    starlight: simple(m.glittering),
    customWave: null,
  };
  return map[s.effect];
}

const CMD = {
  BEGIN: 0x18,
  LIGHTING: 0x13,
  PER_KEY: 0x23,
  LIVE: 0x20,
  APPLY: 0x02,
  FINALIZE: 0xf0,
} as const;

/** Custom per-key lighting mode, set before uploading a per-key colour map. */
const MODE_PER_KEY = 0x80;

export const PACKET_DELAY_MS = 35;
/** Live frames use the vendor's music-mode timing. */
const LIVE_HEADER_DELAY_MS = 5;
const LIVE_DATA_DELAY_MS = 2;
/** Readback polling while the keyboard is busy: up to ~0.4 s before reporting a missing ACK. */
const ACK_ATTEMPTS = 20;
const ACK_RETRY_MS = 20;
/** Pause after a stored session (flash write) before sending anything else. */
const FLASH_SETTLE_MS = 300;
const LEVEL_MAX = 5;

const toLevel = (pct: number) => Math.round((Math.min(100, Math.max(0, pct)) / 100) * LEVEL_MAX);

/** Builds the 16 meaningful bytes of the lighting data packet (zero-padded to 64 on send). */
export function buildLightingPacket(state: LightingState): Uint8Array | null {
  const fx = firmwareEffect(state);
  if (!fx) return null;
  const p = new Uint8Array(16);
  p[0] = fx.mode;
  if (fx.mode !== GALAXY80_MODES.off) {
    const { r, g, b } = hexToRgb(state.color) ?? { r: 255, g: 255, b: 255 };
    p[1] = r;
    p[2] = g;
    p[3] = b;
    p[8] = fx.rainbow ? 1 : 0;
    p[9] = toLevel(state.brightness);
    p[10] = toLevel(state.speed);
    p[11] = fx.direction;
  }
  p[14] = 0xaa;
  p[15] = 0x55;
  return p;
}

/** Header packet `04 <cmd>` with the number of following data packets in bytes 8–9 (LE). */
export function header(cmd: number, dataPackets = 0): Uint8Array {
  const p = new Uint8Array(10);
  p[0] = 0x04;
  p[1] = cmd;
  p[8] = dataPackets & 0xff;
  p[9] = dataPackets >> 8;
  return p;
}

/** Live frame: up to 128 consecutive (index, R, G, B) entries in 512 bytes (8 packets). */
export function buildLivePayload(leds: LedColor[]): Uint8Array {
  const data = new Uint8Array(512);
  [...leds]
    .sort((a, b) => a.index - b.index)
    .slice(0, 128)
    .forEach((l, i) => data.set([l.index, l.r, l.g, l.b], i * 4));
  return data;
}

/** Per-key map: entry for light index i lives at byte i·4 as (i, R, G, B); 576 bytes, AA 55 at the end. */
export function buildPerKeyPayload(leds: LedColor[]): Uint8Array {
  const data = new Uint8Array(0x240);
  for (const l of leds) {
    if (l.index < 0 || l.index >= 143) continue; // the last slot holds the AA 55 trailer
    data.set([l.index, l.r, l.g, l.b], l.index * 4);
  }
  data[0x23e] = 0xaa;
  data[0x23f] = 0x55;
  return data;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class SonixGalaxyProtocol implements LightingProtocol {
  readonly name = 'Galaxy80 (SONIX, experimental)';
  readonly persistsAutomatically = true;
  readonly canReadBack = false;

  constructor(private readonly transport: Transport) {}

  /**
   * Passive check only: confirms the interface has 64-byte feature reports. We don't
   * open a session here, because a begin without a matching apply has unknown effects.
   */
  async handshake() {
    const feature = this.transport.collections
      .filter((c) => c.usagePage === 0xff13)
      .flatMap((c) => c.feature)
      .find((r) => r.id === 0);
    if (!feature || feature.size < 16) {
      throw new ProtocolError('Interface 0xFF13 has no 64-byte feature report — wrong interface selected?');
    }
    return { version: null };
  }

  async readLighting(): Promise<Partial<LightingState>> {
    throw new ProtocolError('The Galaxy80 firmware has no command to read lighting back');
  }

  async writeLighting(next: LightingState) {
    const packet = buildLightingPacket(next);
    if (!packet) return; // app-rendered effect (Custom wave): nothing to store in firmware
    await this.session(CMD.LIGHTING, packet);
  }

  async save() {
    // Applied settings are stored by the keyboard; nothing to do.
  }

  /** One real-time frame, as the vendor's music page sends it: no session, not saved to flash. */
  async sendLiveFrame(leds: LedColor[]) {
    const data = buildLivePayload(leds);
    await this.headerWithAck(header(CMD.LIVE, data.length / 64), LIVE_HEADER_DELAY_MS);
    await this.sendChunks(data, LIVE_DATA_DELAY_MS);
    await this.headerWithAck(header(CMD.APPLY), LIVE_HEADER_DELAY_MS);
  }

  /** Stores a static per-key map: custom mode 0x80 + brightness, then the colours. */
  async writePerKey(leds: LedColor[], brightness: number) {
    const mode = new Uint8Array(16);
    mode[0] = MODE_PER_KEY;
    mode[9] = toLevel(brightness);
    mode[14] = 0xaa;
    mode[15] = 0x55;
    await this.session(CMD.LIGHTING, mode);
    await this.session(CMD.PER_KEY, buildPerKeyPayload(leds));
  }

  /** begin → header(op, n) → n data packets → apply → finalize. */
  private async session(op: number, data: Uint8Array) {
    const packets = Math.ceil(data.length / 64);
    await this.headerWithAck(header(CMD.BEGIN));
    await this.headerWithAck(header(op, packets));
    await this.sendChunks(data, PACKET_DELAY_MS);
    await this.headerWithAck(header(CMD.APPLY));
    await this.set(header(CMD.FINALIZE));
    // Applying a session stores it in flash; give the keyboard time before the next command.
    await sleep(FLASH_SETTLE_MS);
  }

  private async sendChunks(data: Uint8Array, delay: number) {
    for (let off = 0; off < data.length; off += 64) await this.set(data.subarray(off, off + 64), delay);
  }

  private async set(data: Uint8Array, delay = PACKET_DELAY_MS) {
    await this.transport.raw({ kind: 'feature-set', reportId: 0, data });
    await sleep(delay);
  }

  /**
   * Sends a header, then reads the feature report back. The firmware ignores later packets
   * without this. While the keyboard is busy (e.g. still writing flash after a save) the
   * readback can return the previous reply, so it is polled a few times before giving up.
   */
  private async headerWithAck(packet: Uint8Array, delay = PACKET_DELAY_MS) {
    await this.set(packet, delay);
    let got = '';
    for (let attempt = 0; attempt < ACK_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(ACK_RETRY_MS);
      let res = await this.transport.raw({ kind: 'feature-get', reportId: 0 });
      if (!res) throw new ProtocolError('No readback from keyboard');
      // Some platforms prefix the (zero) report ID byte.
      if (res.length > 64 && res[0] === 0) res = res.subarray(1);
      if (res[0] === packet[0] && res[1] === packet[1]) {
        await sleep(delay);
        return;
      }
      got = Array.from(res.subarray(0, 4), (b) => b.toString(16).padStart(2, '0')).join(' ');
    }
    throw new ProtocolError(
      `Keyboard did not acknowledge 04 ${packet[1]!.toString(16).padStart(2, '0')} (got ${got})`,
    );
  }
}
