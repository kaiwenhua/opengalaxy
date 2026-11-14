import { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from '../../lib/color';
import {
  ProtocolError,
  type EffectId,
  type LightingKey,
  type LightingProtocol,
  type LightingState,
  type Transport,
} from '../types';

/**
 * VIA raw-HID protocol (QMK `via.h`, protocol v12 / "VIA v3" custom values).
 *
 *   request : [command, channel, value_id, data...]  (zero padded to 32 bytes, report id 0)
 *   response: the firmware echoes the request buffer, filling in data for "get" commands.
 *             An unknown command is answered with 0xFF in byte 0.
 */
export const VIA = {
  GET_PROTOCOL_VERSION: 0x01,
  GET_KEYBOARD_VALUE: 0x02,
  CUSTOM_SET_VALUE: 0x07,
  CUSTOM_GET_VALUE: 0x08,
  CUSTOM_SAVE: 0x09,
  UNHANDLED: 0xff,
} as const;

export const VIA_CHANNEL = {
  BACKLIGHT: 1,
  RGBLIGHT: 2,
  RGB_MATRIX: 3,
  AUDIO: 4,
  LED_MATRIX: 5,
} as const;

export const RGB_MATRIX_VALUE = {
  BRIGHTNESS: 1,
  EFFECT: 2,
  EFFECT_SPEED: 3,
  COLOR: 4,
} as const;

/** Maps app effects to the firmware's RGB-matrix mode index. Order depends on the firmware build. */
export type EffectMap = Partial<Record<EffectId, number>>;

/**
 * Default index table for a stock QMK `rgb_matrix` build with the common effects enabled.
 * ⚠ Unverified for the Galaxy80 — read the real values off the board (Device tab → raw console:
 * `08 03 02` returns the current effect index) and override per device profile.
 */
export const DEFAULT_VIA_EFFECT_MAP: EffectMap = {
  off: 0,
  static: 1,
  breathing: 5,
  spectrum: 13,
  wave: 14,
  starlight: 37,
  reactive: 23,
  ripple: 30,
};

const pctToByte = (pct: number) => Math.round((Math.min(100, Math.max(0, pct)) / 100) * 255);
const byteToPct = (b: number) => Math.round((b / 255) * 100);

export class ViaProtocol implements LightingProtocol {
  readonly name = 'VIA · QMK RGB Matrix';
  private readonly channel = VIA_CHANNEL.RGB_MATRIX;

  constructor(
    private readonly transport: Transport,
    private readonly effectMap: EffectMap = DEFAULT_VIA_EFFECT_MAP,
  ) {}

  async handshake() {
    const res = await this.command([VIA.GET_PROTOCOL_VERSION], 600);
    const version = ((res[1] ?? 0) << 8) | (res[2] ?? 0);
    if (version === 0) throw new ProtocolError('Device answered with VIA protocol version 0');
    return { version };
  }

  async readLighting(): Promise<Partial<LightingState>> {
    const out: Partial<LightingState> = {};
    const brightness = await this.getValue(RGB_MATRIX_VALUE.BRIGHTNESS);
    out.brightness = byteToPct(brightness[0] ?? 0);

    const [mode = 0] = await this.getValue(RGB_MATRIX_VALUE.EFFECT);
    const effect = (Object.entries(this.effectMap) as [EffectId, number][]).find(
      ([, idx]) => idx === mode,
    )?.[0];
    if (effect) out.effect = effect;

    const speed = await this.getValue(RGB_MATRIX_VALUE.EFFECT_SPEED);
    out.speed = byteToPct(speed[0] ?? 0);

    const [hue = 0, sat = 0] = await this.getValue(RGB_MATRIX_VALUE.COLOR);
    out.color = rgbToHex(hsvToRgb({ h: (hue / 255) * 360, s: sat / 255, v: 1 }));
    return out;
  }

  async writeLighting(next: LightingState, changed: ReadonlySet<LightingKey>) {
    const all = changed.size === 0;
    if (all || changed.has('effect')) {
      // Unmapped effects (e.g. app-rendered Custom wave) leave the firmware effect as is.
      const mode = this.effectMap[next.effect];
      if (mode !== undefined) await this.setValue(RGB_MATRIX_VALUE.EFFECT, [mode]);
    }
    if (all || changed.has('color')) {
      const rgb = hexToRgb(next.color) ?? { r: 255, g: 255, b: 255 };
      const { h, s } = rgbToHsv(rgb);
      // VIA colour is hue/saturation only; intensity is driven by the brightness value.
      await this.setValue(RGB_MATRIX_VALUE.COLOR, [Math.round((h / 360) * 255), Math.round(s * 255)]);
    }
    if (all || changed.has('brightness')) {
      await this.setValue(RGB_MATRIX_VALUE.BRIGHTNESS, [pctToByte(next.brightness)]);
    }
    if (all || changed.has('speed')) {
      await this.setValue(RGB_MATRIX_VALUE.EFFECT_SPEED, [pctToByte(next.speed)]);
    }
  }

  async save() {
    await this.command([VIA.CUSTOM_SAVE, this.channel]);
  }

  private async getValue(valueId: number): Promise<number[]> {
    const res = await this.command([VIA.CUSTOM_GET_VALUE, this.channel, valueId]);
    return Array.from(res.subarray(3, 6));
  }

  private async setValue(valueId: number, data: number[]) {
    await this.command([VIA.CUSTOM_SET_VALUE, this.channel, valueId, ...data]);
  }

  private async command(bytes: number[], timeoutMs = 1000): Promise<Uint8Array> {
    const cmd = bytes[0];
    const res = await this.transport.request(Uint8Array.from(bytes), {
      timeoutMs,
      match: (r) => r[0] === cmd || r[0] === VIA.UNHANDLED,
    });
    if (res[0] === VIA.UNHANDLED) {
      throw new ProtocolError(`Firmware rejected command 0x${(cmd ?? 0).toString(16).padStart(2, '0')}`);
    }
    return res;
  }
}
