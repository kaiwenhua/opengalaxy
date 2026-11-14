//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

// showError displays a native message box (the exe has no console window).
func showError(msg string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	box := user32.NewProc("MessageBoxW")
	text, _ := syscall.UTF16PtrFromString(msg)
	title, _ := syscall.UTF16PtrFromString(appName)
	const mbOK, mbIconError = 0x0, 0x10
	_, _, _ = box.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), mbOK|mbIconError)
}
