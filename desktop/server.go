package main

import (
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"time"
)

const (
	pingPath      = "/__opengalaxy/ping"
	heartbeatPath = "/__opengalaxy/heartbeat"
	byePath       = "/__opengalaxy/bye"
	onExitPath    = "/__opengalaxy/on-exit"
	wavePath      = "/__opengalaxy/background"
	quitPath      = "/__opengalaxy/quit"
	// Custom header for quit: browsers can't send it cross-site without a CORS preflight
	// (which this server never approves), so only local programs like a newer launcher can.
	quitHeader = "X-OpenGalaxy-Quit"
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
			page := r.URL.Query().Get("page")
			if len(page) > 64 {
				page = page[:64]
			}
			if r.URL.Path == heartbeatPath {
				life.heartbeat(page)
			} else {
				life.bye(page)
			}
			w.WriteHeader(http.StatusNoContent)
			return
		case onExitPath, wavePath:
			// Only the app's own page may hand over packets or a wave: same origin and JSON
			// (cross-site "simple" requests can't send application/json without CORS).
			if r.Method != http.MethodPost || r.Header.Get("Origin") != origin ||
				!strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			if r.URL.Path == onExitPath {
				handlePlan(w, r, life)
				return
			}
			wave, err := parseWaveSpec(r.Body)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			life.setWave(wave)
			w.WriteHeader(http.StatusNoContent)
			return
		case quitPath:
			if r.Method != http.MethodPost || r.Header.Get(quitHeader) != "1" || r.Header.Get("Origin") != "" {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			logf("quit requested by a newer launcher")
			w.WriteHeader(http.StatusNoContent)
			go life.requestQuit()
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
