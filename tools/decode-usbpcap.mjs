#!/usr/bin/env node
// Decodes HID traffic from a USBPcap capture (.pcapng or .pcap, as saved by Wireshark on Windows).
//
//   node tools/decode-usbpcap.mjs capture.pcapng                 # auto-selects the Galaxy80 (05AC:024F)
//   node tools/decode-usbpcap.mjs capture.pcapng --device 1.7    # bus.address from the summary
//   node tools/decode-usbpcap.mjs capture.pcapng --all --no-collapse
//
// Prints SET_REPORT / GET_REPORT control transfers and interrupt IN/OUT payloads.
// Bytes that differ from the previous packet of the same kind and leading bytes are
// highlighted, which makes "change one setting, see which byte moves" easy.

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

if (!file || flag('help')) {
  console.log('usage: node tools/decode-usbpcap.mjs <capture.pcapng> [--device bus.addr] [--all] [--no-collapse] [--no-color]');
  process.exit(file ? 0 : 1);
}

const LINKTYPE_USBPCAP = 249;
const TARGET_VID = 0x05ac;
const TARGET_PID = 0x024f;
const color = process.stdout.isTTY && !flag('no-color');
const hi = (s) => (color ? `\x1b[33;1m${s}\x1b[0m` : `[${s}]`);
const dim = (s) => (color ? `\x1b[2m${s}\x1b[0m` : s);

// ── 1. Container: pcapng or classic pcap → [{ t, data }] ─────────────────────

function* readPackets(buf) {
  const magic = buf.readUInt32LE(0);
  if (magic === 0x0a0d0d0a) yield* readPcapng(buf);
  else if (magic === 0xa1b2c3d4 || magic === 0xa1b23c4d) yield* readPcap(buf, magic === 0xa1b23c4d);
  else throw new Error('Not a pcap/pcapng file (or big-endian, which USBPcap never writes)');
}

function* readPcapng(buf) {
  const linkTypes = [];
  let off = 0;
  while (off + 12 <= buf.length) {
    const type = buf.readUInt32LE(off);
    const len = buf.readUInt32LE(off + 4);
    if (len < 12 || off + len > buf.length) break;
    const body = buf.subarray(off + 8, off + len - 4);
    if (type === 0x0a0d0d0a) linkTypes.length = 0; // new section
    else if (type === 1) linkTypes.push(body.readUInt16LE(0));
    else if (type === 6) {
      const iface = body.readUInt32LE(0);
      const ts = body.readUInt32LE(4) * 2 ** 32 + body.readUInt32LE(8); // µs by default
      const capLen = body.readUInt32LE(12);
      if (linkTypes[iface] === LINKTYPE_USBPCAP) yield { t: ts / 1e6, data: body.subarray(20, 20 + capLen) };
    }
    off += len;
  }
}

function* readPcap(buf, nano) {
  const linkType = buf.readUInt32LE(20);
  if (linkType !== LINKTYPE_USBPCAP) throw new Error(`Link type ${linkType} is not USBPcap (249)`);
  let off = 24;
  while (off + 16 <= buf.length) {
    const sec = buf.readUInt32LE(off);
    const frac = buf.readUInt32LE(off + 4);
    const len = buf.readUInt32LE(off + 8);
    yield { t: sec + frac / (nano ? 1e9 : 1e6), data: buf.subarray(off + 16, off + 16 + len) };
    off += 16 + len;
  }
}

// ── 2. USBPcap header → transfers ───────────────────────────────────────────

const TRANSFER = { 0: 'ISO', 1: 'INT', 2: 'CTRL', 3: 'BULK' };
const REPORT_TYPE = { 1: 'input', 2: 'output', 3: 'feature' };

function parseUsbPcap({ t, data }) {
  if (data.length < 27) return null;
  const headerLen = data.readUInt16LE(0);
  return {
    t,
    irp: data.readBigUInt64LE(2),
    completion: (data[16] & 1) === 1, // PDO → FDO: the device's answer
    bus: data.readUInt16LE(17),
    addr: data.readUInt16LE(19),
    endpoint: data[21],
    transfer: data[22],
    stage: data[22] === 2 && headerLen >= 28 ? data[27] : null, // 0 setup, 1 data, 2 status, 3 complete
    payload: data.subarray(headerLen),
  };
}

const devices = new Map(); // "bus.addr" -> { vid, pid, count }
const devKey = (p) => `${p.bus}.${p.addr}`;
const events = [];
const pendingSetup = new Map(); // irp -> { setup, key }

const buf = readFileSync(file);
let t0 = null;

for (const raw of readPackets(buf)) {
  const p = parseUsbPcap(raw);
  if (!p) continue;
  t0 ??= p.t;
  const key = devKey(p);
  const dev = devices.get(key) ?? { vid: null, pid: null, count: 0 };
  devices.set(key, dev);

  if (p.transfer === 2) {
    // Control transfer: pair the SETUP stage with its data (same IRP id).
    if (p.stage === 0 && p.payload.length >= 8) {
      const s = p.payload;
      const setup = {
        bmRequestType: s[0],
        bRequest: s[1],
        wValue: s.readUInt16LE(2),
        wIndex: s.readUInt16LE(4),
        wLength: s.readUInt16LE(6),
      };
      const outData = p.payload.subarray(8);
      pendingSetup.set(p.irp, { setup, key, t: p.t, data: outData.length ? outData : null });
      continue;
    }
    const pend = pendingSetup.get(p.irp);
    if (!pend) continue;
    if (p.payload.length && !pend.data) pend.data = p.payload;
    if (p.stage !== 3 && !(p.completion && p.stage === null)) continue;
    pendingSetup.delete(p.irp);

    const { setup } = pend;
    // Learn VID/PID from GET_DESCRIPTOR(device) replies.
    if (setup.bmRequestType === 0x80 && setup.bRequest === 0x06 && setup.wValue >> 8 === 1 && pend.data?.length >= 12) {
      dev.vid = pend.data.readUInt16LE(8);
      dev.pid = pend.data.readUInt16LE(10);
      continue;
    }
    const isClass = (setup.bmRequestType & 0x60) === 0x20;
    const isHidReport = isClass && (setup.bRequest === 0x09 || setup.bRequest === 0x01);
    if (!isHidReport) continue;
    const type = REPORT_TYPE[setup.wValue >> 8] ?? `type${setup.wValue >> 8}`;
    dev.count++;
    events.push({
      t: pend.t - t0,
      key,
      kind: `${setup.bRequest === 0x09 ? 'SET' : 'GET'}_${type.toUpperCase()}`,
      reportId: setup.wValue & 0xff,
      iface: setup.wIndex,
      data: pend.data ?? Buffer.alloc(0),
    });
    continue;
  }

  if (p.transfer === 1 && p.payload.length) {
    const isIn = (p.endpoint & 0x80) !== 0;
    // OUT data travels with the request, IN data with the completion.
    if (isIn !== p.completion) continue;
    dev.count++;
    events.push({ t: p.t - t0, key, kind: isIn ? 'INT_IN' : 'INT_OUT', endpoint: p.endpoint & 0x7f, data: p.payload });
  }
}

// ── 3. Pick a device and print ──────────────────────────────────────────────

const hex4 = (n) => (n == null ? '????' : n.toString(16).padStart(4, '0'));
console.log(dim('Devices with HID traffic (bus.address  VID:PID  packets):'));
for (const [key, d] of devices) {
  if (d.count) console.log(dim(`  ${key.padEnd(8)} ${hex4(d.vid)}:${hex4(d.pid)}  ${d.count}`));
}

let target = opt('device');
if (!target && !flag('all')) {
  target = [...devices].find(([, d]) => d.vid === TARGET_VID && d.pid === TARGET_PID)?.[0];
  if (!target) {
    console.log(
      dim('\nGalaxy80 (05AC:024F) not identified — its descriptor was not in the capture.') +
        dim('\nPass --device <bus.address> from the list above, or --all.'),
    );
    process.exit(1);
  }
}
console.log(dim(`\nShowing ${target ? `device ${target}` : 'all devices'}\n`));

const toHex = (data, prev) => {
  let end = data.length;
  while (end > 1 && data[end - 1] === 0) end--;
  return Array.from(data.subarray(0, end), (b, i) => {
    const s = b.toString(16).padStart(2, '0');
    return prev && prev.length === data.length && prev[i] !== b ? hi(s) : s;
  }).join(' ');
};

const lastByShape = new Map();
let collapsed = 0;
let lastLine = '';
const collapse = !flag('no-collapse');

for (const e of events) {
  if (target && e.key !== target) continue;
  const where = e.kind.startsWith('INT') ? `ep${e.endpoint}` : `if${e.iface} id=${e.reportId.toString(16).padStart(2, '0')}`;
  // Compare against the previous packet with the same kind and first two bytes (≈ same command).
  const shape = `${e.kind}|${where}|${e.data[0]}|${e.data[1]}`;
  const body = toHex(e.data, lastByShape.get(shape));
  lastByShape.set(shape, e.data);
  const line = `${e.kind.padEnd(14)} ${where.padEnd(12)} ${body}`;
  if (collapse && line === lastLine) {
    collapsed++;
    continue;
  }
  if (collapsed) console.log(dim(`   … repeated ${collapsed}×`));
  collapsed = 0;
  lastLine = line;
  console.log(`${dim(e.t.toFixed(3).padStart(9))}  ${line}`);
}
if (collapsed) console.log(dim(`   … repeated ${collapsed}×`));
