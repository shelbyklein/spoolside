#!/usr/bin/env node
// Spoolside MCP: lets Claude and Codex see and run the print farm through Spoolside's own API, so every
// action gets the same safety checks as the app (camera bed checks, AMS validation, order reservations).
//
// Config: SPOOLSIDE_URL (default https://spoolside.shelbyklein.com) and an API key from SPOOLSIDE_API_KEY
// or ~/.config/spoolside/api-key. Create keys on the server with `node server/apikey.mjs create <name>`.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.SPOOLSIDE_URL || "https://spoolside.shelbyklein.com").replace(/\/$/, "");
const keyFile = path.join(os.homedir(), ".config", "spoolside", "api-key");
const KEY = process.env.SPOOLSIDE_API_KEY || (fs.existsSync(keyFile) ? fs.readFileSync(keyFile, "utf8").trim() : "");

export async function api(route, { method = "GET", body, raw = false } = {}) {
  if (!KEY) throw Error(`No Spoolside API key. Put one in ${keyFile} or SPOOLSIDE_API_KEY.`);
  const r = await fetch(BASE + route, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  if (raw) {
    if (!r.ok) throw Error(`Spoolside answered ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(Error(data.error || `Spoolside answered ${r.status}`), { data });
  return data;
}

const jobName = (job = "") => job.replace(/^spoolside_/, "").replace(/(\.gcode)?\.3mf$/i, "").replace(/_/g, " ");
const text = (value) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const failure = (e) => ({ isError: true, content: [{ type: "text", text: e.message }] });
const tool = (fn) => async (args) => { try { return await fn(args || {}); } catch (e) { return failure(e); } };

// Printers can be named loosely: "membrane", "AMS 3" or the serial.
async function machines() {
  return (await api("/api/workspace")).machines || [];
}
export function findPrinter(list, name) {
  const wanted = String(name).trim().toLowerCase().replace(/\s+/g, " ");
  const hit = list.find((m) => m.id.toLowerCase() === wanted || m.name.toLowerCase() === wanted) || list.find((m) => m.name.toLowerCase().replace(/\s+/g, "") === wanted.replace(/\s+/g, ""));
  if (!hit) throw Error(`No printer called "${name}". Printers: ${list.map((m) => m.name).join(", ")}`);
  return hit;
}
async function printer(name) {
  return findPrinter(await machines(), name);
}

// Same slot choice as the app: the loaded tray of the same material family with the nearest color.
const family = (t) => String(t).replace(/-AMS$/i, "").split(/[\s-]/)[0].toUpperCase();
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(String(hex).slice(i, i + 2), 16) || 0);
const distance = (a, b) => rgb(a).reduce((n, v, i) => n + (v - rgb(b)[i]) ** 2, 0);
export function defaultMapping(plate, trays = []) {
  const loaded = trays.filter((t) => t.type);
  const slots = Math.max(0, ...plate.filaments.map((f) => f.id));
  const mapping = Array(slots).fill(-1);
  for (const f of plate.filaments) {
    const pool = loaded.filter((t) => family(t.type) === family(f.type));
    const best = [...(pool.length ? pool : loaded)].sort((a, b) => distance(a.color, f.color) - distance(b.color, f.color))[0];
    mapping[f.id - 1] = best ? best.slot : -1;
  }
  return mapping;
}

const describe = (m, repeat, held) => ({
  name: m.name,
  id: m.id,
  state: m.state,
  job: m.job ? jobName(m.job) : null,
  progress: m.state === "Printing" || m.state === "Paused" ? `${m.progress}% · ${m.remaining} left` : undefined,
  temps: m.nozzle != null ? `${Math.round(m.nozzle)}° nozzle · ${Math.round(m.bed ?? 0)}° bed` : undefined,
  filament: [...(m.trays || []).filter((t) => t.type).map((t) => `AMS slot ${t.slot + 1}: ${t.type} ${t.color}`), ...(m.external?.type ? [`External: ${m.external.type} ${m.external.color || ""}`.trim()] : [])],
  connected: m.connected && !m.stale,
  repeating: repeat ? `${repeat.name} · ${repeat.done}${repeat.times ? ` of ${repeat.times}` : " so far"} · ${repeat.status}` : undefined,
  waiting: held?.reason,
});

const server = new McpServer({ name: "spoolside", version: "0.1.0" }, {
  instructions:
    "Spoolside runs Shelby's Bambu Lab A1 mini print farm (AMS 2, AMS 3, Conductive, Desk, Membrane) and PlayCase order printing. " +
    "Start with `printers` for the state of the farm. Prints you start go through Spoolside's camera bed check; if it holds a start, " +
    "tell Shelby what the camera saw and only pass bed_is_clear: true after Shelby says the bed is clear. Never stop a print without being asked.",
});

server.registerTool("printers", {
  title: "Printers",
  description: "Every printer: state, current job and progress, temperatures, loaded filament, repeat status, and anything needing attention (watcher alerts, finished prints waiting for review, auto-print).",
  annotations: { readOnlyHint: true },
}, tool(async () => {
  const [list, repeats, dispatch, watches] = await Promise.all([machines(), api("/api/repeats"), api("/api/dispatch"), api("/api/watches")]);
  return text({
    printers: list.map((m) => describe(m, repeats.find((r) => r.printer === m.id), (dispatch.held || []).find((h) => h.printer === m.id))),
    autoPrint: dispatch.auto ? "on" : "off",
    alerts: (watches.watches || []).filter((w) => !w.ended && w.alert).map((w) => ({ printer: w.printerName, job: jobName(w.job), problem: w.alert.reason, paused: !!w.alert.paused })),
    reviewsWaiting: (watches.watches || []).filter((w) => w.ended && !w.outcome).length,
  });
}));

server.registerTool("camera", {
  title: "Camera photo",
  description: "A fresh photo from a printer's camera.",
  inputSchema: { printer: z.string().describe("Printer name or id, e.g. \"Membrane\"") },
  annotations: { readOnlyHint: true },
}, tool(async ({ printer: name }) => {
  const m = await printer(name);
  const jpeg = await api(`/api/printers/${encodeURIComponent(m.id)}/camera.jpg?t=${Date.now()}`, { raw: true });
  return { content: [{ type: "image", data: jpeg.toString("base64"), mimeType: "image/jpeg" }, { type: "text", text: `${m.name} · ${m.state}${m.job ? ` · ${jobName(m.job)}` : ""}` }] };
}));

server.registerTool("check_bed", {
  title: "Check the bed",
  description: "Asks Spoolside's camera check whether a printer's build plate is clear (the same check that runs before every start).",
  inputSchema: { printer: z.string() },
  annotations: { readOnlyHint: true },
}, tool(async ({ printer: name }) => {
  const m = await printer(name);
  const bed = await api(`/api/printers/${encodeURIComponent(m.id)}/bed-check`);
  return text(`${m.name}: ${bed.empty ? "the bed looks clear" : "not clear"}. ${bed.reason}`);
}));

server.registerTool("print_queue", {
  title: "Print queue",
  description: "PlayCase order pieces still to print, oldest order first, with what's blocking any of them, and whether auto-print is on.",
  annotations: { readOnlyHint: true },
}, tool(async () => {
  const [ws, dispatch] = await Promise.all([api("/api/workspace"), api("/api/dispatch")]);
  const orders = new Map((ws.orders || []).map((o) => [o.id, o]));
  return text({
    autoPrint: dispatch.auto ? "on" : "off",
    queue: (ws.printQueue || []).map((e) => {
      const o = orders.get(e.orderId), g = e.group;
      return {
        order: o?.number,
        piece: g?.label || "Order requirements",
        colorway: o?.items?.[Number(g?.key?.split(":")[0] || 0)]?.colorway || undefined,
        printed: g ? `${g.pieces.reduce((n, p) => n + p.done, 0)}/${g.pieces.reduce((n, p) => n + p.needed, 0)}` : undefined,
        next: g?.next ? `${g.next.name} (library ${g.next.fileId}, plate ${g.next.plate})` : undefined,
        blocked: e.blocked || undefined,
      };
    }),
    offers: (dispatch.offers || []).map((o) => `${o.printerName} is free: ${o.pieceName} for ${o.orderNumber} (${o.colorway})`),
  });
}));

server.registerTool("library", {
  title: "Sliced prints",
  description: "Search the library of sliced prints. Returns ids to pass to start_print, with each plate's time, weight and filaments.",
  inputSchema: {
    query: z.string().optional().describe("Words to match in the print name"),
    scope: z.enum(["playcase", "personal"]).optional(),
  },
  annotations: { readOnlyHint: true },
}, tool(async ({ query = "", scope }) => {
  const files = await api(`/api/library${scope ? `?scope=${scope}` : ""}`);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = files.filter((f) => words.every((w) => f.name.toLowerCase().includes(w)));
  return text(hits.slice(0, 40).map((f) => ({
    id: f.id,
    name: f.name,
    scope: f.scope,
    printer: f.preferredPrinterName || undefined,
    plates: f.plates.map((p) => `plate ${p.index}: ${p.minutes} min · ${p.grams} g · ${p.filaments.map((x) => `${x.type} ${x.color}`).join(", ") || "no filament info"}`),
  })).concat(hits.length > 40 ? [{ more: hits.length - 40 }] : []));
}));

server.registerTool("start_print", {
  title: "Start a print",
  description: "Start a sliced print from the library, or the printer's last print again (file: \"last\"). Spoolside checks the bed with the camera first and refuses if anything is on it.",
  inputSchema: {
    printer: z.string(),
    file: z.string().describe("Library id from `library`, or \"last\" to print the printer's last job again"),
    plate: z.number().int().optional().describe("Plate number; defaults to the first plate"),
    use_ams: z.boolean().optional().describe("Default: yes when the printer has AMS spools loaded"),
    ams_mapping: z.array(z.number().int()).optional().describe("AMS slot (0-3) per filament; default picks the closest loaded spool"),
    bed_leveling: z.boolean().optional().describe("Default true"),
    bed_is_clear: z.boolean().optional().describe("Skip the camera check. Only when Shelby has confirmed the bed is clear."),
  },
  annotations: { destructiveHint: false, openWorldHint: true },
}, tool(async ({ printer: name, file, plate, use_ams, ams_mapping, bed_leveling = true, bed_is_clear = false }) => {
  const m = await printer(name);
  const again = file === "last";
  const source = again ? await api(`/api/printers/${encodeURIComponent(m.id)}/last-print`) : (await api("/api/library")).find((f) => f.id === file);
  if (!source) throw Error(again ? `${m.name}'s last print isn't on its SD card anymore.` : `No library print with id ${file}. Use \`library\` to find one.`);
  const chosen = source.plates.find((p) => p.index === (plate ?? source.plates[0]?.index));
  if (!chosen) throw Error(`${source.name} has plates ${source.plates.map((p) => p.index).join(", ")}.`);
  const useAms = use_ams ?? (m.trays || []).some((t) => t.type);
  const amsMapping = useAms ? ams_mapping ?? defaultMapping(chosen, m.trays) : [];
  try {
    await api(`/api/printers/${encodeURIComponent(m.id)}/${again ? "reprint" : "print"}`, {
      method: "POST",
      body: { ...(again ? {} : { fileId: file }), plate: chosen.index, amsMapping, useAms, bedLevelling: bed_leveling, bedClear: bed_is_clear },
    });
  } catch (e) {
    if (e.data?.bed) return failure(Error(`Not started. ${e.message} Ask Shelby to clear the bed, or to confirm it's clear (then call again with bed_is_clear: true).`));
    throw e;
  }
  return text(`Started ${source.name}${source.plates.length > 1 ? ` plate ${chosen.index}` : ""} on ${m.name}${useAms ? ` (AMS slots ${amsMapping.map((s) => s + 1).join(", ")})` : " from the external spool"}.`);
}));

server.registerTool("control_print", {
  title: "Pause, resume or stop",
  description: "Pause, resume or stop the current print. Stopping can't be undone: only stop when Shelby asks.",
  inputSchema: { printer: z.string(), action: z.enum(["pause", "resume", "stop"]) },
  annotations: { destructiveHint: true },
}, tool(async ({ printer: name, action }) => {
  const m = await printer(name);
  await api(`/api/printers/${encodeURIComponent(m.id)}/${action}`, { method: "POST" });
  return text(`${m.name}: ${action === "stop" ? "print stopped" : action === "pause" ? "paused" : "resumed"}.`);
}));

server.registerTool("repeat", {
  title: "Repeat a print",
  description: "Repeat a printer's current or last print: each time it finishes and the camera sees the bed cleared, the same file starts again. action \"stop\" turns it off.",
  inputSchema: {
    printer: z.string(),
    action: z.enum(["start", "stop"]),
    times: z.number().int().min(1).max(500).optional().describe("How many more prints; omit to repeat until stopped"),
    plate: z.number().int().optional(),
    use_ams: z.boolean().optional(),
    ams_mapping: z.array(z.number().int()).optional(),
    bed_leveling: z.boolean().optional().describe("Default false for repeats"),
  },
}, tool(async ({ printer: name, action, times, plate, use_ams, ams_mapping, bed_leveling = false }) => {
  const m = await printer(name);
  if (action === "stop") {
    await api(`/api/printers/${encodeURIComponent(m.id)}/repeat`, { method: "DELETE" });
    return text(`${m.name} stopped repeating.`);
  }
  const last = await api(`/api/printers/${encodeURIComponent(m.id)}/last-print`);
  if (!last) throw Error(`${m.name}'s current print isn't on its SD card, so it can't be repeated.`);
  const chosen = last.plates.find((p) => p.index === (plate ?? last.plates[0]?.index));
  if (!chosen) throw Error(`${last.name} has plates ${last.plates.map((p) => p.index).join(", ")}.`);
  const useAms = use_ams ?? (m.trays || []).some((t) => t.type);
  await api(`/api/printers/${encodeURIComponent(m.id)}/repeat`, {
    method: "POST",
    body: { plate: chosen.index, amsMapping: useAms ? ams_mapping ?? defaultMapping(chosen, m.trays) : [], useAms, bedLevelling: bed_leveling, times: times ?? null },
  });
  return text(`${m.name} will repeat ${last.name}${times ? ` ${times} more times` : " until stopped"}, starting again each time the camera sees the bed cleared.`);
}));

server.registerTool("auto_print", {
  title: "Auto-print",
  description: "Turn auto-print on or off: free printers with the right TPU loaded start the next queued order piece once the camera sees an empty bed.",
  inputSchema: { on: z.boolean() },
}, tool(async ({ on }) => {
  await api("/api/dispatch/auto", { method: "POST", body: { on } });
  return text(`Auto-print is ${on ? "on" : "off"}.`);
}));

server.registerTool("reviews", {
  title: "Prints to review",
  description: "Finished prints waiting for an optional review, with ids for review_print.",
  annotations: { readOnlyHint: true },
}, tool(async () => {
  const { watches = [] } = await api("/api/watches");
  const asks = watches.filter((w) => w.ended && !w.outcome);
  return text(asks.length ? asks.map((w) => ({ id: w.id, job: jobName(w.job), printer: w.printerName, ended: `${w.endedAs} ${new Date(w.ended).toLocaleString()}`, order: w.order || undefined, note: w.note || undefined })) : "No prints waiting for review.");
}));

server.registerTool("review_print", {
  title: "Review a print",
  description: "Record how a finished print came out (fine or failed, with an optional note), or delete the review. Marking an order print failed puts its pieces back in the queue.",
  inputSchema: {
    id: z.string().describe("Review id from `reviews`"),
    outcome: z.enum(["fine", "failed", "delete"]),
    note: z.string().max(500).optional(),
  },
}, tool(async ({ id, outcome, note }) => {
  if (outcome === "delete") await api(`/api/watches/${encodeURIComponent(id)}/skip`, { method: "POST" });
  else await api(`/api/watches/${encodeURIComponent(id)}/outcome`, { method: "POST", body: note === undefined ? { success: outcome === "fine" } : { success: outcome === "fine", note } });
  return text(outcome === "delete" ? "Review deleted." : `Saved as ${outcome === "fine" ? "came out fine" : "failed"}.`);
}));

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("server.mjs")) {
  await server.connect(new StdioServerTransport());
}
