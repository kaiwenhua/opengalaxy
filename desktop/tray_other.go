//go:build !windows

package main

type tray struct{}

// No tray icon outside Windows yet (background mode is Windows-only).
func showTray(_, _, _ string, _, _ func()) *tray { return nil }
func (t *tray) close()                           {}
