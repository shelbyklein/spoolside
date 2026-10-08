import { test } from "node:test";
import assert from "node:assert/strict";
import { Dispatcher } from "./dispatch.mjs";
import { OrderPrints } from "./orderprints.mjs";

function setup({ trays, bed = { empty: true, reason: "Clear." }, last = { ended: 1, outcome: "success" }, vision = true } = {}) {
  let t = 1_000_000_000;
  const started = [], pushes = [];
  const view = { id: "P1", name: "AMS 3", connected: true, rawState: "FINISH", trays: trays || [{ slot: 0, color: "#90FF1A", type: "TPU-AMS", materialId: "bambu-tpu-ams" }, { slot: 1, color: "#ED0000", type: "TPU-AMS", materialId: "bambu-tpu-ams" }] };
  const printers = {
    busy: new Set(),
    statuses: () => [{ serial: "P1", view }],
    cameraFrame: async () => Buffer.from("jpg"),
    startPrint: async (serial, opts) => { started.push([serial, opts]); view.rawState = "PREPARE"; },
  };
  const plate = { index: 1, filaments: [{ id: 1, type: "TPU-AMS", color: "#ED0000" }], coverage: [{ assetId: "case" }] };
  const library = { get: (id) => (id === "f1" ? { id: "f1", name: "iPhone 12 Case", plates: [plate] } : null), file: () => "/x.3mf" };
  const order = (n, colorway) => ({ id: "o" + n, number: "#" + n, commercial: "processing", assembled: false, items: [{ id: "i", colorway }] });
  const plan = [{ key: "0:case", label: "case", pieces: [{ assetId: "case", needed: 1, done: 0 }], next: { assetId: "case", name: "iPhone 12 Case", fileId: "f1", fileName: "iPhone 12 Case", plate: 1 } }];
  const orders = [order(10181, "Red"), order(10177, "Red"), order(10170, "Blue")];
  const orderPrints = new OrderPrints(":memory:", () => t);
  const watcher = { inFlight: () => new Set(), lastFor: () => last };
  const d = new Dispatcher(":memory:", {
    printers, library, orderPrints, watcher,
    plans: () => orders.map((o) => ({ order: o, plan })),
    notifications: { broadcast: (e) => pushes.push(e) },
    bedCheck: vision ? async () => bed : null,
    shrink: async (jpeg) => ({ jpeg, brightness: 100 }),
    now: () => t,
  });
  return { d, view, started, pushes, orders, orderPrints, later: (ms) => (t += ms), done: () => { d.close(); orderPrints.close(); } };
}

test("a free printer is offered the oldest order it can print in TPU for AMS close to the colorway", async () => {
  const s = setup();
  try {
    await s.d.tick();
    const [offer] = s.d.view().offers;
    assert.equal(offer.orderNumber, "#10177", "oldest red order; the blue one has no close spool");
    assert.deepEqual(offer.mapping, [1]);
    assert.equal(s.pushes.length, 1);
    assert.match(s.pushes[0].body, /iPhone 12 Case for #10177 \(Red\)/);
    await s.d.tick();
    assert.equal(s.pushes.length, 1, "one notification per offer");
    assert.equal(s.started.length, 0, "automatic printing is off by default");
    s.d.dismiss("P1");
    assert.equal(s.d.view().offers.length, 0);
    s.later(61 * 60000);
    await s.d.tick();
    assert.equal(s.d.view().offers.length, 1, "Not now snoozes for an hour");
  } finally {
    s.done();
  }
});

test("non-TPU-for-AMS spools, busy printers and assembled orders are never offered", async () => {
  const pla = setup({ trays: [{ slot: 0, color: "#ED0000", type: "PLA", materialId: null }] });
  try {
    await pla.d.tick();
    assert.equal(pla.d.view().offers.length, 0);
  } finally {
    pla.done();
  }
  const s = setup();
  try {
    s.view.rawState = "RUNNING";
    await s.d.tick();
    assert.equal(s.d.view().offers.length, 0);
    s.view.rawState = "IDLE";
    s.orders.forEach((o) => (o.assembled = true));
    await s.d.tick();
    assert.equal(s.d.view().offers.length, 0);
  } finally {
    s.done();
  }
});

test("automatic printing starts only after the last print was answered and the bed looks empty", async () => {
  const unanswered = setup({ last: { ended: 1, outcome: null } });
  try {
    unanswered.d.setAuto(true);
    await unanswered.d.tick();
    assert.equal(unanswered.started.length, 0);
    assert.equal(unanswered.d.view().offers.length, 0, "a finished print still on the bed means the printer isn't free");
    assert.equal(unanswered.pushes.length, 0);
  } finally {
    unanswered.done();
  }
  const neverWatched = setup({ last: null });
  try {
    neverWatched.d.setAuto(true);
    await neverWatched.d.tick();
    assert.equal(neverWatched.started.length, 0, "no answered print yet: offer only");
    assert.match(neverWatched.d.view().offers[0].autoBlocked, /Answer how the last print went/);
  } finally {
    neverWatched.done();
  }
  const busyBed = setup({ bed: { empty: false, reason: "A red case is on the plate." } });
  try {
    busyBed.d.setAuto(true);
    await busyBed.d.tick();
    assert.equal(busyBed.started.length, 0);
    assert.match(busyBed.d.view().offers[0].autoBlocked, /red case is on the plate/);
    assert.equal(busyBed.pushes.length, 1, "falls back to asking");
  } finally {
    busyBed.done();
  }
  const noKey = setup({ vision: false });
  try {
    noKey.d.setAuto(true);
    await noKey.d.tick();
    assert.equal(noKey.started.length, 0);
  } finally {
    noKey.done();
  }
  const s = setup();
  try {
    s.d.setAuto(true);
    await s.d.tick();
    assert.equal(s.started.length, 1);
    assert.deepEqual(s.started[0][1].amsMapping, [1]);
    assert.equal(s.orderPrints.claim("P1").orderNumber, "#10177");
    assert.match(s.pushes.at(-1).title, /Started on AMS 3/);
  } finally {
    s.done();
  }
});
