//go:build windows

package main

import (
	"os"
	"testing"
	"time"
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

// Hardware test that WRITES to the keyboard: replays a plan JSON file (as produced by the
// app) through the launcher's native HID path. OPENGALAXY_HID_REPLAY=<path to plan.json>
func TestReplayPlanOnHardware(t *testing.T) {
	path := os.Getenv("OPENGALAXY_HID_REPLAY")
	if path == "" {
		t.Skip("set OPENGALAXY_HID_REPLAY=<plan.json> to send a plan to a connected Galaxy80")
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	p, err := parsePlan(f)
	if err != nil || p == nil {
		t.Fatalf("plan: %v", err)
	}
	start := time.Now()
	if err := replayPlan(p); err != nil {
		t.Fatal(err)
	}
	t.Logf("sent %d steps in %v, every readback acknowledged", len(p.Steps), time.Since(start).Round(time.Millisecond))
}
