package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
	"time"
)

func TestWindowGoneSingleWindow(t *testing.T) {
	l := newLifecycle()
	since := time.Now()
	l.heartbeat("a")
	if l.windowGone(since, time.Now(), false) {
		t.Fatal("open window reported as gone")
	}
	l.bye("a")
	if l.windowGone(since, time.Now().Add(byeGrace/2), false) {
		t.Fatal("gone before the grace period (a reload would still check in)")
	}
	if !l.windowGone(since, time.Now().Add(byeGrace+time.Second), false) {
		t.Fatal("closed window not reported as gone")
	}
}

func TestWindowGoneReload(t *testing.T) {
	l := newLifecycle()
	since := time.Now()
	l.heartbeat("a")
	l.bye("a")       // reload: old page says goodbye…
	l.heartbeat("b") // …and the new one checks in
	if l.windowGone(since, time.Now().Add(byeGrace+time.Second), false) {
		t.Fatal("reload treated as closing the app")
	}
}

// The bug: with two windows open, closing one made the launcher think the app had closed.
func TestWindowGoneTwoWindows(t *testing.T) {
	l := newLifecycle()
	since := time.Now()
	l.heartbeat("a")
	l.heartbeat("b")
	l.bye("a")
	if l.windowGone(since, time.Now().Add(byeGrace+2*time.Second), false) {
		t.Fatal("closing one of two windows treated as closing the app")
	}
	l.bye("b")
	if !l.windowGone(since, time.Now().Add(byeGrace+time.Second), false) {
		t.Fatal("closing the last window not detected")
	}
}

// Same scenario through the real HTTP handler, as two browser windows would send it.
func TestTwoWindowsOverHTTP(t *testing.T) {
	life := newLifecycle()
	since := time.Now()
	h := newHandler(fstest.MapFS{"index.html": {Data: []byte("x")}}, 47180, life)
	post := func(path string) int {
		req := httptest.NewRequest(http.MethodPost, path, nil)
		req.Host = "127.0.0.1:47180"
		req.Header.Set("Origin", "http://127.0.0.1:47180")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	for _, p := range []string{"/__opengalaxy/heartbeat?page=win1", "/__opengalaxy/heartbeat?page=win2", "/__opengalaxy/bye?page=win1"} {
		if code := post(p); code != http.StatusNoContent {
			t.Fatalf("%s: %d", p, code)
		}
	}
	if life.windowGone(since, time.Now().Add(byeGrace+2*time.Second), false) {
		t.Fatal("closing window 1 of 2 treated as closing the app")
	}
	post("/__opengalaxy/bye?page=win2")
	if !life.windowGone(since, time.Now().Add(byeGrace+time.Second), false) {
		t.Fatal("closing the last window not detected")
	}
}

func TestWindowGoneSilentWindowExpires(t *testing.T) {
	l := newLifecycle()
	since := time.Now()
	l.heartbeat("a")
	if !l.windowGone(since, time.Now().Add(silenceTimeout+time.Second), false) {
		t.Fatal("window that went silent (crashed) never reported as gone")
	}
}
