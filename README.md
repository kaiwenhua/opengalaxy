# OpenGalaxy

A lightweight, open-source lighting controller for the **Epomaker Galaxy80**, running entirely in the browser over **WebHID**. No installer, no background service, no account.

- Effects: Static, Breathing, Wave, Spectrum, Reactive, Ripple, Starlight, Off
- HSV colour pad with HEX / RGB entry, brightness and speed sliders
- Animated on-screen keyboard preview (type to test reactive effects)
- Presets (built-in + your own), all settings persisted in `localStorage`
- **Demo mode**: a simulated keyboard so the UI works with nothing plugged in
- Device tab with a live packet log and raw HID console for protocol work

## Quick start

Requires Node.js 18+ and Chrome or Edge on desktop (WebHID is not in Firefox/Safari).

```bash
npm install
npm run dev
```

Open http://localhost:5173, click **Connect keyboard** and pick the Galaxy80 (or press **Demo mode**).
WebHID only works on `localhost` or HTTPS.

```bash
npm run build     # static site in dist/ — host anywhere (GitHub Pages, etc.)
```

## Architecture

```
src/
├─ hid/
│  ├─ types.ts               Transport + LightingProtocol interfaces, lighting model
│  ├─ HidTransport.ts        WebHID byte pipe: padding, request/response pairing, timeouts, queue
│  ├─ MockViaKeyboard.ts     In-memory keyboard implementing the same Transport (demo mode)
│  ├─ protocols/via.ts       VIA / QMK RGB-matrix packet encoding
│  ├─ devices.ts             Device profiles: HID filters, interface selection, effect maps
│  └─ KeyboardController.ts  High-level API for the UI (connect, applyLighting, save, raw)
├─ state/                    localStorage-backed settings, React binding for the controller
├─ components/               UI (Tailwind v4)
└─ lib/color.ts              colour + hex helpers
```

The layers are deliberately split so that **only `protocols/*` knows about bytes**:

```
UI ──► KeyboardController ──► LightingProtocol (VIA, …) ──► Transport (WebHID | Mock)
```

`KeyboardController.applyLighting()` diffs against the last state sent and coalesces calls made while a write is in flight, so dragging a slider sends only the latest value.

## ⚠ Protocol status

The Galaxy80 does **not** speak VIA. It's a SONIX board (`05AC:024F`) that configures lighting with
64-byte feature reports on a vendor interface (usage page `0xFF13`). The app implements this
protocol **experimentally**: it's derived from the official driver's config files plus public
reverse-engineering of sibling keyboards that use the same OEM driver, but it isn't yet confirmed on a
Galaxy80. Details, sources and a USB-capture workflow are in [docs/PROTOCOL.md](docs/PROTOCOL.md)
(`npm run decode -- capture.pcapng` decodes a capture).

VIA support (`src/hid/protocols/via.ts`) stays in for VIA-compatible boards and powers demo mode.

## Desktop app later

The output of `npm run build` is a static site, so it can be wrapped with Electron or Tauri. Electron
supports WebHID via `session.setDevicePermissionHandler` / `select-hid-device`; with Tauri you'd swap
`HidTransport` for a Rust `hidapi` transport behind the same `Transport` interface.

## License

MIT. Not affiliated with or endorsed by Epomaker.
