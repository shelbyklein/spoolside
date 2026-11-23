import { DatabaseSync } from "node:sqlite";

// After every EVERY prints that Spoolside started on a printer, run the printer's full calibration
// (bed leveling, vibration compensation, motor noise) before anything else starts there. The printer is
// held as soon as it's due, so repeats and auto-print wait; the calibration runs once the printer is idle
// and the camera sees an empty bed, and the hold lifts when the printer is idle again afterwards.
export const EVERY = 10;
const IDLE = ["IDLE", "FINISH", "FAILED"];
const LOOK = 2 * 60000, GIVE_UP = 60 * 60000;
// Bambu "calibration" option bits: 1 lidar, 2 bed leveling, 4 vibration compensation, 8 motor noise.
export const FULL = 2 | 4 | 8;

export class Calibrator {
  constructor(dbFile, { printers, watcher, notifications, bedCheck = null, shrink, reference = () => null, now = Date.now }) {
    Object.assign(this, { printers, watcher, notifications, bedCheck, shrink, reference, now });
    this.db = new DatabaseSync(dbFile);
    this.db.exec("CREATE TABLE IF NOT EXISTS calibrations (printer TEXT PRIMARY KEY, at INTEGER NOT NULL)");
    this.running = new Map(); // serial -> { at, left } while a calibration is under way
    this.looked = new Map();
    this.status = new Map();
    this.busy = false;
    printers.calibrating = this.running;
  }
  close() { this.db.close(); }
  // When the count started: the last calibration, or the first time Spoolside saw this printer (so turning
  // this on doesn't calibrate every printer at once).
  since(serial) {
    const row = this.db.prepare("SELECT at FROM calibrations WHERE printer=?").get(serial);
    if (row) return row.at;
    const at = this.now();
    this.db.prepare("INSERT INTO calibrations VALUES (?,?)").run(serial, at);
    return at;
  }
  count(serial) {
    return this.watcher.db.prepare("SELECT COUNT(*) AS n FROM print_watches WHERE printer=? AND external=0 AND ended_as='finished' AND started>?").get(serial, this.since(serial)).n;
  }
  // Repeats and auto-print don't start anything on a printer that's due or calibrating.
  held(serial) { return this.running.has(serial) || this.count(serial) >= EVERY; }
  view(serial) {
    return { done: this.count(serial), every: EVERY, calibrating: this.running.has(serial), status: this.status.get(serial) || null };
  }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try { for (const { serial, view } of this.printers.statuses()) await this.step(serial, view); }
    catch (e) { console.error("Calibrator:", e.message); }
    finally { this.busy = false; }
  }
  async step(serial, view) {
    const run = this.running.get(serial);
    if (run) {
      // Under way once the printer leaves idle; finished when it's idle again.
      if (!IDLE.includes(view.rawState)) run.left = true;
      else if (run.left || this.now() - run.at > GIVE_UP) {
        this.running.delete(serial);
        this.looked.delete(serial);
        this.db.prepare("INSERT INTO calibrations VALUES (?,?) ON CONFLICT(printer) DO UPDATE SET at=excluded.at").run(serial, this.now());
        this.status.set(serial, run.left ? "Calibrated" : "Calibration didn't start; counting again");
        this.notifications?.broadcast({ id: `calibrate:${serial}:${run.at}:done`, title: `${view.name} ${run.left ? "finished calibrating" : "didn't calibrate"}`, body: run.left ? "It's ready for the next print." : "The calibration never started. Run it from the printer if it's needed.", url: "/printers" });
      }
      return;
    }
    if (this.count(serial) < EVERY) return void this.status.delete(serial);
    if (!view.connected || !IDLE.includes(view.rawState) || this.printers.busy?.has(serial)) return void this.status.set(serial, `Calibrates after ${EVERY} prints, once it's free`);
    const last = this.watcher.lastFor(serial);
    if (last && !last.ended) return;
    if (!this.bedCheck) return void this.status.set(serial, "Due to calibrate: needs the camera check (vision key)");
    if (this.looked.has(serial) && this.now() - this.looked.get(serial) < LOOK) return;
    this.looked.set(serial, this.now());
    const bed = await this.look(serial);
    if (!bed.empty) return void this.status.set(serial, `Due to calibrate once the bed is cleared: ${bed.reason}`);
    this.running.set(serial, { at: this.now(), left: false });
    try {
      await this.printers.calibrate(serial, FULL);
    } catch (e) {
      this.running.delete(serial);
      return void this.status.set(serial, `Couldn't start calibrating: ${e.message}`);
    }
    this.status.set(serial, "Calibrating");
    this.notifications?.broadcast({ id: `calibrate:${serial}:${this.now()}`, title: `${view.name} is calibrating`, body: `After ${EVERY} prints: bed leveling, vibration and motor noise. Prints wait until it's done.`, url: "/printers" });
  }
  async look(serial) {
    try {
      const { jpeg, brightness } = await this.shrink(await this.printers.cameraFrame(serial));
      if (brightness < 18) return { empty: false, reason: "Too dark to see the bed" };
      return await this.bedCheck(jpeg, "routine", this.reference(serial));
    } catch {
      return { empty: false, reason: "Couldn't see the bed" };
    }
  }
}
