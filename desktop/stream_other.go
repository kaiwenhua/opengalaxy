//go:build !windows

package main

// Background streaming needs native HID access, which is only implemented for Windows.
func streamWave(_ *waveSpec, stop <-chan struct{}) { <-stop }
