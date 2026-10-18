import { test } from "node:test";
import assert from "node:assert/strict";
import { Repeater } from "./repeat.mjs";

function setup() {
  let t = 1_000_000;
  const printer = { rawState: "RUNNING" }, reprints = [], pushes = [], beds = [], skipped = [];
  let watches = [{ id: "w1", job: "Membranes_plate_12.gcode.3mf", started: t + 10, ended: null, ended_as: null, outcome: null }];
  const printers = {
    statuses: () => [{ serial: "M", view: { name: "Membrane", connected: true, rawState: printer.rawState } }],
    lastPrint: async () => ({ subtask: "Membranes_plate_12.gcode.3mf", remoteName: "Membranes_plate_12.gcode.3mf", name: "Membranes plate 12", plates: [{ index: 12, filaments: [] }] }),
    reprint: async (serial, opts) => { reprints.push([serial, opts]); printer.rawState = "RUNNING"; watches.unshift({ id: "w" + (watches.length + 1), job: "Membranes_plate_12.gcode.3mf", started: t, ended: null, ended_as: null, outcome: null }); },
    cameraFrame: async () => Buffer.from("jpg"),
  };
  const watcher = { lastFor: () => watches[0], row: (id) => watches.find((w) => w.id === id), skip: (id) => skipped.push(id) };
  const r = new Repeater(":memory:", { printers, watcher, notifications: { broadcast: (e) => pushes.push(e) }, shrink: async (jpeg) => ({ jpeg, brightness: 100 }), bedCheck: async (_j, kind) => ({ ...(beds.shift() || { empty: true, reason: "Empty." }), kind }), now: () => t });
  const later = async (ms) => { t += ms; await r.tick(); };
  const finish = (as = "finished") => { watches[0] = { ...watches[0], ended: t, ended_as: as }; printer.rawState = as === "finished" ? "FINISH" : "FAILED"; };
  return { r, printer, reprints, pushes, beds, skipped, later, finish, watches: () => watches };
}

test("repeats the print each time the bed is cleared, and stops after the count", async () => {
  const s = setup();
  await s.r.enable("M", { plate: 12, useAms: false, bedLevelling: false, times: 2 });
  assert.ok(s.r.active("M"));
  await s.later(0);
  assert.match(s.r.view()[0].status, /Printing/);
  s.finish();
  s.beds.push({ empty: false, reason: "Membranes are still on the plate." });
  await s.later(0);
  assert.match(s.pushes.at(-1).body, /Clear the bed/);
  assert.match(s.r.view()[0].status, /still on the plate/);
  await s.later(30000);
  assert.equal(s.reprints.length, 0, "the camera is looked at once a minute");
  await s.later(30000);
  assert.match(s.r.view()[0].status, /Starting again/);
  assert.equal(s.reprints.length, 0, "a clear bed has to stay clear for a minute");
  await s.later(60000);
  assert.equal(s.reprints.length, 1);
  assert.deepEqual(s.reprints[0], ["M", { plate: 12, amsMapping: [], useAms: false, bedLevelling: false }]);
  assert.deepEqual(s.skipped, ["w1"], "the finished print needs no review");
  assert.match(s.pushes.at(-1).title, /Started Membranes plate 12 again on Membrane/);
  // Second cycle, then the count is reached.
  s.finish();
  await s.later(60000);
  await s.later(60000);
  assert.equal(s.reprints.length, 2);
  s.finish();
  await s.later(60000);
  assert.equal(s.r.active("M"), false);
  assert.match(s.pushes.at(-1).body, /Printed Membranes plate 12 2 more times/);
});

test("a hand in the way resets the wait; a failed or cancelled print stops repeating", async () => {
  const s = setup();
  await s.r.enable("M", { plate: 12 });
  s.finish();
  s.beds.push({ empty: true, reason: "Empty." }, { empty: false, reason: "A hand is over the plate." });
  await s.later(0);
  await s.later(60000);
  assert.equal(s.reprints.length, 0);
  assert.match(s.r.view()[0].status, /hand/);
  await s.later(60000);
  await s.later(60000);
  assert.equal(s.reprints.length, 1);
  s.finish("stopped");
  await s.later(60000);
  assert.equal(s.r.active("M"), false);
  assert.match(s.pushes.at(-1).body, /didn't finish/);
});

test("printing something else, or a missing file, stops repeating", async () => {
  const s = setup();
  await s.r.enable("M", { plate: 12 });
  s.watches().unshift({ id: "x", job: "Other.3mf", started: 2_000_000, ended: 2_000_100, ended_as: "finished", outcome: null });
  s.printer.rawState = "FINISH";
  await s.later(1_000_000);
  assert.equal(s.r.active("M"), false);
  assert.match(s.pushes.at(-1).body, /printed something else/);
  await assert.rejects(s.r.enable("M", { plate: 3 }), /Choose a sliced plate/);
  await assert.rejects(s.r.enable("M", { plate: 12, times: 0 }), /1 to 500/);
});
