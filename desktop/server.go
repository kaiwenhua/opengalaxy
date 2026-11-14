package main

import (
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"sync"
	"time"
)

const (
	pingPath      = "/__opengalaxy/ping"
	heartbeatPath = "/__opengalaxy/heartbeat"
	byePath       = "/__opengalaxy/bye"
)

// Page-visible lifecycle:
//   - the page POSTs a heartbeat every few seconds (browsers throttle timers in hidden
//     windows to about once a minute, hence the generous silence timeout)
//   - on close it sends a goodbye beacon; if no heartbeat follows (i.e. it wasn't just a
//     reload), the launcher exits shortly after
const (
	firstLoadTimeout = 90 * time.Second
	silenceTimeout   = 150 * time.Second
	byeGrace         = 4 * time.Second
	exitedGrace      = 6 * time.Second
)

var contentTypes = map[string]string{
	".html":        "text/html; charset=utf-8",
	".js":          "text/javascript; charset=utf-8",
	".css":         "text/css; charset=utf-8",
	".svg":         "image/svg+xml",
	".png":         "image/png",
	".ico":         "image/x-icon",
	".woff2":       "font/woff2",
	".json":        "application/json",
	".webmanifest": "application/manifest+json",
}

const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
	"font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'"

func newHandler(site fs.FS, port int, life *lifecycle) http.Handler {
	allowedHosts := map[string]bool{
		fmt.Sprintf("127.0.0.1:%d", port): true,
		fmt.Sprintf("localhost:%d", port): true,
	}
	origin := fmt.Sprintf("http://127.0.0.1:%d", port)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Reject DNS-rebinding and cross-site requests.
		if !allowedHosts[r.Host] {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")

		switch r.URL.Path {
		case pingPath:
			h.Set("X-OpenGalaxy", version)
			h.Set("Cache-Control", "no-store")
			_, _ = io.WriteString(w, "opengalaxy")
			return
		case heartbeatPath, byePath:
			if r.Method != http.MethodPost || (r.Header.Get("Origin") != "" && r.Header.Get("Origin") != origin) {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			if r.URL.Path == heartbeatPath {
				life.heartbeat()
			} else {
				life.bye()
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}

		serveFile(w, r, site)
	})
}

// serveFile serves the embedded site with single-page-app fallback to index.html.
func serveFile(w http.ResponseWriter, r *http.Request, site fs.FS) {
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "" {
		name = "index.html"
	}
	data, err := fs.ReadFile(site, name)
	if err != nil {
		name = "index.html"
		if data, err = fs.ReadFile(site, name); err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
	}
	h := w.Header()
	if ct, ok := contentTypes[path.Ext(name)]; ok {
		h.Set("Content-Type", ct)
	}
	if strings.HasPrefix(name, "assets/") {
		h.Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		h.Set("Cache-Control", "no-cache")
	}
	h.Set("Content-Security-Policy", csp)
	h.Set("Permissions-Policy", "hid=(self)")
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(data)
}

// lifecycle decides when the launcher should exit.
type lifecycle struct {
	mu       sync.Mutex
	started  time.Time
	lastBeat time.Time
	byeAt    time.Time
	exitedAt time.Time
	done     chan struct{}
	once     sync.Once
}

func newLifecycle() *lifecycle {
	l := &lifecycle{started: time.Now(), done: make(chan struct{})}
	go l.watch()
	return l
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

func (l *lifecycle) stop() { l.once.Do(func() { close(l.done) }) }
func (l *lifecycle) wait() { <-l.done }

func (l *lifecycle) watch() {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		select {
		case <-l.done:
			return
		case now := <-t.C:
			if l.shouldExit(now) {
				l.stop()
				return
			}
		}
	}
}

func (l *lifecycle) shouldExit(now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	seen := !l.lastBeat.IsZero()
	switch {
	case !seen && now.Sub(l.started) > firstLoadTimeout:
		return true // the window never loaded
	case seen && now.Sub(l.lastBeat) > silenceTimeout:
		return true // window gone without saying goodbye
	case !l.byeAt.IsZero() && l.lastBeat.Before(l.byeAt) && now.Sub(l.byeAt) > byeGrace:
		return true // closed (a reload would have sent a new heartbeat by now)
	case !l.exitedAt.IsZero() && now.Sub(l.exitedAt) > exitedGrace && (!seen || now.Sub(l.lastBeat) > exitedGrace):
		return true // our browser process ended and no window is talking to us
	}
	return false
}
