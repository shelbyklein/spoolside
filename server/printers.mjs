import mqtt from "mqtt";
import { Client as FtpClient } from "basic-ftp";
import tls from "node:tls";
export function mergeTelemetry(prior, update) {
  return { ...prior, ...update };
}
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
      color: t.tray_type && t.tray_color ? "#" + t.tray_color.slice(0, 6) : "",
    })),
    external: data.vt_tray?.tray_type ? { type: data.vt_tray.tray_type, color: "#" + (data.vt_tray.tray_color || "").slice(0, 6) } : null,
    seen: record?.seen ? new Date(record.seen).toISOString() : null,
    connected,
    stale,
    error: record?.error || null,
  };
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
  async upload(config, localFile, remoteName) {
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
      await ftp.uploadFrom(localFile, "/" + remoteName);
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
      await this.request(serial, {
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
      }, 20000);
    } finally {
      this.busy.delete(serial);
    }
  }
  // One still from the printer's camera (A1 series: JPEG frames over TLS on port 6000,
  // pinned like MQTT). Connects only when asked; repeat requests within 3 s share a frame.
  cameraFrame(serial) {
    const { config } = this.printer(serial);
    this.frames ??= new Map();
    const cached = this.frames.get(serial);
    if (cached && Date.now() - cached.at < 3000) return cached.frame;
    const frame = new Promise((resolve, reject) => {
      const auth = Buffer.alloc(80);
      auth.writeUInt32LE(0x40, 0);
      auth.writeUInt32LE(0x3000, 4);
      auth.write("bblp", 16, "ascii");
      auth.write(config.accessCode, 48, "ascii");
      let buf = Buffer.alloc(0);
      const socket = tls.connect({
        host: config.ip, port: 6000, ca: config.certificate, allowPartialTrustChain: true, rejectUnauthorized: true,
        checkServerIdentity: (_host, cert) => (cert.fingerprint256 === config.fingerprint ? undefined : new Error("Printer certificate changed")),
      }, () => socket.write(auth));
      const finish = (err, jpg) => { clearTimeout(timer); socket.destroy(); err ? reject(err) : resolve(jpg); };
      const timer = setTimeout(() => finish(Object.assign(Error("Camera did not send a picture"), { status: 504 })), 10000);
      socket.on("data", (d) => {
        buf = Buffer.concat([buf, d]);
        if (buf.length < 16) return;
        const size = buf.readUInt32LE(0);
        if (size > 5_000_000) return finish(Object.assign(Error("Unexpected camera data"), { status: 502 }));
        if (buf.length >= 16 + size) {
          const jpg = buf.subarray(16, 16 + size);
          jpg[0] === 0xff && jpg[1] === 0xd8 ? finish(null, jpg) : finish(Object.assign(Error("Unexpected camera data"), { status: 502 }));
        }
      });
      socket.on("error", () => finish(Object.assign(Error("Camera unavailable"), { status: 502 })));
    });
    this.frames.set(serial, { at: Date.now(), frame });
    frame.catch(() => this.frames.delete(serial));
    return frame;
  }
  snapshot() {
    return this.configs.map((c) => printerView(c, this.records.get(c.serial)));
  }
  close() {
    this.timers.forEach(clearInterval);
    this.clients.forEach((c) => c.end(true));
  }
}
