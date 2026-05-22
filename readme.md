# Gnome Resource Monitor Extension

## This is a gnome extension that displays stats like CPU usage, RAM usage, DISK usage and Network I/O on the gnome top panel

<img width="1926" height="53" alt="image" src="https://github.com/user-attachments/assets/db13ea9a-aab6-4ada-a4f0-1abb14dc1eca" />
<img width="2143" height="662" alt="image" src="https://github.com/user-attachments/assets/9f85af5c-9125-4e2d-85d7-af9cd1a2a5b6" />
<img width="1853" height="793" alt="image" src="https://github.com/user-attachments/assets/9ebba08a-9c7d-40f9-951b-4c8804b7c7e5" />
<img width="1528" height="1252" alt="image" src="https://github.com/user-attachments/assets/1c90b40e-87ef-4981-8d5a-23fcc6b169ad" />


## How it works

It consists of a Backend and Frontend with backend made in **go** for speed and frontend is in Gnome JS **gjs**.

## Backend (go)

backend runs as a binary in the background when the extension start.
It handles all the intraction with the system to get all the system resources details, process them and then broadcast them to frontend through websockets.
For Development there is a static web page as well for testing purposes to verify if the stats and backend is working correctly.

### Frontned (gjs)

frontned uses gnome js which is a js library for creating gnome extensions.

## How to use

1. Clone the repo
2. cd into the repo
3. run the following command

```BASH
cp -r ./resource-monitor@saadofficial0999.com /home/<username>/.local/share/gnome-shell/extensions
```

replace the <username> with you username

4. restart you system

## For Development

### Prerequisite

1. go
2. gnome version 50 (tested)
3. mutter-devkit

### Steps to run

1. Clone repo
2. Cd into the repo
3. run the go backend

```BASH
go run cmd/main.go
```

let it run in background

4. Open a new terminal
5. Cd to the extension dir

```BASH
cd /home/<username>/.local/share/gnome-shell/extensions
```

6. start the virtual environment session

```BASH
dbus-run-session gnome-shell --devkit --wayland
```

7. After the session is running open a terminal in the session and cd back into the extensions dir

8. when inside the extensions dir run the following command

```BASH
gnome-extensions enable resource-monitor@saadofficial0999.com
```

9. DONE

### NOTE: if the top bar has a disconnected label then verify if you backend is running if not start the backend server and the label will go away and the stats will appear

## There might already be tools like this on the internet but i am passionate about programming and wanted to create my own tool.

## Again! Thanks for visiting my REPO.
