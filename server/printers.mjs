import mqtt from "mqtt";
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
  snapshot() {
    return this.configs.map((c) => printerView(c, this.records.get(c.serial)));
  }
  close() {
    this.timers.forEach(clearInterval);
    this.clients.forEach((c) => c.end(true));
  }
}
