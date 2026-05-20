package server

import (
	"fmt"
	"log"
	"net/http"
	"system_monitor/internal/monitor"
	"time"

	"github.com/DataDog/gopsutil/disk"
	"github.com/gorilla/websocket"
)

type WSResponse struct {
	HOST monitor.HostInfo
	CPU  []monitor.CpuInfo
	MEM  monitor.MemInfo
	Disk disk.UsageStat
}

func HandleServer() {
	var upgrader = websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
	}

	fs := http.FileServer(http.Dir("./static"))
	http.Handle("/", fs)

	http.HandleFunc("/stats", func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			fmt.Println("Failed to upgrade connetion")
			return
		}

		defer conn.Close()

		fmt.Println("Client Connected")

		for {
			time.Sleep(time.Second)
			ramInfo, err := monitor.GetRamInfo()
			if err != nil {
				http.Error(w, "Failed to get RAM info", http.StatusInternalServerError)
				return
			}
			cpuInfo, err := monitor.GetCpuInfo()
			if err != nil {
				http.Error(w, "Failed to get RAM info", http.StatusInternalServerError)
				return
			}
			hostInfo, err := monitor.GetHostInfo()
			if err != nil {
				http.Error(w, "Failed to get RAM info", http.StatusInternalServerError)
				return
			}
			diskInfo, err := monitor.GetDiskInfo()
			if err != nil {
				http.Error(w, "Failed to get Disk info", http.StatusInternalServerError)
				return
			}
			if err := conn.WriteJSON(WSResponse{
				HOST: hostInfo,
				CPU:  cpuInfo,
				MEM:  ramInfo,
				Disk: *diskInfo,
			}); err != nil {
				fmt.Println("Write error:", err)
				break
			}
		}
	})

	fmt.Println("Server Started on http://localhost:8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
