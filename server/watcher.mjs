import { reportAnthropicUsage } from "./tokenusage.mjs";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const MODELS = { routine: "claude-haiku-4-5-20251001", confirm: "claude-sonnet-5-5" };
const MINUTE = 60000;
const RUNNING = ["RUNNING", "PREPARE", "PAUSE"];
const DONE = { FINISH: "finished", FAILED: "stopped", IDLE: "ended" };
const FRAME = /^[0-9]+\.jpg$|^plan\.png$/;
// Early layers decide most failures, so look more often then.
const interval = (progress) => (progress < 15 ? 2 : 4) * MINUTE;

// Watches every print: photos from the camera, a vision check against past successful prints of the same
// job and the slicer's preview, a pause after two problem checks in a row, and an outcome question at the end.
export class PrintWatcher {
  constructor(dbFile, dir, { printers, notifications, vision = null, shrink, orderPrints = null, now = Date.now }) {
    Object.assign(this, { dir, printers, notifications, vision, shrink, orderPrints, now });
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(dbFile);
    this.db.exec(`CREATE TABLE IF NOT EXISTS print_watches (id TEXT PRIMARY KEY, printer TEXT NOT NULL, printer_name TEXT NOT NULL, job TEXT NOT NULL, plate INTEGER NOT NULL, started INTEGER NOT NULL, ended INTEGER, ended_as TEXT, outcome TEXT, mode TEXT NOT NULL, bad INTEGER NOT NULL DEFAULT 0, alert TEXT, last_check TEXT, next_check INTEGER NOT NULL, plan INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS watch_frames (watch TEXT NOT NULL, file TEXT NOT NULL, at INTEGER NOT NULL, progress INTEGER NOT NULL, layer INTEGER, verdict TEXT, reason TEXT, PRIMARY KEY (watch, file));`);
    const columns = this.db.prepare("PRAGMA table_info(print_watches)").all().map((c) => c.name);
    for (const [name, type] of [["note", "TEXT"], ["order_id", "TEXT"], ["order_number", "TEXT"], ["assets", "TEXT"], ["credited", "INTEGER NOT NULL DEFAULT 0"]])
      if (!columns.includes(name)) this.db.exec(`ALTER TABLE print_watches ADD COLUMN ${name} ${type}`);
    this.busy = new Set();
  }
  close() {
    this.db.close();
  }
  row(id) {
    const r = this.db.prepare("SELECT * FROM print_watches WHERE id=?").get(id);
    return r && { ...r, alert: r.alert ? JSON.parse(r.alert) : null, last_check: r.last_check ? JSON.parse(r.last_check) : null };
  }
  active(serial) {
    const r = this.db.prepare("SELECT id FROM print_watches WHERE printer=? AND ended IS NULL").get(serial);
    return r ? this.row(r.id) : null;
  }
  set(id, fields) {
    const keys = Object.keys(fields);
    const value = (v) => (v && typeof v === "object" ? JSON.stringify(v) : v);
    this.db.prepare(`UPDATE print_watches SET ${keys.map((k) => `${k}=?`).join(",")} WHERE id=?`).run(...keys.map((k) => value(fields[k])), id);
  }
  folder(id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw Error("Unknown print");
    return path.join(this.dir, id);
  }
  frameFile(id, file) {
    if (!FRAME.test(file)) throw Error("Unknown frame");
    return path.join(this.folder(id), file);
  }
  // Called every few seconds: starts, checks and ends watches as printers change state.
  async tick() {
    for (const { serial, view, data } of this.printers.statuses()) {
      if (!view.connected || this.busy.has(serial)) continue;
      this.busy.add(serial);
      try {
        const raw = view.rawState, job = data.subtask_name || "";
        let watch = this.active(serial);
        if (watch && (DONE[raw] || (job && job !== watch.job))) {
          await this.end(watch, DONE[raw] || "ended", serial);
          watch = null;
        }
        if (!watch && RUNNING.includes(raw) && job) watch = await this.start(serial, view, data);
        // You resumed a print the watcher paused: you've judged it, so only warn from here on.
        if (watch?.alert?.paused && !watch.alert.dismissed && raw === "RUNNING") {
          this.set(watch.id, { mode: "warn", alert: { ...watch.alert, dismissed: true } });
          watch = this.active(serial);
        }
        if (watch && raw === "RUNNING" && this.now() >= watch.next_check) await this.check(watch, serial, view);
      } catch (e) {
        console.error("Print watcher:", e.message);
      } finally {
        this.busy.delete(serial);
      }
    }
  }
  async start(serial, view, data) {
    const id = randomUUID(), plate = Number(String(data.gcode_file || "").match(/plate_(\d+)/)?.[1] || 1);
    fs.mkdirSync(this.folder(id), { recursive: true, mode: 0o700 });
    // A print sent from an order's Print button carries the order and the pieces it makes.
    const tag = this.orderPrints?.claim(serial);
    this.db.prepare("INSERT INTO print_watches (id, printer, printer_name, job, plate, started, mode, next_check, order_id, order_number, assets) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, serial, view.name, data.subtask_name, plate, this.now(), "pause", this.now() + MINUTE, tag?.orderId ?? null, tag?.orderNumber ?? null, tag ? JSON.stringify(tag.assetIds) : null);
    try {
      const preview = (await this.printers.lastPrint(serial))?.previews?.[plate];
      if (preview) {
        fs.writeFileSync(this.frameFile(id, "plan.png"), preview, { mode: 0o600 });
        this.set(id, { plan: 1 });
      }
    } catch {}
    return this.row(id);
  }
  async snap(watch, serial, view) {
    const { jpeg, brightness } = await this.shrink(await this.printers.cameraFrame(serial));
    const file = `${this.now()}.jpg`;
    fs.writeFileSync(this.frameFile(watch.id, file), jpeg, { mode: 0o600 });
    this.db.prepare("INSERT INTO watch_frames (watch, file, at, progress, layer) VALUES (?,?,?,?,?)").run(watch.id, file, this.now(), view.progress || 0, view.layer ?? null);
    return { file, jpeg, brightness };
  }
  // The same job's frame nearest this progress, from its most recent successful print.
  reference(watch, progress) {
    return this.db.prepare(`SELECT f.watch, f.file, f.progress FROM watch_frames f JOIN print_watches w ON w.id=f.watch
      WHERE w.job=? AND w.plate=? AND w.outcome='success' AND w.id<>? ORDER BY w.ended DESC, abs(f.progress-?) LIMIT 1`).get(watch.job, watch.plate, watch.id, progress);
  }
  async check(watch, serial, view) {
    const next = (ms) => this.now() + ms;
    let frame;
    try {
      frame = await this.snap(watch, serial, view);
    } catch {
      this.set(watch.id, { last_check: { at: this.now(), verdict: "error", reason: "Camera unavailable" }, next_check: next(2 * MINUTE) });
      return;
    }
    if (!this.vision) return this.set(watch.id, { last_check: { at: this.now(), verdict: "saved", file: frame.file }, next_check: next(interval(view.progress)) });
    if (frame.brightness < 18) return this.set(watch.id, { last_check: { at: this.now(), verdict: "dark", reason: "Too dark to see the print", file: frame.file }, next_check: next(interval(view.progress)) });
    const ref = this.reference(watch, view.progress);
    // What went wrong on earlier failed runs of this job, in your words.
    const lessons = this.db.prepare("SELECT note FROM print_watches WHERE job=? AND plate=? AND outcome='failed' AND note IS NOT NULL AND id<>? ORDER BY ended DESC LIMIT 2").all(watch.job, watch.plate, watch.id).map((r) => r.note);
    const images = [];
    if (watch.plan) images.push({ label: "The slicer's preview of the finished plate (not a photo).", data: fs.readFileSync(this.frameFile(watch.id, "plan.png")), type: "image/png" });
    if (ref) images.push({ label: `A photo of this same job at ${ref.progress}% from a print that came out fine.`, data: fs.readFileSync(this.frameFile(ref.watch, ref.file)), type: "image/jpeg" });
    images.push({ label: `The live photo now, at ${view.progress}%.`, data: frame.jpeg, type: "image/jpeg" });
    let result;
    try {
      result = await this.vision({
        model: watch.bad > 0 ? MODELS.confirm : MODELS.routine,
        images,
        context: `Job "${watch.job}" on ${watch.printer_name}. Progress ${view.progress}%${view.layer != null ? `, layer ${view.layer} of ${view.totalLayers ?? "?"}` : ""}, ${Math.round((this.now() - watch.started) / MINUTE)} minutes in.${lessons.length ? ` Earlier runs of this job failed; the owner noted: ${lessons.map((n) => `"${n}"`).join("; ")}.` : ""}`,
      });
    } catch (e) {
      return this.set(watch.id, { last_check: { at: this.now(), verdict: "error", reason: "Check failed: " + e.message.slice(0, 120), file: frame.file }, next_check: next(2 * MINUTE) });
    }
    this.db.prepare("UPDATE watch_frames SET verdict=?, reason=? WHERE watch=? AND file=?").run(result.verdict, result.reason, watch.id, frame.file);
    const last_check = { at: this.now(), verdict: result.verdict, reason: result.reason, file: frame.file, reference: !!ref };
    if (result.verdict !== "problem") return this.set(watch.id, { bad: 0, last_check, next_check: next(interval(view.progress)) });
    const bad = watch.bad + 1;
    // One problem check gets a quick second look with the stronger model; two in a row acts.
    if (bad < 2) return this.set(watch.id, { bad, last_check, next_check: next(45000) });
    const pause = watch.mode === "pause";
    if (pause) await this.printers.control(serial, "pause").catch(() => {});
    if (!watch.alert || watch.alert.dismissed) {
      this.notifications?.broadcast({
        id: `watch:${watch.id}:${frame.file}`,
        title: `${pause ? "Paused" : "Check"} ${watch.printer_name}: ${watch.job}`,
        body: `${pause ? "Spoolside paused this print. " : ""}${result.reason}`,
        url: "/printers",
      });
    }
    this.set(watch.id, { bad: 0, last_check, alert: { at: this.now(), reason: result.reason, file: frame.file, paused: pause }, next_check: next(interval(view.progress)) });
  }
  async end(watch, endedAs, serial) {
    let file = null;
    try {
      const view = this.printers.statuses().find((s) => s.serial === serial)?.view || {};
      file = (await this.snap(watch, serial, view)).file;
    } catch {}
    this.set(watch.id, { ended: this.now(), ended_as: endedAs, last_check: { ...(watch.last_check || {}), final: file } });
    this.notifications?.broadcast({
      id: `watch:${watch.id}:end`,
      title: `${watch.job} ${endedAs === "finished" ? "finished" : "stopped"} on ${watch.printer_name}`,
      body: "Did it come out right? Tap to tell Spoolside.",
      url: "/printers",
    });
  }
  // Your answer teaches the watcher: successful prints become references for the next run of the same job.
  // A failed print can carry a note on what went wrong; it can be added or edited later.
  note(id, note) {
    const watch = this.row(id);
    if (!watch || !watch.ended) throw Object.assign(Error("Unknown print"), { status: 404 });
    if (typeof note !== "string") throw Error("Notes are text");
    this.set(id, { note: note.replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, 500) || null });
    return this.view(this.row(id));
  }
  outcome(id, success, note) {
    const watch = this.row(id);
    if (!watch || !watch.ended) throw Object.assign(Error("Unknown print"), { status: 404 });
    if (typeof success !== "boolean") throw Error("Choose success or failure");
    if (note !== undefined && note !== null && typeof note !== "string") throw Error("Notes are text");
    const text = typeof note === "string" ? note.replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, 500) : watch.note;
    this.set(id, { outcome: success ? "success" : "failed", note: text || null });
    // A good print from an order counts its pieces as printed; changing the answer takes them back.
    if (watch.order_id && this.orderPrints && success !== !!watch.credited) {
      this.orderPrints.add(watch.order_id, JSON.parse(watch.assets || "[]"), success ? 1 : -1);
      this.set(id, { credited: success ? 1 : 0 });
    }
    this.prune();
    return this.view(this.row(id));
  }
  async falseAlarm(id) {
    const watch = this.row(id);
    if (!watch?.alert || watch.ended) throw Object.assign(Error("Nothing to dismiss"), { status: 404 });
    this.db.prepare("UPDATE watch_frames SET verdict='false-alarm' WHERE watch=? AND file=?").run(id, watch.alert.file);
    // After a false alarm, keep watching this print but only warn.
    this.set(id, { mode: "warn", bad: 0, alert: { ...watch.alert, dismissed: true } });
    if (watch.alert.paused) await this.printers.control(watch.printer, "resume");
    return this.view(this.row(id));
  }
  // Keeps photos from the three latest successful runs of each job, and recent prints; drops the rest.
  prune(keepDays = 14) {
    const keep = new Set(this.db.prepare(`SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY job, plate ORDER BY ended DESC) n FROM print_watches WHERE outcome='success') WHERE n<=3`).all().map((r) => r.id));
    const old = this.db.prepare("SELECT id FROM print_watches WHERE ended IS NOT NULL AND ended<?").all(this.now() - keepDays * 24 * 60 * MINUTE);
    for (const { id } of old) {
      if (keep.has(id)) continue;
      fs.rmSync(this.folder(id), { recursive: true, force: true });
      this.db.prepare("DELETE FROM watch_frames WHERE watch=?").run(id);
      // Failure notes outlive their photos: they're the print's history.
      if (this.row(id).note) this.set(id, { last_check: null, alert: null, plan: 0 });
      else this.db.prepare("DELETE FROM print_watches WHERE id=?").run(id);
    }
  }
  view(w) {
    return {
      id: w.id, printer: w.printer, printerName: w.printer_name, job: w.job, started: w.started, ended: w.ended, endedAs: w.ended_as,
      outcome: w.outcome, note: w.note || null, order: w.order_number || null, mode: w.mode, plan: !!w.plan, check: w.last_check, alert: w.alert && !w.alert.dismissed ? w.alert : null,
    };
  }
  // Order pieces being printed or waiting for an answer ("orderId:assetId"), so they aren't offered twice.
  inFlight() {
    const out = new Set();
    for (const r of this.db.prepare("SELECT order_id, assets FROM print_watches WHERE order_id IS NOT NULL AND (ended IS NULL OR outcome IS NULL)").all())
      for (const a of JSON.parse(r.assets || "[]")) out.add(`${r.order_id}:${a}`);
    return out;
  }
  // The printer's most recent print.
  lastFor(serial) {
    return this.db.prepare("SELECT id, ended, outcome FROM print_watches WHERE printer=? ORDER BY started DESC LIMIT 1").get(serial) || null;
  }
  // Active prints, plus finished ones waiting for your answer (from the last 3 days).
  list() {
    const rows = this.db.prepare("SELECT id FROM print_watches WHERE ended IS NULL OR (outcome IS NULL AND ended>?) ORDER BY started DESC").all(this.now() - 3 * 24 * 60 * MINUTE);
    // The latest answered prints, for each printer's history.
    const recent = this.db.prepare("SELECT id FROM print_watches WHERE outcome IS NOT NULL ORDER BY ended DESC LIMIT 30").all();
    return { vision: !!this.vision, watches: rows.map((r) => this.view(this.row(r.id))), recent: recent.map((r) => this.view(this.row(r.id))) };
  }
}

// Shrinks a camera frame to keep vision checks cheap, and measures how bright it is.
export async function shrinkFrame(jpeg) {
  const { default: sharp } = await import("sharp");
  const image = sharp(jpeg).resize({ width: 960, withoutEnlargement: true });
  const [out, stats] = await Promise.all([image.clone().jpeg({ quality: 72 }).toBuffer(), image.clone().stats()]);
  const brightness = stats.channels.slice(0, 3).reduce((n, c) => n + c.mean, 0) / 3;
  return { jpeg: out, brightness };
}

const SYSTEM = `You watch a Bambu Lab A1 mini 3D printer through its built-in camera, to catch failed prints early.
The camera is a fixed wide-angle lens on the frame. The A1 mini is a bed slinger: the bed slides front to back, so the print can appear at different positions and sizes between photos, and the toolhead moves around. Lighting varies; parts of the scene can be dim or blurred by motion.
You may get the slicer's preview of the finished plate, and a photo of this same job from a print that came out fine at a similar point. Use them to judge what should be on the bed right now.
Report "problem" only for a clearly visible failure: spaghetti or loose strands of filament, a part detached or knocked over or shifted on the bed, a large blob of plastic on the nozzle, an empty bed well into the print, or layers clearly offset. Report "unsure" if you can't see the print well enough to judge. Otherwise report "ok". Be conservative: a false alarm pauses a good print.`;

// Asks Claude to judge a photo, with a forced tool call for a structured answer.
export function claudeVision(apiKey, fetchImpl = fetch) {
  return async ({ model, images, context }) => {
    const content = [{ type: "text", text: context }];
    for (const img of images) content.push({ type: "text", text: img.label }, { type: "image", source: { type: "base64", media_type: img.type, data: img.data.toString("base64") } });
    content.push({ type: "text", text: "Does the live photo show a failed print?" });
    const r = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        system: SYSTEM,
        tools: [{
          name: "report",
          description: "Report whether the print looks healthy.",
          input_schema: {
            type: "object",
            properties: {
              verdict: { type: "string", enum: ["ok", "problem", "unsure"] },
              reason: { type: "string", description: "One short sentence a person can act on, e.g. 'Loose strands of filament around the part at the front of the bed.'" },
            },
            required: ["verdict", "reason"],
          },
        }],
        tool_choice: { type: "tool", name: "report" },
        messages: [{ role: "user", content }],
      }),
      signal: AbortSignal.timeout(60000),
    });
    const body = await r.json().catch(() => ({}));
    reportAnthropicUsage({ usage: body.usage, requestId: r.headers?.get?.("request-id") || body.id, model: body.model || model, taskId: "print-vision" });
    if (!r.ok) throw Error(body.error?.message || `Vision API ${r.status}`);
    const input = body.content?.find((c) => c.type === "tool_use")?.input;
    if (!["ok", "problem", "unsure"].includes(input?.verdict)) throw Error("Vision API gave no verdict");
    return { verdict: input.verdict, reason: String(input.reason || "").slice(0, 240) };
  };
}
