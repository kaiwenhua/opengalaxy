// Galaxy80: TKL (80 %) ANSI board with an extra F13 key, 88 keys, 18.25 × 6.25 units including gaps.

export interface KeyDef {
  label: string;
  /** KeyboardEvent.code, used to light keys when you type in reactive modes. */
  code: string;
  x: number;
  y: number;
  w: number;
}

type Cell = [label: string, code: string, width?: number] | number;

const chars = (s: string, prefix: string): Cell[] => s.split('').map((c) => [c, prefix + c]);

const ROWS: Cell[][] = [
  [
    ['Esc', 'Escape'], 0.25,
    ['F1', 'F1'], ['F2', 'F2'], ['F3', 'F3'], ['F4', 'F4'], 0.25,
    ['F5', 'F5'], ['F6', 'F6'], ['F7', 'F7'], ['F8', 'F8'], 0.25,
    ['F9', 'F9'], ['F10', 'F10'], ['F11', 'F11'], ['F12', 'F12'], 0.25,
    ['F13', 'F13'], 0.25,
    ['PrtSc', 'PrintScreen'], ['ScrLk', 'ScrollLock'], ['Pause', 'Pause'],
  ],
  [
    ['`', 'Backquote'], ...chars('1234567890', 'Digit'), ['-', 'Minus'], ['=', 'Equal'],
    ['Backspace', 'Backspace', 2], 0.25,
    ['Ins', 'Insert'], ['Home', 'Home'], ['PgUp', 'PageUp'],
  ],
  [
    ['Tab', 'Tab', 1.5], ...chars('QWERTYUIOP', 'Key'), ['[', 'BracketLeft'], [']', 'BracketRight'],
    ['\\', 'Backslash', 1.5], 0.25,
    ['Del', 'Delete'], ['End', 'End'], ['PgDn', 'PageDown'],
  ],
  [
    ['Caps', 'CapsLock', 1.75], ...chars('ASDFGHJKL', 'Key'), [';', 'Semicolon'], ["'", 'Quote'],
    ['Enter', 'Enter', 2.25],
  ],
  [
    ['Shift', 'ShiftLeft', 2.25], ...chars('ZXCVBNM', 'Key'), [',', 'Comma'], ['.', 'Period'], ['/', 'Slash'],
    ['Shift', 'ShiftRight', 2.75], 1.25,
    ['↑', 'ArrowUp'],
  ],
  [
    ['Ctrl', 'ControlLeft', 1.25], ['Win', 'MetaLeft', 1.25], ['Alt', 'AltLeft', 1.25], ['', 'Space', 6.25],
    ['Alt', 'AltRight', 1.25], ['Fn', 'Fn', 1.25], ['Menu', 'ContextMenu', 1.25], ['Ctrl', 'ControlRight', 1.25], 0.25,
    ['←', 'ArrowLeft'], ['↓', 'ArrowDown'], ['→', 'ArrowRight'],
  ],
];

/**
 * Galaxy80 firmware LED index per key (`light_index` in the official driver's
 * layouts/rgb-keyboard.xml). Used for per-key and live frames.
 */
export const LIGHT_INDEX: Record<string, number> = {
  Escape: 1, F1: 2, F2: 3, F3: 4, F4: 5, F5: 6, F6: 7, F7: 8, F8: 9, F9: 10, F10: 11, F11: 12, F12: 13,
  F13: 135, PrintScreen: 112, ScrollLock: 113, Pause: 115,
  Backquote: 19, Digit1: 20, Digit2: 21, Digit3: 22, Digit4: 23, Digit5: 24, Digit6: 25, Digit7: 26,
  Digit8: 27, Digit9: 28, Digit0: 29, Minus: 30, Equal: 31, Backspace: 103, Insert: 116, Home: 117, PageUp: 118,
  Tab: 37, KeyQ: 38, KeyW: 39, KeyE: 40, KeyR: 41, KeyT: 42, KeyY: 43, KeyU: 44, KeyI: 45, KeyO: 46, KeyP: 47,
  BracketLeft: 48, BracketRight: 49, Backslash: 67, Delete: 119, End: 120, PageDown: 121,
  CapsLock: 55, KeyA: 56, KeyS: 57, KeyD: 58, KeyF: 59, KeyG: 60, KeyH: 61, KeyJ: 62, KeyK: 63, KeyL: 64,
  Semicolon: 65, Quote: 66, Enter: 85,
  ShiftLeft: 73, KeyZ: 74, KeyX: 75, KeyC: 76, KeyV: 77, KeyB: 78, KeyN: 79, KeyM: 80, Comma: 81, Period: 82,
  Slash: 83, ShiftRight: 84, ArrowUp: 101,
  ControlLeft: 91, MetaLeft: 92, AltLeft: 93, Space: 94, AltRight: 95, Fn: 96, ContextMenu: 97, ControlRight: 98,
  ArrowLeft: 99, ArrowDown: 100, ArrowRight: 102,
};

export const BOARD_W = 18.25;
export const BOARD_H = 6.25;

export const KEYS: KeyDef[] = ROWS.flatMap((row, r) => {
  const y = r === 0 ? 0 : r + 0.25; // gap under the function row
  let x = 0;
  const keys: KeyDef[] = [];
  for (const cell of row) {
    if (typeof cell === 'number') {
      x += cell;
      continue;
    }
    const [label, code, w = 1] = cell;
    keys.push({ label, code, x, y, w });
    x += w;
  }
  return keys;
});
