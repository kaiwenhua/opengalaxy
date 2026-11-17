package main

import (
	"sync"
	"time"
)

// lifecycle tracks what the page reports (heartbeats, goodbye, exit plan, background wave)
// so the launcher can tell when the app window is gone and what to do then.
type lifecycle struct {
	mu       sync.Mutex
	started  time.Time
	lastBeat time.Time
	byeAt    time.Time
	exitedAt time.Time
	plan     *exitPlan
	wave     *waveSpec
	quit     chan struct{}
	quitOnce sync.Once
}

func newLifecycle() *lifecycle {
	return &lifecycle{started: time.Now(), quit: make(chan struct{})}
}

func (l *lifecycle) heartbeat() {
	l.mu.Lock()
	l.lastBeat = time.Now()
	l.mu.Unlock()
}

func (l *lifecycle) bye() {
	l.mu.Lock()
	l.byeAt = time.Now()
	l.mu.Unlock()
}

func (l *lifecycle) browserExited() {
	l.mu.Lock()
	l.exitedAt = time.Now()
	l.mu.Unlock()
}

// requestQuit ends the launcher (tray "Stop wave and quit", a newer launcher, server error).
func (l *lifecycle) requestQuit() { l.quitOnce.Do(func() { close(l.quit) }) }

func (l *lifecycle) setPlan(p *exitPlan) {
	l.mu.Lock()
	had := l.plan != nil
	l.plan = p
	l.mu.Unlock()
	switch {
	case p != nil && !had:
		logf("exit plan received (%d steps)", len(p.Steps))
	case p == nil && had:
		logf("exit plan cleared")
	}
}

func (l *lifecycle) takePlan() *exitPlan {
	l.mu.Lock()
	defer l.mu.Unlock()
	p := l.plan
	l.plan = nil
	return p
}

func (l *lifecycle) setWave(w *waveSpec) {
	l.mu.Lock()
	had := l.wave != nil
	l.wave = w
	l.mu.Unlock()
	switch {
	case w != nil && !had:
		logf("background wave received (%d colours)", len(w.stops))
	case w == nil && had:
		logf("background wave cleared")
	}
}

func (l *lifecycle) currentWave() *waveSpec {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.wave
}

// windowGone reports whether the app window that was open since `since` has gone away:
// it said goodbye and no heartbeat followed (a reload sends one), it went silent, it never
// loaded, or the browser process we started has ended.
func (l *lifecycle) windowGone(since, now time.Time, ownBrowser bool) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	seen := l.lastBeat.After(since)
	switch {
	case !seen && now.Sub(since) > firstLoadTimeout:
		return true
	case seen && l.byeAt.After(l.lastBeat) && now.Sub(l.byeAt) > byeGrace:
		return true
	case seen && now.Sub(l.lastBeat) > silenceTimeout:
		return true
	case ownBrowser && !l.exitedAt.IsZero() && now.Sub(l.exitedAt) > exitedGrace &&
		(!seen || now.Sub(l.lastBeat) > exitedGrace):
		return true
	}
	return false
}

// windowOpened reports whether a page has checked in since `since` (window reopened).
func (l *lifecycle) windowOpened(since time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.lastBeat.After(since)
}

// waitWindowGone blocks until the window is gone (true) or a quit was requested (false).
func (l *lifecycle) waitWindowGone(since time.Time, ownBrowser bool) bool {
	t := time.NewTicker(250 * time.Millisecond)
	defer t.Stop()
	for {
		select {
		case <-l.quit:
			return false
		case now := <-t.C:
			if l.windowGone(since, now, ownBrowser) {
				return true
			}
		}
	}
}
