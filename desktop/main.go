// OpenGalaxy portable launcher.
//
// A single executable that needs no installation:
//   - serves the bundled web app (embedded at build time) on 127.0.0.1, which browsers
//     treat as a secure origin, so WebHID keyboard access works without HTTPS
//   - opens it in Edge/Chrome "app mode" (own window, no tabs or address bar) with a
//     dedicated browser profile that keeps settings and the keyboard permission
//   - exits by itself once the window is closed (page heartbeats + goodbye beacon)
//
// Build with `npm run desktop` from the repository root.
package main

import (
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

//go:embed all:web
var embedded embed.FS

// Set at build time via -ldflags "-X main.version=…".
var version = "dev"

const (
	appName = "OpenGalaxy"
	// Fixed port: the browser stores settings and the HID permission per origin,
	// so the address must stay the same between launches.
	preferredPort = 47180
)

func main() {
	if err := run(); err != nil {
		showError(fmt.Sprintf("%s could not start:\n\n%v", appName, err))
		os.Exit(1)
	}
}

func run() error {
	site, err := fs.Sub(embedded, "web")
	if err != nil {
		return err
	}
	if _, err := fs.Stat(site, "index.html"); err != nil {
		return errors.New("the app files are missing from this build (run `npm run desktop`)")
	}

	profile, err := profileDir()
	if err != nil {
		return err
	}

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", preferredPort))
	if err != nil {
		// Already running? Then just open another window of the running instance.
		if isOurServer(preferredPort) {
			browser, err := findBrowser()
			if err != nil {
				return err
			}
			cmd := browserCommand(browser, appURL(preferredPort), profile)
			return cmd.Start()
		}
		// Port taken by something else: fall back to a random port. Works, but this
		// session gets a different origin (separate settings and permission).
		if ln, err = net.Listen("tcp", "127.0.0.1:0"); err != nil {
			return fmt.Errorf("could not open a local port: %w", err)
		}
	}
	port := ln.Addr().(*net.TCPAddr).Port

	life := newLifecycle()
	srv := &http.Server{
		Handler:           newHandler(site, port, life),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			life.stop()
		}
	}()

	browser, err := findBrowser()
	if err != nil {
		return err
	}
	cmd := browserCommand(browser, appURL(port), profile)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("could not start %s: %w", filepath.Base(browser), err)
	}
	browserDone := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		close(browserDone)
		life.browserExited()
	}()

	life.wait()

	// Close the dedicated browser instance too, in case it keeps running in the background.
	select {
	case <-browserDone:
	default:
		_ = cmd.Process.Kill()
	}
	_ = srv.Close()
	return nil
}

func appURL(port int) string {
	return fmt.Sprintf("http://127.0.0.1:%d/", port)
}

// isOurServer reports whether an OpenGalaxy launcher already serves the given port.
func isOurServer(port int) bool {
	client := http.Client{Timeout: 800 * time.Millisecond}
	res, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d%s", port, pingPath))
	if err != nil {
		return false
	}
	defer res.Body.Close()
	return res.StatusCode == http.StatusOK && res.Header.Get("X-OpenGalaxy") != ""
}

// profileDir returns the browser profile folder. A folder named "OpenGalaxyData" next to
// the executable enables fully portable mode (e.g. on a USB stick); otherwise the profile
// lives in %LOCALAPPDATA%\OpenGalaxy.
func profileDir() (string, error) {
	if exe, err := os.Executable(); err == nil {
		portable := filepath.Join(filepath.Dir(exe), "OpenGalaxyData")
		if st, err := os.Stat(portable); err == nil && st.IsDir() {
			return filepath.Join(portable, "Browser"), nil
		}
	}
	base, err := os.UserCacheDir() // %LOCALAPPDATA% on Windows
	if err != nil {
		return "", fmt.Errorf("no folder for settings: %w", err)
	}
	dir := filepath.Join(base, appName, "Browser")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("could not create %s: %w", dir, err)
	}
	return dir, nil
}
