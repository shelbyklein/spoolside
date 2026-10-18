import { DatabaseSync } from "node:sqlite";

const IDLE = ["IDLE", "FINISH", "FAILED"];
const LOOK = 60000; // while waiting, the bed is looked at this often
const SETTLE = 60000; // a clear bed has to stay clear this long before the printer moves

// Repeat a printer's last print: when it finishes and the camera sees the bed cleared, start the same file
// again from the SD card. Stops when a print fails or is cancelled, the printer runs something else, or
// the count is reached.
export class Repeater {
  constructor(dbFile, { printers, watcher, bedCheck = null, shrink, reference = () => null, notifications = null, now = Date.now }) {
    Object.assign(this, { printers, watcher, bedCheck, shrink, reference, notifications, now });
    this.db = new DatabaseSync(dbFile);
    this.db.exec("CREATE TABLE IF NOT EXISTS printer_repeat (printer TEXT PRIMARY KEY, body TEXT NOT NULL)");
    this.state = new Map(); // printer -> { status, lookedAt, clearSince, cycle }
    this.busy = false;
  }
  close() {
    this.db.close();
  }
  get(serial) {
    const r = this.db.prepare("SELECT body FROM printer_repeat WHERE printer=?").get(serial);
    return r ? JSON.parse(r.body) : null;
  }
  save(serial, body) {
    this.db.prepare("INSERT INTO printer_repeat VALUES (?,?) ON CONFLICT(printer) DO UPDATE SET body=excluded.body").run(serial, JSON.stringify(body));
  }
  active(serial) {
    return !!this.get(serial);
  }
  view() {
    return this.db.prepare("SELECT printer, body FROM printer_repeat").all().map(({ printer, body }) => {
      const r = JSON.parse(body);
      return { printer, name: r.name, plate: r.plate, done: r.done, times: r.times, status: this.state.get(printer)?.status || "Repeating" };
    });
  }
  // Settings are the same ones Print again uses. `times` is how many more prints to start (null: until stopped).
  async enable(serial, { plate, amsMapping = [], useAms = false, bedLevelling = true, times = null }) {
    const last = await this.printers.lastPrint(serial);
    if (!last) throw Object.assign(Error("This print isn't on the printer's SD card, so it can't be repeated"), { status: 404 });
    if (!last.plates.some((p) => p.index === plate)) throw Error("Choose a sliced plate");
    if (times !== null && (!Number.isInteger(times) || times < 1 || times > 500)) throw Error("Repeat 1 to 500 times, or until stopped");
    this.save(serial, { job: last.subtask, remoteName: last.remoteName, name: last.name, plate, amsMapping, useAms: !!useAms, bedLevelling: bedLevelling !== false, times, done: 0, since: this.now() });
    this.state.delete(serial);
    return this.view();
  }
  disable(serial, reason = null, name = null) {
    const r = this.get(serial);
    this.db.prepare("DELETE FROM printer_repeat WHERE printer=?").run(serial);
    this.state.delete(serial);
    if (r && reason) this.notifications?.broadcast({ id: `repeat:${serial}:stop:${this.now()}`, title: `Stopped repeating on ${name || "the printer"}`, body: reason, url: "/printers" });
    return this.view();
  }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const { printer: serial } of this.db.prepare("SELECT printer FROM printer_repeat").all()) await this.step(serial);
    } finally {
      this.busy = false;
    }
  }
  async step(serial) {
    const r = this.get(serial);
    const status = this.printers.statuses().find((s) => s.serial === serial);
    const view = status?.view;
    const s = this.state.get(serial) || {};
    this.state.set(serial, s);
    if (!view?.connected) return void (s.status = "Waiting for the printer to come back online");
    if (!IDLE.includes(view.rawState)) {
      s.clearSince = null;
      s.status = view.rawState === "PAUSE" ? "Paused" : `Printing (${r.done} repeated so far)`;
      return;
    }
    // Look at how the latest print ended, if it started after repeating was turned on.
    const latest = this.watcher.lastFor(serial);
    const w = latest && this.watcher.row(latest.id);
    if (w && w.started >= r.since) {
      if (!w.ended) return void (s.status = "Finishing up");
      if (w.job !== r.job) return void this.disable(serial, `${view.name} printed something else (${w.job}).`, view.name);
      if (w.ended_as !== "finished" || w.outcome === "failed") return void this.disable(serial, `The last ${r.name} ${w.ended_as === "finished" ? "was marked failed" : "didn't finish"}, so it won't start again.`, view.name);
    }
    if (r.times !== null && r.done >= r.times) return void this.disable(serial, `Printed ${r.name} ${r.done} more ${r.done === 1 ? "time" : "times"}.`, view.name);
    if (!this.bedCheck) return void (s.status = "Camera checks need the vision key");
    // A new finish: say once that clearing the bed starts the next one.
    const ours = w && w.started >= r.since;
    const cycle = ours ? w.id : "start";
    if (s.cycle !== cycle) {
      s.cycle = cycle;
      s.lookedAt = 0;
      s.clearSince = null;
      if (ours) this.notifications?.broadcast({ id: `repeat:${serial}:${cycle}`, title: `${view.name} finished ${r.name}`, body: "Clear the bed and it will start again.", url: "/printers" });
    }
    if (this.now() - (s.lookedAt || 0) < LOOK) return;
    s.lookedAt = this.now();
    const bed = await this.look(serial, s.clearSince ? "confirm" : "routine");
    if (!bed.empty) {
      s.clearSince = null;
      s.status = `Waiting for the bed to be cleared: ${bed.reason}`;
      return;
    }
    // The first clear look starts a short wait, so hands are out of the way before anything moves.
    if (!s.clearSince || this.now() - s.clearSince < SETTLE) {
      s.clearSince ||= this.now();
      s.status = "Bed looks clear. Starting again in about a minute.";
      return;
    }
    try {
      const last = await this.printers.lastPrint(serial);
      if (last?.remoteName !== r.remoteName) return void this.disable(serial, `${r.name} isn't the last file on the printer anymore.`, view.name);
      await this.printers.reprint(serial, { plate: r.plate, amsMapping: r.amsMapping, useAms: r.useAms, bedLevelling: r.bedLevelling });
    } catch (e) {
      return void this.disable(serial, `Couldn't start it again: ${e.message}`, view.name);
    }
    // The finished print needs no review: the bed was cleared and the next one is on its way.
    if (ours && w.ended && !w.outcome) {
      try { this.watcher.skip(w.id); } catch {}
    }
    this.save(serial, { ...r, done: r.done + 1 });
    s.clearSince = null;
    s.status = `Started again (${r.done + 1}${r.times ? ` of ${r.times}` : ""})`;
    this.notifications?.broadcast({ id: `repeat:${serial}:start:${r.done + 1}`, title: `Started ${r.name} again on ${view.name}`, body: r.times ? `${r.done + 1} of ${r.times}. The bed looked clear.` : `Repeat ${r.done + 1}. The bed looked clear.`, url: "/printers" });
  }
  async look(serial, kind) {
    try {
      const { jpeg, brightness } = await this.shrink(await this.printers.cameraFrame(serial));
      if (brightness < 18) return { empty: false, reason: "Too dark to see the bed" };
      return await this.bedCheck(jpeg, kind, this.reference(serial));
    } catch {
      return { empty: false, reason: "Couldn't see the bed" };
    }
  }
}
