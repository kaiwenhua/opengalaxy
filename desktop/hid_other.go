//go:build !windows

package main

import "errors"

// Native HID replay is only implemented for Windows so far.
func replayPlan(*exitPlan) error {
	return errors.New("storing on exit is only supported on Windows")
}
