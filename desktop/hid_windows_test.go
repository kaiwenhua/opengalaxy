//go:build windows

package main

import (
	"os"
	"testing"
)

// Read-only check against real hardware: finds and opens the Galaxy80 configuration
// interface without sending anything. Run with OPENGALAXY_HID_PROBE=1 while it's plugged in.
func TestProbeGalaxy80(t *testing.T) {
	if os.Getenv("OPENGALAXY_HID_PROBE") == "" {
		t.Skip("set OPENGALAXY_HID_PROBE=1 to probe a connected Galaxy80")
	}
	dev, err := openHID(0x05ac, 0x024f, 0xff13)
	if err != nil {
		t.Fatal(err)
	}
	defer dev.close()
	t.Logf("opened Galaxy80 config interface, feature report length %d (incl. report ID)", dev.featureLen)
	if dev.featureLen != 65 {
		t.Errorf("feature report length %d, want 65", dev.featureLen)
	}
}
