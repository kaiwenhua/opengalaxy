package main

import (
	"bytes"
	"os"
	"strings"
	"testing"
)

// The fixture is generated from the web app's real recorder (SonixGalaxyProtocol.planPerKey),
// so this checks that the launcher accepts exactly what the page sends.
func TestParsePlanFromApp(t *testing.T) {
	raw, err := os.ReadFile("testdata/still-image-plan.json")
	if err != nil {
		t.Fatal(err)
	}
	p, err := parsePlan(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("app plan rejected: %v", err)
	}
	if p.VendorID != 0x05ac || p.ProductID != 0x024f || p.UsagePage != 0xff13 {
		t.Fatalf("wrong target %04x:%04x/%04x", p.VendorID, p.ProductID, p.UsagePage)
	}
	if len(p.Steps) != 24 {
		t.Fatalf("got %d steps, want 24", len(p.Steps))
	}
	first := p.Steps[0]
	// Packets are recorded at their real length; setFeature zero-pads them to the report size.
	if first.Op != "set" || len(first.Data) < 2 || first.Data[0] != 0x04 || first.Data[1] != 0x18 {
		t.Fatalf("first step should be begin 04 18, got %s % x", first.Op, first.Data[:2])
	}
	if p.Steps[1].Op != "get" {
		t.Fatal("begin must be followed by a readback")
	}
	// Session 1 data: per-key mode 0x80 with AA 55 trailer.
	if d := p.Steps[4].Data; d[0] != 0x80 || d[14] != 0xaa || d[15] != 0x55 {
		t.Fatalf("mode packet wrong: % x", d[:16])
	}
}

func TestParsePlanRejects(t *testing.T) {
	cases := map[string]string{
		"keyboard usage page": `{"vendorId":1452,"productId":591,"usagePage":1,"steps":[{"op":"set","data":[4,24],"delayMs":35}]}`,
		"unknown op":          `{"vendorId":1452,"productId":591,"usagePage":65299,"steps":[{"op":"output","data":[4],"delayMs":0}]}`,
		"oversized report":    `{"vendorId":1452,"productId":591,"usagePage":65299,"steps":[{"op":"set","data":[` + strings.Repeat("1,", 64) + `1],"delayMs":0}]}`,
		"byte out of range":   `{"vendorId":1452,"productId":591,"usagePage":65299,"steps":[{"op":"set","data":[256],"delayMs":0}]}`,
		"huge delay":          `{"vendorId":1452,"productId":591,"usagePage":65299,"steps":[{"op":"set","data":[4],"delayMs":60000}]}`,
		"no device":           `{"usagePage":65299,"steps":[{"op":"set","data":[4],"delayMs":0}]}`,
	}
	for name, body := range cases {
		if _, err := parsePlan(strings.NewReader(body)); err == nil {
			t.Errorf("%s: accepted, want rejection", name)
		}
	}
	// An empty step list clears the plan.
	if p, err := parsePlan(strings.NewReader(`{"steps":[]}`)); err != nil || p != nil {
		t.Errorf("empty plan should clear: %v %v", p, err)
	}
}
