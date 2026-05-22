package monitor

import (
	"fmt"
	"math"
	"time"

	"github.com/DataDog/gopsutil/cpu"
	"github.com/DataDog/gopsutil/disk"
	"github.com/DataDog/gopsutil/host"
	"github.com/DataDog/gopsutil/mem"
	"github.com/DataDog/gopsutil/net"
)

var prevBytesSent uint64 = 0
var prevBytesRecv uint64 = 0

type HostInfo struct {
	Host   string
	Uptime int64
	Os     string
	Id     string
}

type CpuInfo struct {
	Core  int
	Model string
	Usage int64
}

type MemInfo struct {
	Total      float64
	Used       float64
	Percentage float64
	Free       float64
}

type NetInfo struct {
	SendSpeed    float64
	ReceiveSpeed float64
}

const kilobyte uint64 = 1024
const megabyte uint64 = kilobyte * 1024
const gigabyte uint64 = megabyte * 1024

func GetHostInfo() (HostInfo, error) {
	var hostInfo HostInfo
	info, err := host.Info()
	if err != nil {
		fmt.Printf("Error fetching host info, %v", err)
		return hostInfo, err
	}
	hostInfo.Host = info.Hostname
	hostInfo.Uptime = int64(info.Uptime / 60)
	hostInfo.Os = info.Platform
	hostInfo.Id = info.HostID
	return hostInfo, nil
}

func GetCpuInfo() ([]CpuInfo, error) {
	var cpuInfo []CpuInfo
	info, err := cpu.Info()
	if err != nil {
		fmt.Printf("Error fetching cpu info, %v", err)
		return cpuInfo, nil
	}
	usage, err := cpu.Percent(time.Second, true)
	if err != nil {
		fmt.Printf("Error fetching cpu usage, %v \n", err)
		return cpuInfo, nil
	}
	for i, val := range info {
		info := CpuInfo{
			Core:  int(val.CPU),
			Model: val.ModelName,
			Usage: int64(usage[i]),
		}
		cpuInfo = append(cpuInfo, info)
	}

	return cpuInfo, nil
}

func GetRamInfo() (MemInfo, error) {
	var info MemInfo
	memInfo, err := mem.VirtualMemory()
	if err != nil {
		fmt.Printf("Error fetching mem info: %v", err)
		return info, err
	}
	info = MemInfo{
		Total:      math.Round((float64(memInfo.Total)/float64(megabyte))*100) / 100,
		Used:       math.Round((float64(memInfo.Used)/float64(megabyte))*100) / 100,
		Free:       math.Round((float64(memInfo.Free)/float64(megabyte))*100) / 100,
		Percentage: math.Round(memInfo.UsedPercent*100) / 100,
	}
	return info, nil
}

func GetDiskInfo() (*disk.UsageStat, error) {
	var info *disk.UsageStat
	info, err := disk.Usage("/")
	if err != nil {
		fmt.Printf("Error fetching disk info: %v", err)
		return info, err
	}

	return info, nil
}

func GetNetInfo() (*NetInfo, error) {
	var netInfo *NetInfo
	info, err := net.IOCounters(false)
	if err != nil {
		fmt.Printf("Error fetching net info: %v", err)
		return netInfo, err
	}
	sentSpeed := (info[0].BytesSent - prevBytesSent)
	receiveSpeed := (info[0].BytesRecv - prevBytesRecv)
	netInfo = &NetInfo{
		SendSpeed:    math.Round((float64(sentSpeed)/float64(kilobyte))*100) / 100,
		ReceiveSpeed: math.Round((float64(receiveSpeed)/float64(kilobyte))*100) / 100,
	}
	prevBytesSent = info[0].BytesSent
	prevBytesRecv = info[0].BytesRecv
	return netInfo, nil
}
