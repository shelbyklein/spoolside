import mqtt from "mqtt";
import { Client as FtpClient } from "basic-ftp";
import tls from "node:tls";
import { Writable } from "node:stream";
import { inspect3mf, zipEntries, zipRead } from "./library.mjs";
export function mergeTelemetry(prior, update) {
  return { ...prior, ...update };
}
// Bambu filament codes (from the spool's RFID tag) for the materials Spoolside restocks.
const MATERIALS = { GFU02: "bambu-tpu-ams" };
// Bambu colors are RRGGBBAA; a zero alpha means no color was set.
const trayColor = (c) => (c && c.length >= 6 && c.slice(6, 8) !== "00" ? "#" + c.slice(0, 6) : "");
export function printerView(config, record, now = Date.now()) {
  const data = record?.data || {},
    stale = !record?.seen || now - record.seen > 90000,
    connected = !!record?.connected && !stale;
  const raw = data.gcode_state;
  const state = !connected
    ? "Offline"
    : raw === "RUNNING"
      ? "Printing"
      : raw === "PAUSE"
        ? "Paused"
        : raw === "FAILED"
          ? "Error"
          : raw === "PREPARE" ? "Preparing" : ["FINISH", "IDLE"].includes(raw) ? "Ready" : "Unknown";
  return {
    id: config.serial,
    name: config.name,
    model: "Bambu Lab A1 mini",
    state,
    rawState: raw || null,
    job: data.subtask_name || data.gcode_file || "No print information",
    progress: Number(data.mc_percent || 0),
    remaining:
      data.mc_remaining_time == null ? "—" : `${data.mc_remaining_time} min`,
    material: "Filament not mapped",
    nozzle: data.nozzle_temper ?? null,
    bed: data.bed_temper ?? null,
    layer: data.layer_num ?? null,
    totalLayers: data.total_layer_num ?? null,
    trays: (data.ams?.ams?.[0]?.tray || []).map((t) => ({
      slot: Number(t.id),
      type: t.tray_type || "",
      color: t.tray_type ? trayColor(t.tray_color) : "",
      name: t.tray_type ? t.tray_sub_brands || t.tray_type : "",
      // The AMS estimates what's left only for Bambu RFID spools; -1 means unknown.
      remain: t.tray_type && Number(t.remain) >= 0 ? Number(t.remain) : null,
      grams: t.tray_type && Number(t.remain) >= 0 && Number(t.tray_weight) > 0 ? Math.round((Number(t.tray_weight) * Number(t.remain)) / 100) : null,
      materialId: MATERIALS[t.tray_info_idx] || null,
    })),
    external: data.vt_tray?.tray_type ? { type: data.vt_tray.tray_type, color: trayColor(data.vt_tray.tray_color), name: data.vt_tray.tray_sub_brands || data.vt_tray.tray_type } : null,
    // Which spool feeds the nozzle: an AMS slot, or 254 for the external spool.
    feeding: data.ams?.tray_now == null ? null : Number(data.ams.tray_now),
    hasAms: Number(data.ams?.ams_exist_bits || 0) > 0,
    seen: record?.seen ? new Date(record.seen).toISOString() : null,
    connected,
    stale,
    error: record?.error || null,
  };
}
// Finds the file a printer's last job came from: Bambu Studio keeps the file name; Spoolside uploads as spoolside_<name>.3mf.
export function findLastFile(subtask, entries) {
  const base = String(subtask).replace(/(\.gcode)?\.3mf$/i, "");
  const names = [subtask, base + ".gcode.3mf", base + ".3mf", "spoolside_" + base.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 60) + ".3mf"];
  for (const n of names) {
    const hit = entries.find((e) => e.isFile !== false && e.type !== 2 && e.name === n);
    if (hit) return hit;
  }
  return null;
}
export class Printers {
  constructor(configs = []) {
    this.configs = configs;
    this.records = new Map();
    this.clients = [];
    this.timers = [];
    this.byId = new Map();
    this.waiters = new Map();
    this.busy = new Set();
  }
  start() {
    for (const config of this.configs) {
      const record = { data: {}, connected: false, seen: null, error: null };
      this.records.set(config.serial, record);
      const client = mqtt.connect(`mqtts://${config.ip}:8883`, {
        username: "bblp",
        password: config.accessCode,
        clientId: `spoolside_${config.serial}`,
        ca: config.certificate,
        allowPartialTrustChain: true,
        rejectUnauthorized: true,
        checkServerIdentity: (_host, cert) =>
          cert.fingerprint256 === config.fingerprint
            ? undefined
            : new Error("Printer certificate changed"),
        connectTimeout: 10000,
        reconnectPeriod: 10000,
      });
      this.clients.push(client);
      this.byId.set(config.serial, { config, client, record });
      const snapshot = () => {
        if (client.connected)
          client.publish(
            `device/${config.serial}/request`,
            JSON.stringify({
              pushing: { sequence_id: "0", command: "pushall" },
            }),
          );
      };
      client.on("connect", () => {
        record.connected = true;
        record.error = null;
        client.subscribe(`device/${config.serial}/report`, (error) => {
          if (error) {
            record.error = "Could not subscribe to printer status";
            return;
          }
          snapshot();
        });
      });
      client.on("message", (_topic, payload) => {
        try {
          const { print } = JSON.parse(payload);
          if (print?.command && this.waiters.has(`${config.serial}:${print.sequence_id}`)) {
            this.waiters.get(`${config.serial}:${print.sequence_id}`)(print);
          }
          if (print) {
            record.data = mergeTelemetry(record.data, print);
            record.seen = Date.now();
            record.error = null;
          }
        } catch {
          record.error = "Invalid printer telemetry";
        }
      });
      client.on("error", () => {
        record.error =
          "Printer connection failed; check network or access code";
        record.connected = false;
      });
      client.on("close", () => (record.connected = false));
      this.timers.push(setInterval(snapshot, 60000));
    }
  }
  printer(serial) {
    const entry = this.byId.get(serial);
    if (!entry) throw Object.assign(Error("Unknown printer"), { status: 404 });
    const view = printerView(entry.config, entry.record);
    if (!view.connected) throw Object.assign(Error("Printer is offline"), { status: 409 });
    return { ...entry, view };
  }
  // Every printer's status plus the raw report, for the print watcher.
  statuses() {
    return [...this.byId.entries()].map(([serial, { config, record }]) => ({ serial, view: printerView(config, record), data: record.data || {} }));
  }
  // Publishes a print command and waits for the printer's acknowledgement.
  request(serial, print, timeout = 10000) {
    const { client } = this.byId.get(serial);
    const seq = String(Date.now() % 1e9);
    return new Promise((resolve, reject) => {
      const key = `${serial}:${seq}`;
      const timer = setTimeout(() => { this.waiters.delete(key); reject(Object.assign(Error("Printer did not respond"), { status: 504 })); }, timeout);
      this.waiters.set(key, (reply) => {
        clearTimeout(timer);
        this.waiters.delete(key);
        reply.result && String(reply.result).toLowerCase() !== "success"
          ? reject(Object.assign(Error(reply.reason || "Printer rejected the command"), { status: 409 }))
          : resolve(reply);
      });
      client.publish(`device/${serial}/request`, JSON.stringify({ print: { ...print, sequence_id: seq } }));
    });
  }
  async control(serial, action) {
    const { view } = this.printer(serial);
    const allowed = { pause: ["RUNNING", "PREPARE"], resume: ["PAUSE"], stop: ["RUNNING", "PAUSE", "PREPARE"] }[action];
    if (!allowed) throw Object.assign(Error("Unknown action"), { status: 400 });
    if (!allowed.includes(view.rawState)) throw Object.assign(Error(`Can't ${action} while ${view.state.toLowerCase()}`), { status: 409 });
    await this.request(serial, { command: action, param: "" });
  }
  async ftp(config) {
    const ftp = new FtpClient(60000);
    try {
      await ftp.access({
        host: config.ip,
        port: 990,
        user: "bblp",
        password: config.accessCode,
        secure: "implicit",
        secureOptions: {
          ca: config.certificate,
          allowPartialTrustChain: true,
          rejectUnauthorized: true,
          checkServerIdentity: (_host, cert) => cert.fingerprint256 === config.fingerprint ? undefined : new Error("Printer certificate changed"),
        },
      });
    } catch (e) {
      ftp.close();
      throw e;
    }
    return ftp;
  }
  async upload(config, localFile, remoteName) {
    const ftp = await this.ftp(config);
    try {
      await ftp.uploadFrom(localFile, "/" + remoteName);
    } finally {
      ftp.close();
    }
  }
  // Read the reviewed job, rather than whichever job telemetry currently calls last.
  async downloadPrint(serial, job) {
    const { config } = this.printer(serial);
    const ftp = await this.ftp(config);
    try {
      const entry = findLastFile(job, await ftp.list("/"));
      if (!entry) throw Error("This print file is no longer on the printer’s SD card. Upload the sliced file from Orca instead.");
      if (entry.size > 95_000_000) throw Error("This file exceeds the 95 MB library limit");
      const chunks = [];
      let size = 0;
      await ftp.downloadTo(new Writable({ write(chunk, _enc, done) {
        size += chunk.length;
        if (size > 95_000_000) return done(Error("This file exceeds the 95 MB library limit"));
        chunks.push(chunk); done();
      } }), "/" + entry.name);
      return { name: entry.name, buf: Buffer.concat(chunks) };
    } finally { ftp.close(); }
  }
  // The last job's sliced file, if it's still on the SD card: its name and plates, so it can be printed again.
  async lastPrint(serial) {
    const { config, record } = this.printer(serial);
    const subtask = record.data?.subtask_name;
    if (!subtask) return null;
    const ftp = await this.ftp(config);
    try {
      const entry = findLastFile(subtask, await ftp.list("/"));
      if (!entry) return null;
      const key = `${entry.name}:${entry.size}:${entry.rawModifiedAt}`;
      this.lastPrints ??= new Map();
      const cached = this.lastPrints.get(serial);
      if (cached?.key === key) return cached.value;
      if (entry.size > 200_000_000) return null;
      const chunks = [];
      await ftp.downloadTo(new Writable({ write(chunk, _enc, done) { chunks.push(chunk); done(); } }), "/" + entry.name);
      const buf = Buffer.concat(chunks), { plates } = inspect3mf(buf), entries = zipEntries(buf);
      // The slicer's preview of each plate: what the finished print should look like.
      const previews = Object.fromEntries(plates.flatMap((p) => {
        const e = entries.get(`Metadata/plate_${p.index}.png`);
        return e ? [[p.index, zipRead(buf, e)]] : [];
      }));
      const value = { remoteName: entry.name, subtask, previews, name: entry.name.replace(/^spoolside_/, "").replace(/(\.gcode)?\.3mf$/i, "").replace(/_/g, " "), plates };
      this.lastPrints.set(serial, { key, value });
      return value;
    } catch (e) {
      if (/sliced/.test(e.message)) return null;
      throw e;
    } finally {
      ftp.close();
    }
  }
  // Uploads a sliced file to the printer's SD card and starts it.
  async startPrint(serial, { localFile, name, plate, amsMapping, useAms, bedLevelling }) {
    const { config, view } = this.printer(serial);
    if (!["IDLE", "FINISH", "FAILED"].includes(view.rawState)) throw Object.assign(Error(`Printer is ${view.state.toLowerCase()}`), { status: 409 });
    if (this.busy.has(serial)) throw Object.assign(Error("A print is already being sent to this printer"), { status: 409 });
    this.busy.add(serial);
    try {
      const remoteName = "spoolside_" + name.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 60) + ".3mf";
      await this.upload(config, localFile, remoteName);
      await this.sendProject(serial, { remoteName, name, plate, amsMapping, useAms, bedLevelling });
    } finally {
      this.busy.delete(serial);
    }
  }
  // Starts the last job again straight from the SD card, no upload.
  async reprint(serial, { plate, amsMapping, useAms, bedLevelling }) {
    const { view } = this.printer(serial);
    if (!["IDLE", "FINISH", "FAILED"].includes(view.rawState)) throw Object.assign(Error(`Printer is ${view.state.toLowerCase()}`), { status: 409 });
    if (this.busy.has(serial)) throw Object.assign(Error("A print is already being sent to this printer"), { status: 409 });
    this.busy.add(serial);
    try {
      const last = this.lastPrints?.get(serial)?.value;
      if (!last) throw Object.assign(Error("The last print isn't on the printer anymore"), { status: 404 });
      await this.sendProject(serial, { remoteName: last.remoteName, name: last.subtask, plate, amsMapping, useAms, bedLevelling });
    } finally {
      this.busy.delete(serial);
    }
  }
  consumeStart(serial, job, plate) {
    const sent = this.sentStarts?.get(serial);
    if (!sent || sent.name !== job || sent.plate !== plate || Date.now()-sent.at > 120000) return false;
    this.sentStarts.delete(serial);
    return true;
  }
  async sendProject(serial, { remoteName, name, plate, amsMapping, useAms, bedLevelling }) {
    this.sentStarts ??= new Map();
    const sent = {name, plate, at:Date.now()};
    this.sentStarts.set(serial,sent);
    try { return await this.request(serial, {
      command: "project_file",
      param: `Metadata/plate_${plate}.gcode`,
      project_id: "0",
      profile_id: "0",
      task_id: "0",
      subtask_id: "0",
      subtask_name: name,
      file: remoteName,
      url: `file:///sdcard/${remoteName}`,
      md5: "",
      timelapse: false,
      bed_type: "auto",
      bed_levelling: !!bedLevelling,
      flow_cali: false,
      vibration_cali: false,
      layer_inspect: false,
      use_ams: !!useAms,
      ams_mapping: useAms ? amsMapping : [],
    }, 20000); }
    catch (e) { if (this.sentStarts.get(serial) === sent) this.sentStarts.delete(serial); throw e; }
  }
  // Opens the printer's camera (A1 series: JPEG frames over TLS on port 6000, pinned like MQTT)
  // and calls onFrame for each frame. Returns the socket; onEnd runs once when it closes or fails.
  cameraSocket(config, onFrame, onEnd) {
    const auth = Buffer.alloc(80);
    auth.writeUInt32LE(0x40, 0);
    auth.writeUInt32LE(0x3000, 4);
    auth.write("bblp", 16, "ascii");
    auth.write(config.accessCode, 48, "ascii");
    let buf = Buffer.alloc(0), ended = false;
    const end = (err) => { if (!ended) { ended = true; socket.destroy(); onEnd(err); } };
    const socket = tls.connect({
      host: config.ip, port: 6000, ca: config.certificate, allowPartialTrustChain: true, rejectUnauthorized: true,
      checkServerIdentity: (_host, cert) => (cert.fingerprint256 === config.fingerprint ? undefined : new Error("Printer certificate changed")),
    }, () => socket.write(auth));
    socket.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 16) {
        const size = buf.readUInt32LE(0);
        if (size > 5_000_000) return end(Object.assign(Error("Unexpected camera data"), { status: 502 }));
        if (buf.length < 16 + size) return;
        const jpg = Buffer.from(buf.subarray(16, 16 + size));
        buf = buf.subarray(16 + size);
        if (jpg[0] !== 0xff || jpg[1] !== 0xd8) return end(Object.assign(Error("Unexpected camera data"), { status: 502 }));
        onFrame(jpg);
      }
    });
    socket.on("error", () => end(Object.assign(Error("Camera unavailable"), { status: 502 })));
    socket.on("close", () => end(Object.assign(Error("Camera unavailable"), { status: 502 })));
    return socket;
  }
  // One still from the camera. Uses the live feed's newest frame when one is open; otherwise
  // connects just for this, and repeat requests within 3 s share a frame.
  cameraFrame(serial) {
    const { config } = this.printer(serial);
    const live = this.feeds?.get(serial)?.latest;
    if (live && Date.now() - live.at < 3000) return Promise.resolve(live.jpeg);
    this.frames ??= new Map();
    const cached = this.frames.get(serial);
    if (cached && Date.now() - cached.at < 3000) return cached.frame;
    const frame = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.destroy(); reject(Object.assign(Error("Camera did not send a picture"), { status: 504 })); }, 10000);
      const socket = this.cameraSocket(config, (jpg) => { clearTimeout(timer); socket.destroy(); resolve(jpg); }, (err) => { clearTimeout(timer); reject(err); });
    });
    this.frames.set(serial, { at: Date.now(), frame });
    frame.catch(() => this.frames.delete(serial));
    return frame;
  }
  // The live feed: while someone is watching (asked within 30 s), keep the camera connection open
  // and hold its newest frame (about one every 2 s on the A1 mini), so each request answers at once.
  liveFrame(serial) {
    const { config } = this.printer(serial);
    this.feeds ??= new Map();
    let feed = this.feeds.get(serial);
    if (!feed) {
      feed = { latest: null, waiters: [], wanted: Date.now() };
      const settle = (fn) => { const ws = feed.waiters; feed.waiters = []; ws.forEach(fn); };
      feed.socket = this.cameraSocket(config, (jpeg) => {
        feed.latest = { jpeg, at: Date.now() };
        settle((w) => w.resolve(feed.latest));
      }, (err) => {
        clearInterval(feed.idle);
        if (this.feeds.get(serial) === feed) this.feeds.delete(serial);
        settle((w) => w.reject(err));
      });
      feed.idle = setInterval(() => Date.now() - feed.wanted > 30000 && feed.socket.destroy(), 5000);
      this.feeds.set(serial, feed);
    }
    feed.wanted = Date.now();
    if (feed.latest && Date.now() - feed.latest.at < 10000) return Promise.resolve(feed.latest);
    return new Promise((resolve, reject) => {
      const waiter = { resolve: (f) => { clearTimeout(timer); resolve(f); }, reject: (e) => { clearTimeout(timer); reject(e); } };
      const timer = setTimeout(() => {
        feed.waiters = feed.waiters.filter((w) => w !== waiter);
        reject(Object.assign(Error("Camera did not send a picture"), { status: 504 }));
      }, 12000);
      feed.waiters.push(waiter);
    });
  }
  snapshot() {
    return this.configs.map((c) => printerView(c, this.records.get(c.serial)));
  }
  close() {
    this.feeds?.forEach((f) => f.socket.destroy());
    this.timers.forEach(clearInterval);
    this.clients.forEach((c) => c.end(true));
  }
}
