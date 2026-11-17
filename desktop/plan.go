package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// exitPlan is a recorded HID packet sequence the page hands over, to be sent to the
// keyboard after the app window has closed (e.g. "store a still image of the Custom
// wave"). The protocol logic stays in the web app; the launcher only replays bytes.
type exitPlan struct {
	VendorID  uint16     `json:"vendorId"`
	ProductID uint16     `json:"productId"`
	UsagePage uint16     `json:"usagePage"`
	Steps     []planStep `json:"steps"`
}

type planStep struct {
	Op      string `json:"op"` // "set" (send feature report) or "get" (read until it echoes the last set)
	Data    []byte `json:"-"`
	RawData []int  `json:"data"`
	DelayMs int    `json:"delayMs"`
}

const (
	maxPlanSteps   = 100
	maxReportBytes = 64
	maxStepDelay   = 2 * time.Second
	maxPlanBody    = 64 << 10
)

// parsePlan validates a plan from the page. Only vendor-defined HID interfaces
// (usage page 0xFF00+) and bounded feature-report sequences are accepted.
func parsePlan(r io.Reader) (*exitPlan, error) {
	var p exitPlan
	if err := json.NewDecoder(io.LimitReader(r, maxPlanBody)).Decode(&p); err != nil {
		return nil, fmt.Errorf("invalid plan: %w", err)
	}
	if len(p.Steps) == 0 {
		return nil, nil // clears the plan
	}
	if p.UsagePage < 0xff00 {
		return nil, errors.New("plan must target a vendor-defined HID interface")
	}
	if p.VendorID == 0 || p.ProductID == 0 {
		return nil, errors.New("plan has no device id")
	}
	if len(p.Steps) > maxPlanSteps {
		return nil, fmt.Errorf("plan too long (%d steps)", len(p.Steps))
	}
	for i := range p.Steps {
		s := &p.Steps[i]
		if s.Op != "set" && s.Op != "get" {
			return nil, fmt.Errorf("step %d: unknown op %q", i, s.Op)
		}
		if time.Duration(s.DelayMs)*time.Millisecond > maxStepDelay || s.DelayMs < 0 {
			return nil, fmt.Errorf("step %d: bad delay", i)
		}
		if s.Op == "set" {
			if len(s.RawData) == 0 || len(s.RawData) > maxReportBytes {
				return nil, fmt.Errorf("step %d: report must be 1–%d bytes", i, maxReportBytes)
			}
			s.Data = make([]byte, len(s.RawData))
			for j, b := range s.RawData {
				if b < 0 || b > 255 {
					return nil, fmt.Errorf("step %d: byte out of range", i)
				}
				s.Data[j] = byte(b)
			}
		}
	}
	return &p, nil
}

func handlePlan(w http.ResponseWriter, r *http.Request, life *lifecycle) {
	p, err := parsePlan(r.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	life.setPlan(p)
	w.WriteHeader(http.StatusNoContent)
}
