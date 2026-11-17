package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// findBrowser returns a Chromium-based browser with WebHID support: Edge first (it ships
// with every Windows 10/11 install), then Chrome, then Brave/Chromium.
func findBrowser() (string, error) {
	var candidates []string
	switch runtime.GOOS {
	case "windows":
		roots := []string{os.Getenv("ProgramFiles(x86)"), os.Getenv("ProgramFiles"), os.Getenv("LOCALAPPDATA")}
		rel := []string{
			`Microsoft\Edge\Application\msedge.exe`,
			`Google\Chrome\Application\chrome.exe`,
			`BraveSoftware\Brave-Browser\Application\brave.exe`,
			`Chromium\Application\chrome.exe`,
		}
		for _, r := range rel {
			for _, root := range roots {
				if root != "" {
					candidates = append(candidates, filepath.Join(root, r))
				}
			}
		}
	case "darwin":
		candidates = []string{
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
		}
	default:
		for _, name := range []string{"microsoft-edge", "google-chrome", "google-chrome-stable", "brave-browser", "chromium", "chromium-browser"} {
			if p, err := exec.LookPath(name); err == nil {
				candidates = append(candidates, p)
			}
		}
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c, nil
		}
	}
	return "", errors.New("no Microsoft Edge or Google Chrome found. OpenGalaxy needs one of them for keyboard access (WebHID)")
}

// browserCommand opens url as a standalone app window with its own profile. The separate
// profile keeps the window independent of the user's normal browser (so the process
// lives exactly as long as our window) and stores settings + the HID permission.
func browserCommand(browser, url, profile string) *exec.Cmd {
	args := []string{
		"--app=" + url,
		"--user-data-dir=" + profile,
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-sync",
		"--window-size=1280,900",
	}
	// Development aid for automated end-to-end tests: OPENGALAXY_DEBUG_PORT=9333
	// exposes the window via the DevTools protocol on localhost.
	if p := os.Getenv("OPENGALAXY_DEBUG_PORT"); p != "" {
		args = append(args, "--remote-debugging-port="+p)
	}
	return exec.Command(browser, args...)
}
