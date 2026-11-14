import { DEFAULT_VIA_EFFECT_MAP, ViaProtocol, type EffectMap } from './protocols/via';
import { SonixGalaxyProtocol } from './protocols/sonix';
import type { LightingProtocol, Transport } from './types';

/** VIA / QMK raw-HID interface: usage page 0xFF60, usage 0x61. */
export const VIA_USAGE_PAGE = 0xff60;
export const VIA_USAGE = 0x61;

/**
 * Galaxy80 (wired) as read from Windows: SONIX controller reusing Apple's VID.
 * Interface MI_02 is the configuration channel: usage page 0xFF13, usage 0x01,
 * 64-byte input / output / feature reports.
 */
export const GALAXY80 = {
  vendorId: 0x05ac,
  productId: 0x024f,
  usagePage: 0xff13,
  usage: 0x01,
} as const;

export interface DeviceProfile {
  id: string;
  name: string;
  /** Filters passed to navigator.hid.requestDevice. */
  filters: HIDDeviceFilter[];
  /** Does this profile claim the given HID interface? */
  matches(device: HIDDevice): boolean;
  createProtocol(transport: Transport): LightingProtocol;
}

const hasCollection = (d: HIDDevice, usagePage: number, usage?: number) =>
  (d.collections ?? []).some(
    (c) => c.usagePage === usagePage && (usage === undefined || c.usage === usage),
  );

export const GALAXY80_SONIX: DeviceProfile = {
  id: 'galaxy80-sonix',
  name: 'Epomaker Galaxy80',
  filters: [{ vendorId: GALAXY80.vendorId, productId: GALAXY80.productId, usagePage: GALAXY80.usagePage }],
  // 05AC:024F is shared by many SONIX boards, so also require the 0xFF13 interface.
  matches: (d) =>
    d.vendorId === GALAXY80.vendorId &&
    d.productId === GALAXY80.productId &&
    hasCollection(d, GALAXY80.usagePage),
  createProtocol: (t) => new SonixGalaxyProtocol(t),
};

/** Kept for VIA-compatible boards; the stock Galaxy80 firmware does not expose VIA. */
const VIA_EFFECTS: EffectMap = { ...DEFAULT_VIA_EFFECT_MAP };

export const GENERIC_VIA: DeviceProfile = {
  id: 'via',
  name: 'VIA-compatible keyboard',
  filters: [{ usagePage: VIA_USAGE_PAGE, usage: VIA_USAGE }],
  matches: (d) => hasCollection(d, VIA_USAGE_PAGE, VIA_USAGE),
  createProtocol: (t) => new ViaProtocol(t, VIA_EFFECTS),
};

export const PROFILES: DeviceProfile[] = [GALAXY80_SONIX, GENERIC_VIA];

export function profileFor(device: HIDDevice): DeviceProfile | null {
  return PROFILES.find((p) => p.matches(device)) ?? null;
}

const vendorCollections = (d: HIDDevice) => (d.collections ?? []).filter((c) => (c.usagePage ?? 0) >= 0xff00);

/**
 * A keyboard enumerates as several HID interfaces (keyboard, consumer, vendor…).
 * Prefer one a profile recognises, then a vendor-defined page that can actually
 * receive data (output or feature reports) — an input-only vendor collection such
 * as the Galaxy80's 0xFFFF one can't be configured through.
 */
export function pickInterface(devices: HIDDevice[]): HIDDevice | null {
  return (
    devices.find((d) => profileFor(d)) ??
    devices.find((d) =>
      vendorCollections(d).some((c) => (c.outputReports?.length ?? 0) + (c.featureReports?.length ?? 0) > 0),
    ) ??
    devices.find((d) => vendorCollections(d).length > 0) ??
    devices[0] ??
    null
  );
}

export const formatId = (n: number) => `0x${n.toString(16).padStart(4, '0').toUpperCase()}`;
