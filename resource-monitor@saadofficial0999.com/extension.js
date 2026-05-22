/* extension.js
 *
 * Resource Monitor — shows live CPU / RAM / DISK / NET in the GNOME top bar.
 *
 * How it works (the 10-second tour):
 *   - Your Go server (in ~/dev/go_sys_monitor) runs a WebSocket at
 *     ws://localhost:8080/stats and *pushes* a JSON snapshot once per second.
 *   - This file is the FRONTEND. It is written in GJS (GNOME's JavaScript).
 *   - GJS can open a WebSocket using the libsoup3 library (imported as `gi://Soup`).
 *   - Every time a JSON message arrives, we parse it and update one text label
 *     in the panel, plus a few detail rows in the click-down popup menu.
 *   - If the server is down, we show "disconnected" and retry every few seconds.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

// --- GObject-Introspection imports (the `gi://` ones are system libraries) ---
import GObject from "gi://GObject"; // lets us define a GObject subclass (the Indicator)
import St from "gi://St"; // "Shell Toolkit" — the widgets used in the shell UI
import Clutter from "gi://Clutter"; // low-level UI bits; we only need ActorAlign here
import Soup from "gi://Soup?version=3.0"; // libsoup3 — gives us a WebSocket client
import GLib from "gi://GLib"; // main-loop utilities; we use it for the retry timer
import Gio from "gi://Gio"; // we use Gio.Cancellable to abort cleanly on disable

// --- Shell-provided modules (the `resource://` ones come from gnome-shell itself) ---
import {
  Extension,
  gettext as _,
} from "resource:///org/gnome/shell/extensions/extension.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js"; // PanelMenu.Button
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js"; // the dropdown rows
import * as Main from "resource:///org/gnome/shell/ui/main.js"; // Main.panel etc.

// Config constants — change these if your server moves or you want a different retry speed.
const WS_URL = "ws://127.0.0.1:8080/stats"; // 127.0.0.1 (not "localhost") avoids IPv6 surprises
const RECONNECT_SECONDS = 3; // how long to wait before retrying a dead server

/*
 * The Indicator is the thing that lives in the top bar.
 * It extends PanelMenu.Button, which is a clickable panel item that owns a popup menu.
 *
 * GObject.registerClass(...) is boilerplate: every shell UI class must be registered
 * with the GObject type system before it can be instantiated.
 */
const Indicator = GObject.registerClass(
  class Indicator extends PanelMenu.Button {
    // _init is the constructor for GObject classes (not `constructor`).
    _init() {
      // 0.0 = how the menu aligns under the button; the string is for accessibility.
      super._init(0.0, _("Resource Monitor"));

      // ---- 1) The visible top-bar label ----
      // This single label holds the compact text, e.g.
      //   "CPU 15%  RAM 53%  DSK 42%  ↑0.1 KB/s ↓2.3 MB/s"
      this._label = new St.Label({
        text: _("Connecting…"),
        y_align: Clutter.ActorAlign.CENTER, // vertically center the text in the bar
        style_class: "resmon-label", // styled in stylesheet.css (monospace)
      });
      this.add_child(this._label);

      // ---- 2) The popup detail rows ----
      // Clicking the label opens a menu. We pre-create one row per piece of detail
      // and keep references in this._rows so we can update their text every second.
      // reactive:false = the rows are display-only (you can't "click" them).
      this._rows = {};
      for (const key of [
        "status",
        "host",
        "uptime",
        "cpu",
        "ram",
        "disk",
        "net",
      ]) {
        const item = new PopupMenu.PopupMenuItem("", { reactive: false });
        this.menu.addMenuItem(item);
        this._rows[key] = item;
      }

      // ---- 3) Networking state ----
      // _cancellable lets us abort an in-flight connection attempt when the
      // extension is disabled (otherwise the callback could fire after teardown).
      this._cancellable = new Gio.Cancellable();
      this._session = null; // the Soup.Session (our HTTP/WebSocket engine)
      this._connection = null; // the live Soup.WebsocketConnection once connected
      this._reconnectId = 0; // GLib timer id for the retry loop (0 = none scheduled)

      // Kick off the first connection attempt.
      this._connect();
    }

    // Open (or re-open) the WebSocket to the Go server.
    _connect() {
      this._session = new Soup.Session();

      // A WebSocket handshake is really an HTTP GET that gets "upgraded".
      const message = Soup.Message.new("GET", WS_URL);

      // Async connect. Arguments:
      //   message, origin, protocols, io_priority, cancellable, callback
      // We pass null for origin/protocols (not needed for a local tool).
      this._session.websocket_connect_async(
        message,
        null,
        null,
        GLib.PRIORITY_DEFAULT,
        this._cancellable,
        (session, result) => {
          // The callback runs once the connect attempt finishes (ok OR failed).
          try {
            // _finish() returns the connection, or THROWS if it failed
            // (e.g. server not running yet).
            this._connection = session.websocket_connect_finish(result);
          } catch (e) {
            // Server isn't up. Show disconnected and arrange a retry.
            this._setDisconnected();
            this._scheduleReconnect();
            return;
          }

          // Connected!
          this._rows.status.label.text = _("Status: connected");

          // 'message' fires every time the server pushes JSON (once/second).
          // Params are (connection, dataType, GLib.Bytes). We only need the bytes.
          this._connection.connect("message", (_conn, _type, bytes) => {
            this._render(bytes);
          });

          // If the socket closes or errors, mark disconnected and retry.
          const onDrop = () => {
            this._setDisconnected();
            this._scheduleReconnect();
          };
          this._connection.connect("closed", onDrop);
          this._connection.connect("error", onDrop);
        },
      );
    }

    // Turn one incoming JSON message into label text.
    _render(bytes) {
      try {
        // bytes is a GLib.Bytes (binary). get_data() -> Uint8Array, then decode to a
        // JS string, then JSON.parse. This is the GJS equivalent of the browser's
        // `JSON.parse(event.data)` in static/index.html.
        const text = new TextDecoder().decode(bytes.get_data());
        const data = JSON.parse(text);

        // The backend sends CPU usage PER CORE. Average them for one headline number.
        const cpu = Math.round(
          data.CPU.reduce((sum, core) => sum + core.Usage, 0) / data.CPU.length,
        );
        const ram = Math.round(data.MEM.Percentage); // already a percentage
        const disk = Math.round(data.Disk.usedPercent); // lowercase: gopsutil json tag
        const up = this._formatSpeed(data.Net.SendSpeed); // backend gives KB/s
        const down = this._formatSpeed(data.Net.ReceiveSpeed);

        // The compact top-bar string.
        this._label.text = `CPU ${cpu}%  RAM ${ram}%  DSK ${disk}%  ↑${up}  ↓${down}`;

        // The detail rows shown when you click the label.
        this._rows.host.label.text = `Host: ${data.HOST.Host} (${data.HOST.Os})`;
        this._rows.uptime.label.text = `Uptime: ${this._formatUptime(data.HOST.Uptime)}`;
        this._rows.cpu.label.text = `CPU: ${cpu}%  ${data.CPU[0]?.Model ?? ""}`;
        this._rows.ram.label.text = `RAM: ${this._formatMB(data.MEM.Used)} / ${this._formatMB(data.MEM.Total)} (${ram}%)`;
        this._rows.disk.label.text = `Disk /: ${this._formatBytes(data.Disk.used)} / ${this._formatBytes(data.Disk.total)} (${disk}%)`;
        this._rows.net.label.text = `Net: ↑${up} ↓${down}`;
      } catch (e) {
        // A single malformed packet should never crash the panel — just log it.
        logError(e, "resource-monitor: failed to render stats");
      }
    }

    // Update UI to the "no server" state.
    _setDisconnected() {
      this._label.text = _("⚠ disconnected");
      if (this._rows?.status)
        this._rows.status.label.text = _("Status: disconnected");
    }

    // Arrange a single retry RECONNECT_SECONDS from now (no-op if one is already pending).
    _scheduleReconnect() {
      if (this._reconnectId) return; // a retry is already queued; don't stack them

      this._reconnectId = GLib.timeout_add_seconds(
        GLib.PRIORITY_DEFAULT,
        RECONNECT_SECONDS,
        () => {
          this._reconnectId = 0; // this timer has fired; clear the id
          this._connect(); // try again
          return GLib.SOURCE_REMOVE; // run once, don't auto-repeat
        },
      );
    }

    // ---- formatting helpers (same math as static/index.html) ----

    // Net speed comes in KB/s. Show MB/s once it's big enough to read nicely.
    _formatSpeed(kb) {
      return kb >= 1024
        ? `${(kb / 1024).toFixed(1)} MB/s`
        : `${kb.toFixed(1)} KB/s`;
    }

    // Memory values from the backend are already in megabytes.
    _formatMB(mb) {
      return mb >= 1024
        ? `${(mb / 1024).toFixed(1)} GB`
        : `${mb.toFixed(0)} MB`;
    }

    // Disk values are raw bytes; pick a human-friendly unit.
    _formatBytes(bytes) {
      const units = ["B", "KB", "MB", "GB", "TB"];
      if (!bytes) return "0 B";
      const i = Math.floor(Math.log(bytes) / Math.log(1024));
      return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
    }

    // Uptime arrives in minutes; turn it into "1d 3h 12m".
    _formatUptime(minutes) {
      const d = Math.floor(minutes / 1440);
      const h = Math.floor((minutes % 1440) / 60);
      const m = minutes % 60;
      return [d && `${d}d`, (h || d) && `${h}h`, `${m}m`]
        .filter(Boolean)
        .join(" ");
    }

    // destroy() is called when the extension is disabled. Releasing every resource
    // here is REQUIRED — leaked timers/sockets can crash the shell on the next enable.
    destroy() {
      this._cancellable?.cancel(); // abort any connect that's still in flight

      if (this._reconnectId) {
        GLib.Source.remove(this._reconnectId); // cancel the pending retry timer
        this._reconnectId = 0;
      }

      if (this._connection) {
        try {
          this._connection.close(Soup.WebsocketCloseCode.NORMAL, null);
        } catch (e) {
          // already closed — ignore
        }
        this._connection = null;
      }

      this._session = null;

      super.destroy(); // let PanelMenu.Button tear down its own UI
    }
  },
);

// Path (inside this extension's own folder) to the compiled Go server binary.
// Built with:  go build -o <ext>/server/resource-monitor-server ./cmd
// Keeping it inside the extension makes the whole thing self-contained.
const SERVER_BINARY = ["server", "resource-monitor-server"];

// The Extension object is gnome-shell's entry point. enable()/disable() are called
// when the user (or login) turns the extension on and off.
export default class ResourceMonitorExtension extends Extension {
  enable() {
    // Start the backend FIRST so it has a head start binding the port. The
    // indicator's reconnect loop will connect as soon as the socket is up, so
    // we don't need to wait here.
    this._startServer();

    this._indicator = new Indicator();
    // Register the indicator in the panel's status area, keyed by the extension uuid.
    Main.panel.addToStatusArea(this.uuid, this._indicator);
  }

  disable() {
    // Tear down in reverse order: stop the UI (closes the WebSocket), then the server.
    this._indicator?.destroy();
    this._indicator = null;
    this._stopServer();
  }

  // Launch the Go server binary as a child process and keep a handle to it.
  _startServer() {
    // this.path is the absolute path to this extension's install folder.
    const binary = GLib.build_filenamev([this.path, ...SERVER_BINARY]);

    // If the binary isn't there (e.g. you haven't run `go build` yet), don't
    // crash — just skip. The indicator will still use a server you started by
    // hand, if one is running.
    if (!GLib.file_test(binary, GLib.FileTest.IS_EXECUTABLE)) {
      log(
        `resource-monitor: server binary not found at ${binary}; ` +
          `relying on an already-running server instead`,
      );
      this._server = null;
      return;
    }

    try {
      // Gio.Subprocess spawns and tracks a child process.
      // STDOUT_SILENCE drops the server's chatty prints ("Client Connected"…);
      // stderr is left inherited so real errors (e.g. "port in use") still land
      // in the gnome-shell journal.
      this._server = Gio.Subprocess.new(
        [binary],
        Gio.SubprocessFlags.STDOUT_SILENCE,
      );
    } catch (e) {
      // If the port is already taken, the binary exits on its own and the
      // indicator connects to whatever IS listening — so a failure here is safe.
      logError(e, "resource-monitor: failed to start server");
      this._server = null;
    }
  }

  // Stop the child process we started (no-op if we never started one).
  _stopServer() {
    if (!this._server) return;
    try {
      this._server.send_signal(15); // SIGTERM — ask it to exit
    } catch (e) {
      // already gone — ignore
    }
    this._server = null;
  }
}
