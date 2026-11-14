import { useSyncExternalStore } from 'react';
import { keyboard } from '../hid/KeyboardController';

/** Subscribes a component to the keyboard controller's connection / log snapshot. */
export function useKeyboard() {
  return useSyncExternalStore(keyboard.subscribe, keyboard.getSnapshot);
}
