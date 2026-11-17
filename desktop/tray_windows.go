//go:build windows

package main

import (
	"runtime"
	"syscall"
	"unsafe"
)

// A minimal notification-area (tray) icon using plain Win32 calls: shown while the Custom
// wave runs in the background, with "Open OpenGalaxy" and "Stop wave and quit".

var (
	user32               = syscall.NewLazyDLL("user32.dll")
	shell32              = syscall.NewLazyDLL("shell32.dll")
	kernel32             = syscall.NewLazyDLL("kernel32.dll")
	procRegisterClassExW = user32.NewProc("RegisterClassExW")
	procCreateWindowExW  = user32.NewProc("CreateWindowExW")
	procDefWindowProcW   = user32.NewProc("DefWindowProcW")
	procDestroyWindow    = user32.NewProc("DestroyWindow")
	procGetMessageW      = user32.NewProc("GetMessageW")
	procTranslateMessage = user32.NewProc("TranslateMessage")
	procDispatchMessageW = user32.NewProc("DispatchMessageW")
	procPostMessageW     = user32.NewProc("PostMessageW")
	procPostQuitMessage  = user32.NewProc("PostQuitMessage")
	procCreatePopupMenu  = user32.NewProc("CreatePopupMenu")
	procAppendMenuW      = user32.NewProc("AppendMenuW")
	procTrackPopupMenu   = user32.NewProc("TrackPopupMenu")
	procDestroyMenu      = user32.NewProc("DestroyMenu")
	procSetForegroundWin = user32.NewProc("SetForegroundWindow")
	procGetCursorPos     = user32.NewProc("GetCursorPos")
	procLoadImageW       = user32.NewProc("LoadImageW")
	procLoadIconW        = user32.NewProc("LoadIconW")
	procGetSystemMetrics = user32.NewProc("GetSystemMetrics")
	procShellNotifyIconW = shell32.NewProc("Shell_NotifyIconW")
	procGetModuleHandleW = kernel32.NewProc("GetModuleHandleW")
)

const (
	wmDestroy     = 0x0002
	wmClose       = 0x0010
	wmNull        = 0x0000
	wmApp         = 0x8000
	wmTrayCB      = wmApp + 1
	wmLButtonUp   = 0x0202
	wmRButtonUp   = 0x0205
	wmContextMenu = 0x007B

	nimAdd    = 0
	nimDelete = 2
	nifMsg    = 0x01
	nifIcon   = 0x02
	nifTip    = 0x04
	nifInfo   = 0x10
	niifInfo  = 0x01

	mfString       = 0x0000
	mfSeparator    = 0x0800
	mfGrayed       = 0x0001
	tpmReturnCmd   = 0x0100
	tpmNoNotify    = 0x0080
	tpmRightAlign  = 0x0008
	tpmBottomAlign = 0x0020

	cmdOpen = 1
	cmdQuit = 2
)

type wndClassEx struct {
	CbSize        uint32
	Style         uint32
	LpfnWndProc   uintptr
	CbClsExtra    int32
	CbWndExtra    int32
	HInstance     uintptr
	HIcon         uintptr
	HCursor       uintptr
	HbrBackground uintptr
	LpszMenuName  *uint16
	LpszClassName *uint16
	HIconSm       uintptr
}

type notifyIconData struct {
	CbSize           uint32
	HWnd             uintptr
	UID              uint32
	UFlags           uint32
	UCallbackMessage uint32
	HIcon            uintptr
	SzTip            [128]uint16
	DwState          uint32
	DwStateMask      uint32
	SzInfo           [256]uint16
	UVersion         uint32
	SzInfoTitle      [64]uint16
	DwInfoFlags      uint32
	GuidItem         [16]byte
	HBalloonIcon     uintptr
}

type msg struct {
	HWnd    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      struct{ X, Y int32 }
}

// tray is a running tray icon. Its callbacks run on the tray's own OS thread.
type tray struct {
	hwnd uintptr
	done chan struct{}
}

var (
	trayOnOpen func()
	trayOnQuit func()
	trayProc   = syscall.NewCallback(trayWndProc)
)

// showTray adds the icon and returns once it is visible. onOpen/onQuit are called from the
// tray thread when the user picks a menu entry.
func showTray(tip, balloonTitle, balloon string, onOpen, onQuit func()) *tray {
	trayOnOpen, trayOnQuit = onOpen, onQuit
	t := &tray{done: make(chan struct{})}
	ready := make(chan struct{})
	go func() {
		runtime.LockOSThread()
		defer close(t.done)
		hInst, _, _ := procGetModuleHandleW.Call(0)
		className, _ := syscall.UTF16PtrFromString("OpenGalaxyTray")
		wc := wndClassEx{LpfnWndProc: trayProc, HInstance: hInst, LpszClassName: className}
		wc.CbSize = uint32(unsafe.Sizeof(wc))
		procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))
		title, _ := syscall.UTF16PtrFromString(appName)
		// A normal (never shown) top-level window: menus need a window that can take focus.
		hwnd, _, _ := procCreateWindowExW.Call(0, uintptr(unsafe.Pointer(className)), uintptr(unsafe.Pointer(title)),
			0, 0, 0, 0, 0, 0, 0, hInst, 0)
		t.hwnd = hwnd

		nid := notifyIconData{HWnd: hwnd, UID: 1, UFlags: nifMsg | nifIcon | nifTip | nifInfo, UCallbackMessage: wmTrayCB}
		nid.CbSize = uint32(unsafe.Sizeof(nid))
		nid.HIcon = loadAppIcon(hInst)
		copyUTF16(nid.SzTip[:], tip)
		copyUTF16(nid.SzInfoTitle[:], balloonTitle)
		copyUTF16(nid.SzInfo[:], balloon)
		nid.DwInfoFlags = niifInfo
		procShellNotifyIconW.Call(nimAdd, uintptr(unsafe.Pointer(&nid)))
		close(ready)

		var m msg
		for {
			r, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
			if r == 0 || int32(r) == -1 {
				break
			}
			procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
			procDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
		}
		del := notifyIconData{HWnd: hwnd, UID: 1}
		del.CbSize = uint32(unsafe.Sizeof(del))
		procShellNotifyIconW.Call(nimDelete, uintptr(unsafe.Pointer(&del)))
	}()
	<-ready
	return t
}

// close removes the icon and ends the tray thread.
func (t *tray) close() {
	if t == nil {
		return
	}
	procPostMessageW.Call(t.hwnd, wmClose, 0, 0)
	<-t.done
}

func trayWndProc(hwnd, message, wParam, lParam uintptr) uintptr {
	switch message {
	case wmTrayCB:
		switch lParam & 0xffff {
		case wmLButtonUp, wmRButtonUp, wmContextMenu:
			switch showTrayMenu(hwnd) {
			case cmdOpen:
				if trayOnOpen != nil {
					trayOnOpen()
				}
			case cmdQuit:
				if trayOnQuit != nil {
					trayOnQuit()
				}
			}
		}
		return 0
	case wmClose:
		procDestroyWindow.Call(hwnd)
		return 0
	case wmDestroy:
		procPostQuitMessage.Call(0)
		return 0
	}
	r, _, _ := procDefWindowProcW.Call(hwnd, message, wParam, lParam)
	return r
}

func showTrayMenu(hwnd uintptr) uintptr {
	menu, _, _ := procCreatePopupMenu.Call()
	defer procDestroyMenu.Call(menu)
	add := func(flags, id uintptr, text string) {
		p, _ := syscall.UTF16PtrFromString(text)
		procAppendMenuW.Call(menu, flags, id, uintptr(unsafe.Pointer(p)))
	}
	add(mfString|mfGrayed, 0, "OpenGalaxy – Custom wave running")
	add(mfSeparator, 0, "")
	add(mfString, cmdOpen, "Open OpenGalaxy")
	add(mfString, cmdQuit, "Stop wave and quit")
	var pt struct{ X, Y int32 }
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	procSetForegroundWin.Call(hwnd) // so the menu closes when clicking elsewhere
	cmd, _, _ := procTrackPopupMenu.Call(menu, tpmReturnCmd|tpmNoNotify|tpmRightAlign|tpmBottomAlign,
		uintptr(pt.X), uintptr(pt.Y), 0, hwnd, 0)
	procPostMessageW.Call(hwnd, wmNull, 0, 0)
	return cmd
}

// loadAppIcon loads the exe's own icon (resource "APP" from go-winres), falling back to
// the default application icon.
func loadAppIcon(hInst uintptr) uintptr {
	name, _ := syscall.UTF16PtrFromString("APP")
	const imageIcon, smCxSmIcon, smCySmIcon = 1, 49, 50
	cx, _, _ := procGetSystemMetrics.Call(smCxSmIcon)
	cy, _, _ := procGetSystemMetrics.Call(smCySmIcon)
	if h, _, _ := procLoadImageW.Call(hInst, uintptr(unsafe.Pointer(name)), imageIcon, cx, cy, 0); h != 0 {
		return h
	}
	const idiApplication = 32512
	h, _, _ := procLoadIconW.Call(0, idiApplication)
	return h
}

func copyUTF16(dst []uint16, s string) {
	u, _ := syscall.UTF16FromString(s)
	if len(u) > len(dst) {
		u = u[:len(dst)-1]
		u = append(u, 0)
	}
	copy(dst, u)
}
