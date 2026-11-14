# Galaxy80 protocol notes

## What we know (read from Windows, wired mode)

| | |
| --- | --- |
| Controller | SONIX (manufacturer string `SONIX`, product `Galaxy80`) |
| VID:PID | `05AC:024F`: Apple's vendor ID, reused by many SONIX keyboards, so don't match on it alone |
| Config interface | `MI_02`, usage page **`0xFF13`**, usage `0x01` |
| Report sizes | 64-byte input, output **and** feature reports |
| Other vendor page | `MI_01 COL05`, `0xFFFF`: input only (4 bytes), can't be written to |
| VIA | Not present (no `0xFF60` interface) |

## Official driver ("VTER Driver" 1.0.0.8)

The official software is an MFC app (`DeviceDriver.exe`) from Shenzhen Handechang Electronics (VTER).
Its plain-text files say a lot:

- `config.xml` lists Galaxy80 / Galaxy80 RGB / Galaxy70 as `05AC:024F`, Galaxy100 as `0C45:8006`.
- `layouts/rgb-keyboard80.xml`: brightness and speed **0–5**, default mode **11**,
  `cmd_delaytime=35` ms, and a `light_index` per key (for per-key RGB later).
- `language/1033.lan`: effect names 521–540 → firmware IDs (see below).
- The exe imports `HidD_SetFeature` / `HidD_GetFeature`, so it configures via **feature reports**.

It's the same driver family as the AJAZZ AK820 Pro and Aula/Epomaker F108 Pro (same `MUI` UI
library, layout XML format, effect list, 35 ms delay and `0xFF13` interface). Their protocol is
publicly reverse-engineered:
[parsiya/f108-pro `ai-docs/hid-protocol.md`](https://github.com/parsiya/f108-pro) and
[hcristosm/ak820-linux `docs/PROTOCOL.md`](https://github.com/hcristosm/ak820-linux).

## Lighting protocol (experimental, implemented in `src/hid/protocols/sonix.ts`)

64-byte feature reports, report ID 0, ~35 ms between packets, readback (GET_FEATURE) after each
header. The firmware ignores the rest of the sequence without that readback.

| Step | Packet (zero-padded to 64) | Readback |
| --- | --- | --- |
| begin | `04 18` | yes, expect `04 18 00 01` |
| lighting header | `04 13 00 00 00 00 00 00 01` (byte 8 = data packets) | yes |
| data | see below | no |
| apply | `04 02` | yes |
| finalize | `04 F0` | no |

Data packet: `[0] mode  [1..3] R G B  [8] rainbow 0/1  [9] brightness 0–5  [10] speed 0–5
[11] direction  [14..15] AA 55`. For mode 0 (off) the fields stay zero.

Firmware modes: 0 Off, 1 Static, 2 SingleOn, 3 SingleOff, 4 Glittering, 5 Falling, 6 Colourful,
7 Breath, 8 Spectrum, 9 Outward, 10 Scrolling, 11 Rolling, 12 Rotating, 13 Explode, 14 Launch,
15 Ripples, 16 Flowing, 17 Pulsating, 18 Tilt, 19 Shuttle.

There's no command to read the current lighting back, and applied settings persist without a
separate save.

**Wave direction (unverified):** Wave uses Rolling (11) for left/right and Scrolling (10) for up/down,
with direction byte 0 = left→right / downwards and 1 = right→left / upwards (per ak820-linux).

### Live frames (Custom wave)

The app renders Custom wave itself and streams frames, as the vendor's music page does. No session,
nothing is saved, and the keyboard returns to its stored effect when frames stop.

`04 20 … 08` (+ readback) → 8 × 64-byte packets holding up to 128 `(light_index, R, G, B)` entries
sorted by index → `04 02` (+ readback). 5 ms around the headers, 2 ms between data packets.

### Per-key colours (save a still frame)

Session 1: op `13` with data `[0] 80  [9] brightness 0–5  [14..15] AA 55` (custom per-key mode).
Session 2: op `23`, 9 packets = 576 bytes where light index *i* sits at byte *i*·4 as `(i, R, G, B)`,
`AA 55` in the last two bytes. Light indices come from `layouts/rgb-keyboard.xml`
(`LIGHT_INDEX` in `src/components/keyboard/layout.ts`). **Not yet confirmed on a Galaxy80.** If a step isn't acknowledged, the app stops and
logs it. A capture of the official driver (below) is the way to settle any differences.

## Capturing the official software (Windows)

1. Install [Wireshark](https://www.wireshark.org/) and tick **USBPcap** in its installer (reboot after).
2. In Wireshark, start a capture on the USBPcap root hub the keyboard is on. Keep "inject already
   connected devices descriptors" enabled, so the decoder can find the Galaxy80 by VID/PID.
3. In the official Epomaker driver, change **one thing at a time** and pause ~3 s between steps:
   - each effect, in order
   - colour: pure red `#ff0000`, then green `#00ff00`, then blue `#0000ff`
   - brightness: minimum, then maximum
   - speed: minimum, then maximum
   - "save/apply", if the software has a separate button
4. Stop and **File → Save As** `.pcapng`. Write down the order of your actions.
5. Decode it:

   ```bash
   npm run decode -- capture.pcapng
   ```

   Bytes that changed from the previous packet of the same command are highlighted. Look for:
   report type (output vs feature) and report ID, a command byte, value bytes that track your changes,
   a checksum (sum or XOR of other bytes), and begin/commit packets around each change.

6. Replay a captured packet from the app's **Device → packet console** (same report type and ID) and
   check that the keyboard reacts. **Only replay packets the official software sent.** Guessed commands
   can change settings or put a SONIX board into its bootloader.

## Implementing it

Fill in `SonixGalaxyProtocol` in `src/hid/protocols/sonix.ts` (`handshake`, `readLighting`,
`writeLighting`, `save`). The Galaxy80 profile in `src/hid/devices.ts` already routes the `0xFF13`
interface to it. If the protocol uses feature reports, add a feature-report helper to `Transport`
(the `raw()` method already supports `feature-set` / `feature-get`).
