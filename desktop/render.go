package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
)

// waveSpec describes the Custom wave the launcher keeps running after the app window
// has closed. It mirrors the page's renderFrame (src/components/keyboard/effects.ts,
// customWave branch); render_test.go checks both produce the same LED colours.
type waveSpec struct {
	VendorID    uint16    `json:"vendorId"`
	ProductID   uint16    `json:"productId"`
	UsagePage   uint16    `json:"usagePage"`
	FrameMs     int       `json:"frameMs"`
	ClockOffset float64   `json:"clockOffset"` // Unix seconds at the page's performance.now() == 0
	BoardW      float64   `json:"boardW"`
	BoardH      float64   `json:"boardH"`
	Keys        []waveKey `json:"keys"`
	Lighting    struct {
		Gradient   []waveStop `json:"gradient"`
		Direction  string     `json:"direction"`
		WaveLength float64    `json:"waveLength"`
		Speed      float64    `json:"speed"`
		Brightness float64    `json:"brightness"`
	} `json:"lighting"`

	stops []labStop // prepared from Lighting.Gradient
}

type waveKey struct {
	Index int     `json:"index"`
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	W     float64 `json:"w"`
}

type waveStop struct {
	Color string  `json:"color"`
	Pos   float64 `json:"pos"`
}

type rgb struct{ r, g, b float64 }
type lab struct{ L, a, b float64 }
type labStop struct {
	rgb rgb
	lab lab
	pos float64
}

// ledColor is one LED of a frame: firmware light index and 0–255 channels.
type ledColor struct {
	Index   int
	R, G, B uint8
}

func parseWaveSpec(r io.Reader) (*waveSpec, error) {
	var s waveSpec
	if err := json.NewDecoder(io.LimitReader(r, maxPlanBody)).Decode(&s); err != nil {
		return nil, fmt.Errorf("invalid wave: %w", err)
	}
	if len(s.Keys) == 0 {
		return nil, nil // clears the background wave
	}
	if s.UsagePage < 0xff00 || s.VendorID == 0 || s.ProductID == 0 {
		return nil, errors.New("wave must target a vendor-defined HID interface")
	}
	if len(s.Keys) > 200 || s.BoardW <= 0 || s.BoardH <= 0 {
		return nil, errors.New("invalid key layout")
	}
	for _, k := range s.Keys {
		if k.Index < 0 || k.Index > 255 || k.W <= 0 {
			return nil, fmt.Errorf("invalid key %d", k.Index)
		}
	}
	l := &s.Lighting
	switch l.Direction {
	case "right", "left", "down", "up":
	default:
		return nil, fmt.Errorf("invalid direction %q", l.Direction)
	}
	if len(l.Gradient) < 2 || len(l.Gradient) > 16 {
		return nil, errors.New("gradient needs 2–16 colours")
	}
	l.WaveLength = clamp(l.WaveLength, 50, 400)
	l.Speed = clamp(l.Speed, 0, 100)
	l.Brightness = clamp(l.Brightness, 0, 100)
	if s.FrameMs < 20 || s.FrameMs > 200 {
		s.FrameMs = 40
	}
	for _, st := range l.Gradient {
		c, err := parseHex(st.Color)
		if err != nil {
			return nil, err
		}
		s.stops = append(s.stops, labStop{rgb: c, lab: rgbToOklab(c), pos: frac(st.Pos)})
	}
	sort.SliceStable(s.stops, func(i, j int) bool { return s.stops[i].pos < s.stops[j].pos })
	return &s, nil
}

// render computes one frame at page time t (seconds since the page's performance origin).
func (s *waveSpec) render(t float64) []ledColor {
	l := s.Lighting
	sp := 0.25 + (l.Speed/100)*2.25
	level := l.Brightness / 100
	length := math.Max(0.1, l.WaveLength/100)
	shift := t * sp * 0.2
	horizontal := l.Direction == "left" || l.Direction == "right"

	out := make([]ledColor, 0, len(s.Keys))
	for _, k := range s.Keys {
		cx := k.X + k.W/2
		cy := k.Y + 0.5
		extent := 1.0
		if horizontal {
			extent = k.W
		}
		n := int(math.Max(3, math.Ceil(extent*3)))
		var lr, lg, lb float64
		for j := 0; j < n; j++ {
			off := ((float64(j)+0.5)/float64(n) - 0.5) * extent * 0.9
			px, py := cx, cy+off
			if horizontal {
				px, py = cx+off, cy
			}
			c := sampleStops(s.stops, (s.along(px, py)-shift)/length)
			lr += srgbToLinear(c.r)
			lg += srgbToLinear(c.g)
			lb += srgbToLinear(c.b)
		}
		c := rgb{linearToSrgb(lr / float64(n)), linearToSrgb(lg / float64(n)), linearToSrgb(lb / float64(n))}
		out = append(out, ledColor{Index: k.Index, R: toByte(c.r * level), G: toByte(c.g * level), B: toByte(c.b * level)})
	}
	return out
}

func (s *waveSpec) along(x, y float64) float64 {
	switch s.Lighting.Direction {
	case "left":
		return 1 - x/s.BoardW
	case "down":
		return y / s.BoardH
	case "up":
		return 1 - y/s.BoardH
	default: // right
		return x / s.BoardW
	}
}

// sampleStops samples the looping gradient (stops sorted by pos) at p, blending in OKLab.
func sampleStops(stops []labStop, p float64) rgb {
	n := len(stops)
	switch n {
	case 0:
		return rgb{}
	case 1:
		return stops[0].rgb
	}
	x := frac(p)
	a, b := stops[n-1], stops[0]
	aPos, bPos := a.pos-1, b.pos
	for i := 0; i < n; i++ {
		s := stops[i]
		if s.pos > x {
			b, bPos = s, s.pos
			break
		}
		a, aPos = s, s.pos
		b = stops[(i+1)%n]
		if i+1 < n {
			bPos = b.pos
		} else {
			bPos = b.pos + 1
		}
	}
	span := bPos - aPos
	t := 0.0
	if span > 1e-6 {
		t = (x - aPos) / span
	}
	if t <= 0 {
		return a.rgb
	}
	if t >= 1 {
		return b.rgb
	}
	return oklabToRgb(lab{
		L: a.lab.L + (b.lab.L-a.lab.L)*t,
		a: a.lab.a + (b.lab.a-a.lab.a)*t,
		b: a.lab.b + (b.lab.b-a.lab.b)*t,
	})
}

func srgbToLinear(c float64) float64 {
	v := c / 255
	if v <= 0.04045 {
		return v / 12.92
	}
	return math.Pow((v+0.055)/1.055, 2.4)
}

func linearToSrgb(v float64) float64 {
	x := clamp(v, 0, 1)
	if x <= 0.0031308 {
		return 255 * x * 12.92
	}
	return 255 * (1.055*math.Pow(x, 1/2.4) - 0.055)
}

func rgbToOklab(c rgb) lab {
	lr, lg, lb := srgbToLinear(c.r), srgbToLinear(c.g), srgbToLinear(c.b)
	l := math.Cbrt(0.4122214708*lr + 0.5363325363*lg + 0.0514459929*lb)
	m := math.Cbrt(0.2119034982*lr + 0.6806995451*lg + 0.1073969566*lb)
	s := math.Cbrt(0.0883024619*lr + 0.2817188376*lg + 0.6299787005*lb)
	return lab{
		L: 0.2104542553*l + 0.793617785*m - 0.0040720468*s,
		a: 1.9779984951*l - 2.428592205*m + 0.4505937099*s,
		b: 0.0259040371*l + 0.7827717662*m - 0.808675766*s,
	}
}

func oklabToRgb(c lab) rgb {
	l := math.Pow(c.L+0.3963377774*c.a+0.2158037573*c.b, 3)
	m := math.Pow(c.L-0.1055613458*c.a-0.0638541728*c.b, 3)
	s := math.Pow(c.L-0.0894841775*c.a-1.291485548*c.b, 3)
	return rgb{
		r: linearToSrgb(4.0767416621*l - 3.3077115913*m + 0.2309699292*s),
		g: linearToSrgb(-1.2684380046*l + 2.6097574011*m - 0.3413193965*s),
		b: linearToSrgb(-0.0041960863*l - 0.7034186147*m + 1.707614701*s),
	}
}

func parseHex(s string) (rgb, error) {
	h := strings.TrimPrefix(strings.TrimSpace(s), "#")
	if len(h) != 6 {
		return rgb{}, fmt.Errorf("invalid colour %q", s)
	}
	n, err := strconv.ParseUint(h, 16, 32)
	if err != nil {
		return rgb{}, fmt.Errorf("invalid colour %q", s)
	}
	return rgb{float64(n >> 16 & 255), float64(n >> 8 & 255), float64(n & 255)}, nil
}

func frac(x float64) float64 { return x - math.Floor(x) }
func clamp(v, lo, hi float64) float64 {
	return math.Max(lo, math.Min(hi, v))
}
func toByte(v float64) uint8 { return uint8(clamp(math.Round(v), 0, 255)) }
