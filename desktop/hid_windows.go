//go:build windows

package main

import (
	"errors"
	"fmt"
	"syscall"
	"time"
	"unsafe"
)

// Minimal native HID access via SetupAPI + hid.dll (the same calls the vendor driver
// uses), so the launcher can send feature reports after the browser window has closed.

var (
	setupapi                         = syscall.NewLazyDLL("setupapi.dll")
	procSetupDiGetClassDevsW         = setupapi.NewProc("SetupDiGetClassDevsW")
	procSetupDiEnumDeviceInterfaces  = setupapi.NewProc("SetupDiEnumDeviceInterfaces")
	procSetupDiGetDeviceInterfaceDtl = setupapi.NewProc("SetupDiGetDeviceInterfaceDetailW")
	procSetupDiDestroyDeviceInfoList = setupapi.NewProc("SetupDiDestroyDeviceInfoList")

	hiddll                    = syscall.NewLazyDLL("hid.dll")
	procHidDGetHidGuid        = hiddll.NewProc("HidD_GetHidGuid")
	procHidDGetAttributes     = hiddll.NewProc("HidD_GetAttributes")
	procHidDGetPreparsedData  = hiddll.NewProc("HidD_GetPreparsedData")
	procHidDFreePreparsedData = hiddll.NewProc("HidD_FreePreparsedData")
	procHidPGetCaps           = hiddll.NewProc("HidP_GetCaps")
	procHidDSetFeature        = hiddll.NewProc("HidD_SetFeature")
	procHidDGetFeature        = hiddll.NewProc("HidD_GetFeature")
)

type guid struct {
	Data1 uint32
	Data2 uint16
	Data3 uint16
	Data4 [8]byte
}

type spDeviceInterfaceData struct {
	CbSize             uint32
	InterfaceClassGuid guid
	Flags              uint32
	Reserved           uintptr
}

type hiddAttributes struct {
	Size          uint32
	VendorID      uint16
	ProductID     uint16
	VersionNumber uint16
}

type hidpCaps struct {
	Usage                   uint16
	UsagePage               uint16
	InputReportByteLength   uint16
	OutputReportByteLength  uint16
	FeatureReportByteLength uint16
	Rest                    [27]uint16
}

const (
	digcfPresent         = 0x02
	digcfDeviceInterface = 0x10
	hidpStatusSuccess    = 0x00110000
	invalidHandle        = ^uintptr(0)
)

type hidDevice struct {
	handle     syscall.Handle
	featureLen int
}

// openHID finds the HID interface with the given VID/PID and usage page.
func openHID(vid, pid, usagePage uint16) (*hidDevice, error) {
	var hidGuid guid
	procHidDGetHidGuid.Call(uintptr(unsafe.Pointer(&hidGuid)))

	set, _, err := procSetupDiGetClassDevsW.Call(uintptr(unsafe.Pointer(&hidGuid)), 0, 0, digcfPresent|digcfDeviceInterface)
	if set == invalidHandle {
		return nil, fmt.Errorf("SetupDiGetClassDevs: %v", err)
	}
	defer procSetupDiDestroyDeviceInfoList.Call(set)

	for i := uint32(0); ; i++ {
		var ifData spDeviceInterfaceData
		ifData.CbSize = uint32(unsafe.Sizeof(ifData))
		ok, _, _ := procSetupDiEnumDeviceInterfaces.Call(set, 0, uintptr(unsafe.Pointer(&hidGuid)), uintptr(i), uintptr(unsafe.Pointer(&ifData)))
		if ok == 0 {
			break // no more interfaces
		}
		path, err := interfacePath(set, &ifData)
		if err != nil {
			continue
		}
		if dev := tryOpen(path, vid, pid, usagePage); dev != nil {
			return dev, nil
		}
	}
	return nil, fmt.Errorf("keyboard %04X:%04X (usage page %04X) not found", vid, pid, usagePage)
}

func interfacePath(set uintptr, ifData *spDeviceInterfaceData) (string, error) {
	var required uint32
	procSetupDiGetDeviceInterfaceDtl.Call(set, uintptr(unsafe.Pointer(ifData)), 0, 0, uintptr(unsafe.Pointer(&required)), 0)
	if required < 6 {
		return "", errors.New("no interface detail")
	}
	buf := make([]byte, required)
	// cbSize of SP_DEVICE_INTERFACE_DETAIL_DATA_W: 8 on 64-bit, 6 on 32-bit.
	cb := uint32(6)
	if unsafe.Sizeof(uintptr(0)) == 8 {
		cb = 8
	}
	*(*uint32)(unsafe.Pointer(&buf[0])) = cb
	ok, _, err := procSetupDiGetDeviceInterfaceDtl.Call(set, uintptr(unsafe.Pointer(ifData)), uintptr(unsafe.Pointer(&buf[0])), uintptr(required), 0, 0)
	if ok == 0 {
		return "", err
	}
	u16 := unsafe.Slice((*uint16)(unsafe.Pointer(&buf[4])), (len(buf)-4)/2)
	return syscall.UTF16ToString(u16), nil
}

func tryOpen(path string, vid, pid, usagePage uint16) *hidDevice {
	p, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return nil
	}
	h, err := syscall.CreateFile(p, syscall.GENERIC_READ|syscall.GENERIC_WRITE,
		syscall.FILE_SHARE_READ|syscall.FILE_SHARE_WRITE, nil, syscall.OPEN_EXISTING, 0, 0)
	if err != nil {
		return nil
	}
	keep := false
	defer func() {
		if !keep {
			syscall.CloseHandle(h)
		}
	}()

	var attr hiddAttributes
	attr.Size = uint32(unsafe.Sizeof(attr))
	if ok, _, _ := procHidDGetAttributes.Call(uintptr(h), uintptr(unsafe.Pointer(&attr))); ok == 0 {
		return nil
	}
	if attr.VendorID != vid || attr.ProductID != pid {
		return nil
	}
	var pre uintptr
	if ok, _, _ := procHidDGetPreparsedData.Call(uintptr(h), uintptr(unsafe.Pointer(&pre))); ok == 0 {
		return nil
	}
	var caps hidpCaps
	status, _, _ := procHidPGetCaps.Call(pre, uintptr(unsafe.Pointer(&caps)))
	procHidDFreePreparsedData.Call(pre)
	if status != hidpStatusSuccess || caps.UsagePage != usagePage || caps.FeatureReportByteLength < 2 {
		return nil
	}
	keep = true
	return &hidDevice{handle: h, featureLen: int(caps.FeatureReportByteLength)}
}

func (d *hidDevice) close() { syscall.CloseHandle(d.handle) }

// setFeature sends a feature report with report ID 0 (data is zero-padded).
func (d *hidDevice) setFeature(data []byte) error {
	buf := make([]byte, d.featureLen)
	copy(buf[1:], data)
	ok, _, err := procHidDSetFeature.Call(uintptr(d.handle), uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	if ok == 0 {
		return fmt.Errorf("HidD_SetFeature: %v", err)
	}
	return nil
}

// getFeature reads feature report 0 and returns its payload (without the report ID).
func (d *hidDevice) getFeature() ([]byte, error) {
	buf := make([]byte, d.featureLen)
	ok, _, err := procHidDGetFeature.Call(uintptr(d.handle), uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	if ok == 0 {
		return nil, fmt.Errorf("HidD_GetFeature: %v", err)
	}
	return buf[1:], nil
}

// replayPlan sends a recorded packet sequence. A "get" step polls the readback until it
// echoes the previous "set" (the keyboard may still be busy), like the web app does.
func replayPlan(p *exitPlan) error {
	dev, err := openHID(p.VendorID, p.ProductID, p.UsagePage)
	if err != nil {
		return err
	}
	defer dev.close()

	var last []byte
	for i, s := range p.Steps {
		switch s.Op {
		case "set":
			if err := dev.setFeature(s.Data); err != nil {
				return fmt.Errorf("step %d: %w", i, err)
			}
			last = s.Data
		case "get":
			acked := false
			for attempt := 0; attempt < 25 && !acked; attempt++ {
				if attempt > 0 {
					time.Sleep(20 * time.Millisecond)
				}
				res, err := dev.getFeature()
				if err != nil {
					return fmt.Errorf("step %d: %w", i, err)
				}
				acked = len(last) < 2 || (len(res) >= 2 && res[0] == last[0] && res[1] == last[1])
			}
			if !acked {
				return fmt.Errorf("step %d: keyboard did not acknowledge % x", i, last[:2])
			}
		}
		time.Sleep(time.Duration(s.DelayMs) * time.Millisecond)
	}
	return nil
}
