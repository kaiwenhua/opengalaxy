import { VIA, VIA_CHANNEL } from './protocols/via';
import type { CollectionInfo, RawOp, RequestOptions, Tap, Transport } from './types';

/** Simulated EEPROM (RGB-matrix channel, valueId -> bytes); survives demo reconnects. */
let savedEeprom = new Map<number, number[]>([
  [1, [200]], // brightness
  [2, [14]], // effect
  [3, [128]], // speed
  [4, [191, 255]], // hue, sat
]);

/**
 * In-memory keyboard that speaks the VIA raw-HID protocol. Because it sits behind
 * the {@link Transport} interface, demo mode exercises exactly the same encoding
 * code path as a real device — every packet shows up in the Device tab log.
 */
export class MockViaKeyboard implements Transport {
  readonly name = 'Galaxy80 (simulated)';
  readonly vendorId = 0x0000;
  readonly productId = 0x0000;
  readonly reportSize = 32;
  readonly isMock = true;
  readonly collections: CollectionInfo[] = [
    { usagePage: 0xff60, usage: 0x61, input: [{ id: 0, size: 32 }], output: [{ id: 0, size: 32 }], feature: [] },
  ];
  tap: Tap | null = null;

  private opened = false;
  private readonly startedAt = Date.now();
  /** valueId -> bytes, for the RGB-matrix channel. */
  private live = new Map(savedEeprom);

  async open() {
    await delay(120);
    // Like a power cycle: unsaved changes are lost, saved ones come back.
    this.live = new Map(savedEeprom);
    this.opened = true;
  }

  async close() {
    this.opened = false;
  }

  async write(payload: Uint8Array) {
    await this.request(payload);
  }

  async raw(op: RawOp): Promise<Uint8Array | null> {
    if (op.kind !== 'output' || op.reportId !== 0) {
      throw new Error('The simulated keyboard only has output report 0 (no feature reports)');
    }
    const res = await this.request(op.data);
    return op.awaitInput ? res : null;
  }

  async request(payload: Uint8Array, { timeoutMs = 1000 }: RequestOptions = {}) {
    if (!this.opened) throw new Error('Device not open');
    const report = new Uint8Array(this.reportSize);
    report.set(payload.subarray(0, this.reportSize));
    this.tap?.('tx', report);

    const response = this.handle(report);
    await delay(Math.min(timeoutMs, 4 + Math.random() * 6)); // USB-ish latency
    this.tap?.('rx', response);
    return response;
  }

  private handle(req: Uint8Array): Uint8Array {
    const res = req.slice();
    const [cmd, channel = 0, valueId = 0] = req;
    switch (cmd) {
      case VIA.GET_PROTOCOL_VERSION:
        res[1] = 0x00;
        res[2] = 0x0c;
        break;
      case VIA.GET_KEYBOARD_VALUE: {
        if (req[1] === 0x01) {
          const uptime = Date.now() - this.startedAt;
          res.set([(uptime >>> 24) & 255, (uptime >>> 16) & 255, (uptime >>> 8) & 255, uptime & 255], 2);
        }
        break;
      }
      case VIA.CUSTOM_SET_VALUE:
        if (channel !== VIA_CHANNEL.RGB_MATRIX || !this.live.has(valueId)) return unhandled(req);
        this.live.set(valueId, Array.from(req.subarray(3, valueId === 4 ? 5 : 4)));
        break;
      case VIA.CUSTOM_GET_VALUE: {
        const v = channel === VIA_CHANNEL.RGB_MATRIX ? this.live.get(valueId) : undefined;
        if (!v) return unhandled(req);
        res.set(v, 3);
        break;
      }
      case VIA.CUSTOM_SAVE:
        savedEeprom = new Map(this.live);
        break;
      default:
        return unhandled(req);
    }
    return res;
  }
}

function unhandled(req: Uint8Array) {
  const res = req.slice();
  res[0] = VIA.UNHANDLED;
  return res;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
