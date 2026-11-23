import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Calibrator, EVERY, FULL } from "./calibrate.mjs";

function setup({ bed = { empty: true, reason: "Clear." } } = {}) {
  let t = 1000;
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE print_watches (id TEXT, printer TEXT, started INTEGER, ended INTEGER, ended_as TEXT, external INTEGER)");
  const view = { name: "AMS 2", connected: true, rawState: "FINISH" };
  const sent = [], pushes = [];
  const printers = { busy: new Set(), statuses: () => [{ serial: "P1", view }], cameraFrame: async () => Buffer.from("j"), calibrate: async (s, o) => { sent.push([s, o]); view.rawState = "RUNNING"; } };
  const watcher = { db, lastFor: () => ({ ended: 1 }) };
  const c = new Calibrator(":memory:", { printers, watcher, notifications: { broadcast: (e) => pushes.push(e) }, bedCheck: async () => bed, shrink: async (jpeg) => ({ jpeg, brightness: 100 }), now: () => t });
  let n = 0;
  const print = ({ external = 0, endedAs = "finished" } = {}) => db.prepare("INSERT INTO print_watches VALUES (?,?,?,?,?,?)").run(String(++n), "P1", t, t + 1, endedAs, external);
  return { c, view, sent, pushes, printers, print, later: (ms) => (t += ms) };
}

test("after 10 finished Spoolside prints the printer is held, calibrates on a clear bed, then counts again", async () => {
  const s = setup();
  s.c.since("P1"); s.later(1);
  for (let i = 0; i < EVERY - 1; i++) s.print();
  s.print({ external: 1 }); s.print({ endedAs: "cancelled" });   // neither counts
  await s.c.tick();
  assert.equal(s.c.held("P1"), false); assert.equal(s.sent.length, 0);
  s.print();
  assert.equal(s.c.held("P1"), true);
  await s.c.tick();
  assert.deepEqual(s.sent, [["P1", FULL]]);
  assert.equal(s.c.held("P1"), true);
  assert.equal(s.printers.calibrating.has("P1"), true);
  s.view.rawState = "RUNNING"; await s.c.tick();
  s.later(60000); s.view.rawState = "IDLE"; await s.c.tick();
  assert.equal(s.c.held("P1"), false); assert.equal(s.c.view("P1").done, 0);
  assert.match(s.pushes.map((p) => p.title).join(), /finished calibrating/);
});

test("a due printer waits for an empty bed and never calibrates while printing", async () => {
  const s = setup({ bed: { empty: false, reason: "A part on the plate" } });
  s.c.since("P1"); s.later(1);
  for (let i = 0; i < EVERY; i++) s.print();
  s.view.rawState = "RUNNING"; await s.c.tick();
  s.view.rawState = "FINISH"; await s.c.tick();
  assert.equal(s.sent.length, 0);
  assert.match(s.c.view("P1").status, /bed is cleared: A part/);
  assert.equal(s.c.held("P1"), true);
});
