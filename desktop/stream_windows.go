//go:build windows

package main

import (
	"fmt"
	"sort"
	"time"
)

// Live frames, as the app sends them (src/hid/protocols/sonix.ts sendLiveFrame):
// header 04 20 with 8 data packets (+ readback), 512 bytes of (index, R, G, B) sorted by
// index, then 04 02 (+ readback). Not stored in flash; the keyboard shows them while they
// keep coming and returns to its own effect a few seconds after the last one.
const (
	liveHeaderDelay = 5 * time.Millisecond
	liveDataDelay   = 2 * time.Millisecond
)

func buildLivePayload(leds []ledColor) []byte {
	sorted := append([]ledColor(nil), leds...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Index < sorted[j].Index })
	if len(sorted) > 128 {
		sorted = sorted[:128]
	}
	data := make([]byte, 512)
	for i, l := range sorted {
		copy(data[i*4:], []byte{byte(l.Index), l.R, l.G, l.B})
	}
	return data
}

func (d *hidDevice) headerWithAck(packet []byte, delay time.Duration) error {
	if err := d.setFeature(packet); err != nil {
		return err
	}
	time.Sleep(delay)
	for attempt := 0; attempt < 20; attempt++ {
		if attempt > 0 {
			time.Sleep(20 * time.Millisecond)
		}
		res, err := d.getFeature()
		if err != nil {
			return err
		}
		if len(res) >= 2 && res[0] == packet[0] && res[1] == packet[1] {
			time.Sleep(delay)
			return nil
		}
	}
	return fmt.Errorf("keyboard did not acknowledge % x", packet[:2])
}

func (d *hidDevice) sendLiveFrame(leds []ledColor) error {
	data := buildLivePayload(leds)
	header := make([]byte, 10)
	header[0], header[1], header[8] = 0x04, 0x20, byte(len(data)/64)
	if err := d.headerWithAck(header, liveHeaderDelay); err != nil {
		return err
	}
	for off := 0; off < len(data); off += 64 {
		if err := d.setFeature(data[off : off+64]); err != nil {
			return err
		}
		time.Sleep(liveDataDelay)
	}
	return d.headerWithAck([]byte{0x04, 0x02}, liveHeaderDelay)
}

// streamWave renders and sends the wave until stop is closed. The keyboard is (re)opened
// as needed, so unplugging and replugging it just pauses the wave.
func streamWave(spec *waveSpec, stop <-chan struct{}) {
	frame := time.Duration(spec.FrameMs) * time.Millisecond
	var dev *hidDevice
	defer func() {
		if dev != nil {
			dev.close()
		}
	}()
	var lastErr string
	frames := 0
	started := time.Now()
	for {
		select {
		case <-stop:
			logf("background wave stopped after %d frames (%.1f fps)", frames, float64(frames)/time.Since(started).Seconds())
			return
		default:
		}
		begin := time.Now()
		if dev == nil {
			d, err := openHID(spec.VendorID, spec.ProductID, spec.UsagePage)
			if err != nil {
				if err.Error() != lastErr {
					logf("background wave: %v (retrying)", err)
					lastErr = err.Error()
				}
				sleepOrStop(2*time.Second, stop)
				continue
			}
			dev, lastErr = d, ""
		}
		// Same clock as the page, so the wave continues where the window left off.
		t := float64(time.Now().UnixNano())/1e9 - spec.ClockOffset
		if err := dev.sendLiveFrame(spec.render(t)); err != nil {
			logf("background wave: %v (reopening keyboard)", err)
			dev.close()
			dev = nil
			continue
		}
		frames++
		sleepOrStop(frame-time.Since(begin), stop)
	}
}

func sleepOrStop(d time.Duration, stop <-chan struct{}) {
	if d <= 0 {
		return
	}
	select {
	case <-stop:
	case <-time.After(d):
	}
}
