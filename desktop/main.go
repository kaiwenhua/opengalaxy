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
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
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

	exe, _ := os.Executable()
	logf("start build %s (%s)", version, exe)

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", preferredPort))
	if err != nil {
		if running, ok := runningBuild(preferredPort); ok {
			if running == version {
				// Same build already running: just open another window of it.
				logf("build %s already running, opening another window", running)
				browser, err := findBrowser()
				if err != nil {
					return err
				}
				return browserCommand(browser, appURL(preferredPort), profile).Start()
			}
			// A different (older) build is running. Don't hand the user its outdated app:
			// ask it to quit, then take over.
			logf("replacing running build %s", running)
			if err := askToQuit(preferredPort); err != nil {
				return fmt.Errorf("an older OpenGalaxy (%s) is still running.\nClose its window, wait a few seconds and start again.", running)
			}
			ln, err = listenWhenFree(preferredPort, 10*time.Second)
			if err != nil {
				return fmt.Errorf("the previous OpenGalaxy did not exit: %w", err)
			}
			time.Sleep(1500 * time.Millisecond) // let its browser profile unlock
		} else if ln, err = net.Listen("tcp", "127.0.0.1:0"); err != nil {
			// Port taken by something else: fall back to a random port. Works, but this
			// session gets a different origin (separate settings and permission).
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
			life.requestQuit()
		}
	}()

	browser, err := findBrowser()
	if err != nil {
		return err
	}
	openWindow := func() *exec.Cmd {
		cmd := browserCommand(browser, appURL(port), profile)
		if err := cmd.Start(); err != nil {
			logf("could not start %s: %v", filepath.Base(browser), err)
			return nil
		}
		return cmd
	}
	cmd := openWindow()
	if cmd == nil {
		return fmt.Errorf("could not start %s", filepath.Base(browser))
	}
	browserDone := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		close(browserDone)
		life.browserExited()
	}()

	session, ownBrowser := time.Now(), true
	for {
		if !life.waitWindowGone(session, ownBrowser) {
			break // quit requested
		}
		// Close the dedicated browser instance too, in case it keeps running in the background.
		select {
		case <-browserDone:
		default:
			_ = cmd.Process.Kill()
		}
		wave := life.currentWave()
		if wave == nil || runtime.GOOS != "windows" {
			break
		}
		// Custom wave: the keyboard can't animate it by itself, so keep it running from here.
		if !runInBackground(wave, life, openWindow) {
			break // "Stop wave and quit"
		}
		// The window was reopened and took over; wait for it to go away again.
		session, ownBrowser = time.Now(), false
	}
	_ = srv.Close()

	// Send whatever the page asked to be stored on exit (e.g. a Custom wave still image).
	p := life.takePlan()
	if p == nil {
		logf("exit (no exit plan)")
	} else {
		start := time.Now()
		if err := replayPlan(p); err != nil {
			logf("exit plan failed after %v: %v", time.Since(start).Round(time.Millisecond), err)
		} else {
			logf("exit plan sent: %d steps in %v", len(p.Steps), time.Since(start).Round(time.Millisecond))
		}
	}
	return nil
}

// runInBackground keeps the Custom wave running with a tray icon until the user either
// reopens the window (returns true: the page takes over streaming) or picks "Stop wave and
// quit" (returns false).
func runInBackground(wave *waveSpec, life *lifecycle, openWindow func() *exec.Cmd) bool {
	logf("window closed: Custom wave continues in the background")
	stop := make(chan struct{})
	streamDone := make(chan struct{})
	go func() {
		streamWave(wave, stop)
		close(streamDone)
	}()
	quit := make(chan struct{})
	var quitOnce sync.Once
	t := showTray(
		"OpenGalaxy – Custom wave running",
		"Your Custom wave keeps running",
		"OpenGalaxy stays in the background so the wave keeps moving. Right-click the tray icon to open it or to stop.",
		func() { go openWindow() },
		func() { quitOnce.Do(func() { close(quit) }) },
	)
	since := time.Now()
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	reopened := false
loop:
	for {
		select {
		case <-quit:
			break loop
		case <-life.quit:
			break loop
		case <-ticker.C:
			// A page checked in again (tray "Open" or the exe started again): hand over.
			if life.windowOpened(since) {
				reopened = true
				break loop
			}
		}
	}
	close(stop)
	<-streamDone
	t.close()
	if reopened {
		logf("window reopened: it takes over the Custom wave")
	} else {
		logf("background wave stopped by the user")
	}
	return reopened
}

// logf appends a line to %LOCALAPPDATA%\OpenGalaxy\launcher.log (kept small) for
// troubleshooting, since the launcher has no console window.
func logf(format string, args ...any) {
	base, err := os.UserCacheDir()
	if err != nil {
		return
	}
	path := filepath.Join(base, appName, "launcher.log")
	if st, err := os.Stat(path); err == nil && st.Size() > 256<<10 {
		_ = os.Remove(path)
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintf(f, "%s %s\n", time.Now().Format(time.RFC3339), fmt.Sprintf(format, args...))
}

func appURL(port int) string {
	return fmt.Sprintf("http://127.0.0.1:%d/", port)
}

// runningBuild reports whether an OpenGalaxy launcher already serves the port, and its build.
func runningBuild(port int) (string, bool) {
	client := http.Client{Timeout: 800 * time.Millisecond}
	res, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d%s", port, pingPath))
	if err != nil {
		return "", false
	}
	defer res.Body.Close()
	build := res.Header.Get("X-OpenGalaxy")
	return build, res.StatusCode == http.StatusOK && build != ""
}

// askToQuit tells a running launcher to exit (it still runs its exit plan first).
func askToQuit(port int) error {
	req, _ := http.NewRequest(http.MethodPost, fmt.Sprintf("http://127.0.0.1:%d%s", port, quitPath), nil)
	req.Header.Set(quitHeader, "1")
	res, err := (&http.Client{Timeout: 2 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		return fmt.Errorf("running launcher answered %s", res.Status)
	}
	return nil
}

func listenWhenFree(port int, timeout time.Duration) (net.Listener, error) {
	deadline := time.Now().Add(timeout)
	for {
		ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		if err == nil || time.Now().After(deadline) {
			return ln, err
		}
		time.Sleep(250 * time.Millisecond)
	}
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
