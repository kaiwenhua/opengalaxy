// genicon renders the OpenGalaxy logo (same design as public/favicon.svg) to PNGs for
// the Windows executable icon:  go run ./cmd/genicon <outdir>
package main

import (
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
)

var sizes = []int{256, 64, 48, 32, 24, 16}

const supersample = 4

func main() {
	out := "winres"
	if len(os.Args) > 1 {
		out = os.Args[1]
	}
	if err := os.MkdirAll(out, 0o755); err != nil {
		panic(err)
	}
	for _, s := range sizes {
		f, err := os.Create(filepath.Join(out, fmt.Sprintf("icon%d.png", s)))
		if err != nil {
			panic(err)
		}
		if err := png.Encode(f, render(s)); err != nil {
			panic(err)
		}
		_ = f.Close()
	}
}

type rgba struct{ r, g, b, a float64 }

func over(dst, src rgba) rgba {
	a := src.a + dst.a*(1-src.a)
	if a == 0 {
		return rgba{}
	}
	mix := func(s, d float64) float64 { return (s*src.a + d*dst.a*(1-src.a)) / a }
	return rgba{mix(src.r, dst.r), mix(src.g, dst.g), mix(src.b, dst.b), a}
}

// shade returns the logo colour at (x, y) in a 32×32 design space.
func shade(x, y float64) rgba {
	var c rgba
	// Rounded square background: 28×28 at (2,2), radius 8.
	if roundedRect(x, y, 2, 2, 28, 28, 8) {
		c = over(c, rgba{0x0f / 255.0, 0x0f / 255.0, 0x15 / 255.0, 1})
	}
	// Ring: centre (16,16), radius 7, stroke 3, gradient violet → cyan along the diagonal.
	if d := math.Hypot(x-16, y-16); math.Abs(d-7) <= 1.5 {
		t := clamp(((x-9)+(y-9))/28, 0, 1)
		violet := rgba{0x8b / 255.0, 0x5c / 255.0, 0xf6 / 255.0, 1}
		cyan := rgba{0x22 / 255.0, 0xd3 / 255.0, 0xee / 255.0, 1}
		c = over(c, rgba{lerp(violet.r, cyan.r, t), lerp(violet.g, cyan.g, t), lerp(violet.b, cyan.b, t), 1})
	}
	// Satellite dot: centre (22.5, 9.5), radius 2.
	if math.Hypot(x-22.5, y-9.5) <= 2 {
		c = over(c, rgba{0x22 / 255.0, 0xd3 / 255.0, 0xee / 255.0, 1})
	}
	return c
}

func render(size int) image.Image {
	img := image.NewNRGBA(image.Rect(0, 0, size, size))
	n := supersample * supersample
	for py := 0; py < size; py++ {
		for px := 0; px < size; px++ {
			var acc rgba
			for sy := 0; sy < supersample; sy++ {
				for sx := 0; sx < supersample; sx++ {
					x := (float64(px) + (float64(sx)+0.5)/supersample) * 32 / float64(size)
					y := (float64(py) + (float64(sy)+0.5)/supersample) * 32 / float64(size)
					c := shade(x, y)
					// Accumulate premultiplied for correct edge blending.
					acc.r += c.r * c.a
					acc.g += c.g * c.a
					acc.b += c.b * c.a
					acc.a += c.a
				}
			}
			if acc.a == 0 {
				continue
			}
			img.SetNRGBA(px, py, color.NRGBA{
				R: byteOf(acc.r / acc.a),
				G: byteOf(acc.g / acc.a),
				B: byteOf(acc.b / acc.a),
				A: byteOf(acc.a / float64(n)),
			})
		}
	}
	return img
}

func roundedRect(x, y, rx, ry, w, h, r float64) bool {
	if x < rx || y < ry || x > rx+w || y > ry+h {
		return false
	}
	cx := clamp(x, rx+r, rx+w-r)
	cy := clamp(y, ry+r, ry+h-r)
	return math.Hypot(x-cx, y-cy) <= r
}

func clamp(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }
func lerp(a, b, t float64) float64    { return a + (b-a)*t }
func byteOf(v float64) uint8          { return uint8(math.Round(clamp(v, 0, 1) * 255)) }
