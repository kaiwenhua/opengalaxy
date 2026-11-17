package main

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"
)

// The fixture is generated from the web app's real renderer (renderFrame + frameToLeds via
// backgroundWaveSpec), so this proves the background wave looks exactly like the app's.
func TestRenderMatchesApp(t *testing.T) {
	raw, err := os.ReadFile("testdata/wave-fixture.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name   string          `json:"name"`
		Spec   json.RawMessage `json:"spec"`
		Frames []struct {
			T    float64  `json:"t"`
			LEDs [][4]int `json:"leds"`
		} `json:"frames"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		spec, err := parseWaveSpec(bytes.NewReader(c.Spec))
		if err != nil || spec == nil {
			t.Fatalf("%s: spec rejected: %v", c.Name, err)
		}
		for _, f := range c.Frames {
			got := spec.render(f.T)
			if len(got) != len(f.LEDs) {
				t.Fatalf("%s t=%v: %d LEDs, want %d", c.Name, f.T, len(got), len(f.LEDs))
			}
			worst := 0
			for i, want := range f.LEDs {
				g := got[i]
				if g.Index != want[0] {
					t.Fatalf("%s t=%v: LED %d index %d, want %d", c.Name, f.T, i, g.Index, want[0])
				}
				for ch, v := range []uint8{g.R, g.G, g.B} {
					d := int(v) - want[ch+1]
					if d < 0 {
						d = -d
					}
					if d > worst {
						worst = d
					}
				}
			}
			// Allow ±1 for float rounding differences between JS and Go.
			if worst > 1 {
				t.Errorf("%s t=%v: max channel difference %d", c.Name, f.T, worst)
			}
		}
	}
}

func TestWaveSpecRejects(t *testing.T) {
	cases := map[string]string{
		"keyboard usage page": `{"vendorId":1452,"productId":591,"usagePage":1,"boardW":18,"boardH":6,"keys":[{"index":1,"x":0,"y":0,"w":1}],"lighting":{"direction":"right","gradient":[{"color":"#ffffff","pos":0},{"color":"#000000","pos":0.5}]}}`,
		"bad direction":       `{"vendorId":1452,"productId":591,"usagePage":65299,"boardW":18,"boardH":6,"keys":[{"index":1,"x":0,"y":0,"w":1}],"lighting":{"direction":"sideways","gradient":[{"color":"#ffffff","pos":0},{"color":"#000000","pos":0.5}]}}`,
		"one colour":          `{"vendorId":1452,"productId":591,"usagePage":65299,"boardW":18,"boardH":6,"keys":[{"index":1,"x":0,"y":0,"w":1}],"lighting":{"direction":"right","gradient":[{"color":"#ffffff","pos":0}]}}`,
		"bad colour":          `{"vendorId":1452,"productId":591,"usagePage":65299,"boardW":18,"boardH":6,"keys":[{"index":1,"x":0,"y":0,"w":1}],"lighting":{"direction":"right","gradient":[{"color":"red","pos":0},{"color":"#000000","pos":0.5}]}}`,
		"index out of range":  `{"vendorId":1452,"productId":591,"usagePage":65299,"boardW":18,"boardH":6,"keys":[{"index":300,"x":0,"y":0,"w":1}],"lighting":{"direction":"right","gradient":[{"color":"#ffffff","pos":0},{"color":"#000000","pos":0.5}]}}`,
	}
	for name, body := range cases {
		if _, err := parseWaveSpec(bytes.NewReader([]byte(body))); err == nil {
			t.Errorf("%s: accepted, want rejection", name)
		}
	}
	if s, err := parseWaveSpec(bytes.NewReader([]byte(`{}`))); err != nil || s != nil {
		t.Errorf("empty spec should clear: %v %v", s, err)
	}
}
