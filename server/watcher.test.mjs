import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrintWatcher, MODELS, claudeVision } from "./watcher.mjs";

function setup({ vision = true, brightness = 100 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spoolside-watch-"));
  const state = { raw: "RUNNING", job: "Touch Pin.gcode.3mf", progress: 5 };
  const calls = [], pushes = [], asked = [], verdicts = [];
  let t = 1_000_000_000;
  const printers = {
    statuses: () => [{ serial: "P1", view: { name: "Conductive", connected: true, rawState: state.raw, progress: state.progress, layer: 3, totalLayers: 40 }, data: { subtask_name: state.job, gcode_file: "" } }],
    lastPrint: async () => ({ previews: { 1: Buffer.from("plan-png") } }),
    cameraFrame: async () => Buffer.from("frame-" + t),
    control: async (serial, action) => calls.push([serial, action]),
  };
  const watcher = new PrintWatcher(":memory:", dir, {
    printers,
    notifications: { broadcast: (e) => pushes.push(e) },
    vision: vision ? async (req) => (asked.push(req), verdicts.shift() || { verdict: "ok", reason: "Looks normal." }) : null,
    shrink: async (jpeg) => ({ jpeg, brightness }),
    now: () => t,
  });
  const later = async (ms) => { t += ms; await watcher.tick(); };
  return { watcher, state, calls, pushes, asked, verdicts, later, dir, done: () => { watcher.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test("a print is watched, paused after two problem checks, and asks for its outcome", async () => {
  const s = setup();
  try {
    await s.later(0);
    let [w] = s.watcher.list().watches;
    assert.equal(w.job, "Touch Pin.gcode.3mf");
    assert.equal(w.plan, true);
    await s.later(30000);
    assert.equal(s.asked.length, 0, "first check waits a minute");
    await s.later(31000);
    assert.equal(s.asked[0].model, MODELS.routine);
    assert.deepEqual(s.asked[0].images.map((i) => i.type), ["image/png", "image/jpeg"]);
    assert.match(s.asked[0].context, /Progress 5%, layer 3 of 40/);
    // Early layers are checked every 2 minutes.
    s.verdicts.push({ verdict: "problem", reason: "Strands of filament at the front." });
    await s.later(119000);
    assert.equal(s.asked.length, 1);
    await s.later(1000);
    assert.equal(s.asked.length, 2);
    assert.deepEqual(s.calls, [], "one problem check doesn't pause");
    // The second look comes sooner, with the stronger model.
    s.verdicts.push({ verdict: "problem", reason: "Spaghetti around the part." });
    await s.later(45000);
    assert.equal(s.asked[2].model, MODELS.confirm);
    assert.deepEqual(s.calls, [["P1", "pause"]]);
    assert.equal(s.pushes.length, 1);
    assert.match(s.pushes[0].title, /Paused Conductive/);
    [w] = s.watcher.list().watches;
    assert.equal(w.alert.reason, "Spaghetti around the part.");
    assert.ok(fs.existsSync(s.watcher.frameFile(w.id, w.alert.file)));
    // Paused: no checks. A false alarm resumes and switches this print to warnings only.
    s.state.raw = "PAUSE";
    await s.later(10 * 60000);
    assert.equal(s.asked.length, 3);
    w = await s.watcher.falseAlarm(w.id);
    assert.deepEqual(s.calls.at(-1), ["P1", "resume"]);
    assert.equal(w.mode, "warn");
    assert.equal(w.alert, null);
    s.state.raw = "RUNNING";
    s.state.progress = 50;
    s.verdicts.push({ verdict: "problem", reason: "Odd blob." }, { verdict: "problem", reason: "Odd blob again." });
    await s.later(4 * 60000);
    await s.later(45000);
    assert.equal(s.calls.length, 2, "warn mode never pauses");
    assert.equal(s.pushes.length, 2);
    assert.match(s.pushes[1].title, /^Check Conductive/);
    // The end asks how it went.
    s.state.raw = "FINISH";
    await s.later(60000);
    [w] = s.watcher.list().watches;
    assert.equal(w.endedAs, "finished");
    assert.ok(w.check.final);
    assert.match(s.pushes.at(-1).body, /Tap to rate it/);
    assert.equal(s.pushes.at(-1).kind, "printFinished");
    assert.equal(s.pushes.at(-1).url, `/printers?rate=${w.id}`);
    assert.throws(() => s.watcher.outcome(w.id, "yes"), /Choose/);
    assert.equal(s.watcher.outcome(w.id, false, "  Corner lifted\non the left  ").note, "Corner lifted on the left");
    assert.equal(s.watcher.outcome(w.id, false).note, "Corner lifted on the left", "re-answering keeps the note");
    assert.equal(s.watcher.list().recent[0].note, "Corner lifted on the left");
    assert.equal(s.watcher.outcome(w.id, true).note, "Corner lifted on the left", "success preserves saved observations");
    assert.equal(s.watcher.note(w.id, "Calibration only").note, "Calibration only");
    assert.equal(s.watcher.row(w.id).outcome, "success", "saving a note does not change the outcome");
    s.watcher.set(w.id, { outcome: null });
    s.watcher.note(w.id, "Bed still occupied");
    assert.equal(s.watcher.row(w.id).outcome, null, "a note alone does not answer the bed/outcome gate");
    assert.throws(() => s.watcher.note(w.id, 4), /Notes are text/);
    assert.equal(s.watcher.outcome(w.id, true).outcome, "success");
    assert.equal(s.watcher.list().watches.length, 0, "answered prints leave the list");
    // The next run of the same job is compared with this one.
    s.state.raw = "RUNNING";
    s.state.progress = 48;
    await s.later(0);
    await s.later(60000);
    const labels = s.asked.at(-1).images.map((i) => i.label);
    assert.equal(labels.length, 3);
    assert.match(labels[1], /same job at 50% from a print that came out fine/);
    // A failed run's note becomes a hint for the next run's checks.
    s.state.raw = "FAILED";
    await s.later(60000);
    const [failed] = s.watcher.list().watches.filter((x) => x.ended && !x.outcome);
    s.watcher.outcome(failed.id, false, "Spaghetti after the bridge layer");
    s.state.raw = "RUNNING";
    s.state.progress = 30;
    await s.later(0);
    await s.later(60000);
    assert.match(s.asked.at(-1).context, /owner noted: "Spaghetti after the bridge layer"/);
  } finally {
    s.done();
  }
});

test("resuming a paused print yourself turns pausing off for it", async () => {
  const s = setup();
  try {
    await s.later(0);
    s.verdicts.push({ verdict: "problem", reason: "a" }, { verdict: "problem", reason: "b" });
    await s.later(60000);
    await s.later(45000);
    assert.deepEqual(s.calls, [["P1", "pause"]]);
    await s.later(60000);
    const [w] = s.watcher.list().watches;
    assert.equal(w.mode, "warn");
    assert.equal(w.alert, null);
  } finally {
    s.done();
  }
});

test("without a vision key it still saves photos; dark frames aren't judged", async () => {
  const plain = setup({ vision: false });
  try {
    await plain.later(0);
    await plain.later(60000);
    const [w] = plain.watcher.list().watches;
    assert.equal(plain.watcher.list().vision, false);
    assert.equal(w.check.verdict, "saved");
  } finally {
    plain.done();
  }
  const dark = setup({ brightness: 5 });
  try {
    await dark.later(0);
    await dark.later(60000);
    assert.equal(dark.asked.length, 0);
    assert.equal(dark.watcher.list().watches[0].check.verdict, "dark");
  } finally {
    dark.done();
  }
});

test("frame paths can't escape the watch folder; old unhelpful prints are pruned", async () => {
  const s = setup();
  try {
    assert.throws(() => s.watcher.frameFile("../x", "1.jpg"), /Unknown/);
    await s.later(0);
    const [w] = s.watcher.list().watches;
    assert.throws(() => s.watcher.frameFile(w.id, "../../etc/passwd"), /Unknown/);
    s.state.raw = "FAILED";
    await s.later(60000);
    s.watcher.outcome(w.id, false);
    await s.later(15 * 24 * 60 * 60000);
    s.watcher.prune();
    assert.equal(fs.existsSync(path.join(s.dir, w.id)), false);
    assert.equal(s.watcher.row(w.id), undefined, "no note: forgotten");
  } finally {
    s.done();
  }
});

test("Claude vision sends the photos and reads the forced report", async () => {
  let sent;
  const vision = claudeVision("sk-test", async (url, init) => {
    sent = { url, init, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ content: [{ type: "tool_use", name: "report", input: { verdict: "problem", reason: "Spaghetti." } }] }) };
  });
  const result = await vision({ model: MODELS.routine, context: "Job x", images: [{ label: "Now", type: "image/jpeg", data: Buffer.from("jpg") }] });
  assert.deepEqual(result, { verdict: "problem", reason: "Spaghetti." });
  assert.equal(sent.init.headers["x-api-key"], "sk-test");
  assert.equal(sent.body.tool_choice.name, "report");
  assert.equal(sent.body.messages[0].content.filter((c) => c.type === "image")[0].source.data, Buffer.from("jpg").toString("base64"));
  const failing = claudeVision("sk-test", async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "invalid x-api-key" } }) }));
  await assert.rejects(failing({ model: "m", context: "", images: [] }), /invalid x-api-key/);
});

test("a print sent from an order credits its pieces when it comes out fine", async () => {
  const { OrderPrints } = await import("./orderprints.mjs");
  const s = setup();
  const prints = new OrderPrints(":memory:", () => 1_000_000_000);
  s.watcher.orderPrints = prints;
  try {
    prints.sent("P1", { orderId: "o1", orderNumber: "#10181", assetIds: ["case"] });
    await s.later(0);
    let [w] = s.watcher.list().watches;
    assert.equal(w.order, "#10181");
    s.state.raw = "FINISH";
    await s.later(60000);
    s.watcher.outcome(w.id, true);
    assert.deepEqual(prints.all(), { o1: { case: 1 } });
    s.watcher.outcome(w.id, true);
    assert.deepEqual(prints.all(), { o1: { case: 1 } }, "answering twice counts once");
    s.watcher.outcome(w.id, false, "warped");
    assert.deepEqual(prints.all(), {}, "changing to failed takes it back");
    assert.equal(prints.claim("P1"), null, "the tag is used once");
  } finally {
    prints.close();
    s.done();
  }
});

test('external print prompts are stored once per run, can be dismissed, and exclude known and Spoolside prints',async()=>{
 const s=setup();
 try {
  s.watcher.library={forJob:()=>null};
  await s.later(0);
  const first=s.watcher.active('P1');
  assert.equal(s.watcher.view(first).external,true);
  assert.equal(s.pushes.filter(p=>p.id.endsWith(':import')).length,1);
  s.watcher.dismissImport(first.id);
  await s.later(1000);
  assert.equal(s.watcher.view(s.watcher.row(first.id)).importDismissed,true);
  assert.equal(s.pushes.filter(p=>p.id.endsWith(':import')).length,1);
  s.state.raw='FINISH';await s.later(1000);
  s.state.raw='RUNNING';s.state.job='New membrane.gcode.3mf';await s.later(1000);
  assert.equal(s.watcher.view(s.watcher.active('P1')).importDismissed,false);
  assert.equal(s.pushes.filter(p=>p.id.endsWith(':import')).length,2);
  s.state.raw='FINISH';await s.later(1000);
  s.watcher.printers.consumeStart=()=>true;
  s.state.raw='RUNNING';s.state.job='Sent from Spoolside';await s.later(1000);
  assert.equal(s.watcher.view(s.watcher.active('P1')).external,false);
  assert.equal(s.pushes.filter(p=>p.id.endsWith(':import')).length,2);
  s.state.raw='FINISH';await s.later(1000);
  s.watcher.printers.consumeStart=()=>false;s.watcher.library.forJob=()=>({id:'saved'});
  s.state.raw='RUNNING';s.state.job='Known file';await s.later(1000);
  assert.equal(s.pushes.filter(p=>p.id.endsWith(':import')).length,2);
 } finally {s.done();}
});
