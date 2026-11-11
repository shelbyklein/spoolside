import { test } from "node:test";
import assert from "node:assert/strict";
import { Dispatcher } from "./dispatch.mjs";
import { OrderPrints } from "./orderprints.mjs";

function setup({ trays, bed = { empty: true, reason: "Clear." }, last = { ended: 1, outcome: "success" }, vision = true, dbFile = ":memory:" } = {}) {
  let t = Date.UTC(2026,9,8,16);
  const started = [], pushes = [], checks = [], references = [];
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
  const d = new Dispatcher(dbFile, {
    printers, library, orderPrints, watcher,
    plans: () => orders.map((o) => ({ order: o, plan })),
    notifications: { broadcast: (e) => pushes.push(e) },
    bedCheck: vision ? async (jpeg, kind, reference) => (checks.push(kind), references.push(reference), bed) : null,
    shrink: async (jpeg) => ({ jpeg, brightness: 100 }),
    now: () => t,
  });
  return { d, view, started, pushes, checks, references, orders, orderPrints, later: (ms) => (t += ms), done: () => { d.close(); orderPrints.close(); } };
}

test("a free printer is offered the oldest order it can print in TPU for AMS close to the colorway", async () => {
  const s = setup();
  try {
    await s.d.tick();
    const [offer] = s.d.view().offers;
    assert.equal(offer.orderNumber, "#10177", "oldest red order; the blue one has no close spool");
    assert.deepEqual(offer.mapping, [1]);
    assert.deepEqual(s.d.view().available.map(a=>a.orderId).sort(),["o10177","o10181"],"all matching orders can show availability, not only the oldest offer");
    s.view.rawState="RUNNING";assert.equal(s.d.view().available.length,0);
    s.view.rawState="FINISH";
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

test("automatic printing needs only an empty bed, not a review of the last print", async () => {
  const unanswered = setup({ last: { ended: 1, outcome: null } });
  try {
    unanswered.d.setAuto(true);
    await unanswered.d.tick();
    assert.equal(unanswered.started.length, 1, "an unreviewed finished print doesn't hold the printer once the bed looks empty");
  } finally {
    unanswered.done();
  }
  const stillPrinting = setup({ last: { ended: null, outcome: null } });
  try {
    stillPrinting.d.setAuto(true);
    await stillPrinting.d.tick();
    assert.equal(stillPrinting.started.length, 0, "a print that hasn't ended still holds the printer");
    assert.equal(stillPrinting.d.view().offers.length, 0);
  } finally {
    stillPrinting.done();
  }
  const neverWatched = setup({ last: null });
  try {
    neverWatched.d.setAuto(true);
    await neverWatched.d.tick();
    assert.equal(neverWatched.started.length, 1, "no print history: the camera check decides");
  } finally {
    neverWatched.done();
  }
  const busyBed = setup({ bed: { empty: false, reason: "A red case is on the plate." } });
  try {
    busyBed.d.setAuto(true);
    await busyBed.d.tick();
    assert.equal(busyBed.started.length, 0);
    assert.equal(busyBed.d.view().available.length,0);
    assert.equal(busyBed.d.view().offers.length, 0, "not even offered");
    assert.deepEqual(busyBed.d.view().held, [{ printer: "P1", printerName: "AMS 3", reason: "A red case is on the plate." }]);
    assert.equal(busyBed.pushes.length, 0);
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

test("the bed is checked by camera before offering: empty holds until the next print, anything else is rechecked", async () => {
  const s = setup({ bed: { empty: false, reason: "Parts on the plate." } });
  try {
    await s.d.tick();
    assert.equal(s.d.view().offers.length, 0);
    assert.deepEqual(s.checks, ["routine"]);
    await s.d.tick();
    assert.equal(s.checks.length, 1, "not rechecked within 5 minutes");
    s.later(5 * 60000 + 1);
    await s.d.tick();
    assert.equal(s.checks.length, 2);
  } finally {
    s.done();
  }
  const clear = setup();
  try {
    await clear.d.tick();
    clear.later(3 * 60 * 60000);
    await clear.d.tick();
    assert.equal(clear.checks.length, 1, "an empty bed stays trusted until the printer prints again");
    assert.equal(clear.d.view().offers.length, 1);
  } finally {
    clear.done();
  }
});


test("print-opportunity notifications wait for 9am New York time and stop at 11pm", async () => {
  const morning = setup();
  try {
    morning.later(-4*3600000); // 8am EDT
    await morning.d.tick();assert.equal(morning.d.view().offers.length,1);assert.equal(morning.pushes.length,0);
    morning.later(3600000); // 9am EDT, same still-available offer
    await morning.d.tick();assert.equal(morning.pushes.length,1);
    await morning.d.tick();assert.equal(morning.pushes.length,1,"no repeated notifications for one opportunity");
  } finally {morning.done();}
  const night=setup();
  try {night.later(11*3600000);await night.d.tick();assert.equal(night.pushes.length,0,"11pm is quiet time");}
  finally {night.done();}
});


test("empty-bed teaching uses an exact fresh confirmed photo; your confirmation clears the hold until the next print or half an hour", async()=>{
 const s=setup({bed:{empty:false,reason:"Fixture mistaken for part"}});
 try {
  await s.d.tick();const capture=await s.d.captureReference("P1");
  assert.throws(()=>s.d.teachReference("P1",capture.id,false,"fixture"),/Confirm/);
  assert.equal(s.d.reference("P1"),null);
  assert.deepEqual(s.d.referencePhoto("P1",capture.id).jpeg,Buffer.from("jpg"));
  s.d.teachReference("P1",capture.id,true," White circle is a fixture ");
  assert.equal(s.d.reference("P1").note,"White circle is a fixture");
  assert.equal(s.d.reference("P1").area,null);
  const marked=await s.d.captureReference("P1");
  assert.equal(marked.area,null);
  assert.throws(()=>s.d.teachReference("P1",marked.id,true,"",{left:0,top:0,right:0.02,bottom:1}),/larger box/);
  s.d.teachReference("P1",marked.id,true,"fixture",{left:0,top:0.44,right:0.57,bottom:1,extra:1});
  assert.deepEqual(s.d.reference("P1").area,{left:0,top:0.44,right:0.57,bottom:1});
  const again=await s.d.captureReference("P1");
  assert.deepEqual(again.area,{left:0,top:0.44,right:0.57,bottom:1},"the box starts where it was");
  s.d.teachReference("P1",again.id,true,"White circle is a fixture");
  assert.deepEqual(s.d.reference("P1").area,{left:0,top:0.44,right:0.57,bottom:1},"re-teaching without a box keeps it");
  assert.equal(s.d.reference("other"),null);
  assert.equal(s.d.beds.has("P1"),false);
  // Teaching is you confirming the bed is clear: the hold goes at once and the order is offered without another look.
  assert.equal(s.d.view().held.length,0,"the hold clears as soon as it's taught");
  const looks=s.checks.length;
  await s.d.tick();
  assert.equal(s.checks.length,looks,"no second-guessing right after you confirmed");
  assert.equal(s.d.view().offers.length,1);assert.equal(s.d.view().held.length,0);assert.equal(s.started.length,0,"auto-print is off");
  // Half an hour on, the camera judges again, now with your example; it still decides for itself.
  s.later(31*60000);
  await s.d.tick();
  assert.equal(s.references.at(-1).note,"White circle is a fixture");
  assert.equal(s.d.view().offers.length,0,"a reference never forces clear by itself");
  assert.equal(s.d.view().held[0].reason,"Fixture mistaken for part");
  const expired=await s.d.captureReference("P1");s.later(300001);
  assert.throws(()=>s.d.teachReference("P1",expired.id,true,""),/expired/);
  const changed=await s.d.captureReference("P1");s.view.rawState="RUNNING";
  assert.throws(()=>s.d.teachReference("P1",changed.id,true,""),/idle/);
  await assert.rejects(()=>s.d.captureReference("P1"),/idle/);
 }finally{s.done();}
 const dark=setup();try{dark.d.shrink=async jpeg=>({jpeg,brightness:5});await assert.rejects(()=>dark.d.captureReference("P1"),/dark/);}finally{dark.done();}
});
test("automatic final check also receives the printer reference",async()=>{
 const s=setup();try{const c=await s.d.captureReference("P1");s.d.teachReference("P1",c.id,true,"fixture");s.d.setAuto(true);s.later(31*60000);await s.d.tick();assert.deepEqual(s.checks,["routine","confirm"]);assert.ok(s.references.every(r=>r.note==="fixture"));}finally{s.done();}
});

test('vision compares separately labeled reference and current photos',async()=>{
 const {claudeBedCheck}=await import('./dispatch.mjs');let request;
 const check=claudeBedCheck('test',{routine:'routine',confirm:'confirm'},async(_url,options)=>{request=JSON.parse(options.body);return Response.json({content:[{type:'tool_use',input:{empty:true,reason:'Clear'}}]});});
 await check(Buffer.from('current'),'routine',{jpeg:Buffer.from('reference'),note:'fixed circle'});
 const content=request.messages[0].content;assert.match(content[0].text,/user confirmed.*fixed circle/);assert.equal(content[1].source.data,Buffer.from('reference').toString('base64'));assert.match(content[2].text,/Current camera/);assert.equal(content[3].source.data,Buffer.from('current').toString('base64'));
 assert.match(request.system,/Do not ignore new objects/);
});

test("printer references survive restart",async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'spoolside-bed-')),dbFile=join(dir,'reference.sqlite');
 try{const first=setup({dbFile});const c=await first.d.captureReference("P1");first.d.teachReference("P1",c.id,true,"fixture");first.done();
 const reopened=setup({dbFile});try{assert.equal(reopened.d.reference("P1").note,"fixture");assert.deepEqual(reopened.d.reference("P1").jpeg,Buffer.from("jpg"));}finally{reopened.done();}}
 finally{rmSync(dir,{recursive:true,force:true});}
});

test('a reference saved during a camera check replaces the old in-flight verdict',async()=>{
 const s=setup();let release;const waiting=new Promise(r=>release=r);let calls=0;
 try{s.d.bedCheck=async(_jpeg,_kind,ref)=>{calls++;if(calls===1)await waiting;return {empty:!!ref,reason:'checked'};};
 const checking=s.d.lookAtBed('P1',null);await new Promise(r=>setImmediate(r));const c=await s.d.captureReference('P1');s.d.teachReference('P1',c.id,true,'fixture');release();
 const verdict=await checking;assert.equal(verdict.empty,true);assert.equal(verdict.reason,"You confirmed the bed is clear.");assert.equal(calls,1,"your confirmation answers instead of a second look");
 }finally{s.done();}
});

test("bed checks with a plate area send only that part of both photos", async () => {
  const { claudeBedCheck } = await import("./dispatch.mjs");
  const { default: sharp } = await import("sharp");
  const photo = await sharp({ create: { width: 960, height: 600, channels: 3, background: "#808080" } }).jpeg().toBuffer();
  let sent;
  const check = claudeBedCheck("k", { confirm: "m" }, async (_url, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({ content: [{ type: "tool_use", input: { empty: true, reason: "Clear." } }] }) };
  });
  await check(photo, "confirm", { jpeg: photo, note: "", area: { left: 0, top: 0.53, right: 0.47, bottom: 1 } });
  const images = sent.messages[0].content.filter((c) => c.type === "image");
  for (const img of images) {
    const { width, height } = await sharp(Buffer.from(img.source.data, "base64")).metadata();
    assert.deepEqual([width, height], [480, 300]);
  }
  assert.match(sent.messages[0].content.find((c) => c.type === "text" && c.text.startsWith("Current")).text, /cropped to where the plate sits/);
  await check(photo, "confirm", { jpeg: photo, note: "" });
  const { width } = await sharp(Buffer.from(sent.messages[0].content.find((c) => c.type === "image").source.data, "base64")).metadata();
  assert.equal(width, 960, "no area: the whole photo");
});

test("each printer's bed check can be tuned: go by the visible plate, and notes on what's fine", async () => {
  const s = setup({ bed: { empty: false, reason: "The front edge of the plate is cut off." } });
  try {
    assert.deepEqual(s.d.bedSettings("P1"), { visibleOnly: true, allow: [], reference: null }, "visible-only by default");
    s.d.setAuto(true);
    await s.d.tick();
    assert.equal(s.d.view().held[0].reason, "The front edge of the plate is cut off.");
    assert.equal(s.references.at(-1).visibleOnly, true);
    assert.deepEqual(s.references.at(-1).allow, []);
    // "Wrong, remember this": the reason becomes a note, the hold clears, and the next check is told.
    const after = s.d.allowOnBed("P1", "Not a reason to hold: the front edge of the plate is cut off.");
    assert.equal(after.allow.length, 1);
    assert.equal(s.d.view().held.length, 0);
    s.later(1000);
    await s.d.tick();
    assert.deepEqual(s.references.at(-1).allow, ["Not a reason to hold: the front edge of the plate is cut off."], "rechecked at once, with the note");
    assert.equal(s.d.setVisibleOnly("P1", false).visibleOnly, false);
    s.later(1000);
    await s.d.tick();
    assert.equal(s.references.at(-1).visibleOnly, false);
    assert.equal(s.d.removeAllowance("P1", after.allow[0].id).allow.length, 0);
    assert.throws(() => s.d.removeAllowance("P1", "gone"), /already gone/);
    assert.throws(() => s.d.allowOnBed("P1", "   "), /what's fine/);
    assert.throws(() => s.d.setVisibleOnly("P1", "yes"), /on or off/);
  } finally {
    s.done();
  }
});

test("a print you start is judged from the photo before it, and a doubtful bed is a warning with the photo", async () => {
  const s = setup({ bed: { empty: false, reason: "A disc is near the back." } });
  try {
    const frame = await s.d.frameBeforeStart("P1");
    assert.deepEqual(frame.jpeg, Buffer.from("jpg"));
    await s.d.warnAfterStart("P1", frame, "PlayPad cap");
    const [w] = s.d.view().warnings;
    assert.equal(w.printerName, "AMS 3");
    assert.equal(w.job, "PlayPad cap");
    assert.equal(w.reason, "A disc is near the back.");
    assert.equal(w.jpeg, undefined, "the photo is served separately");
    assert.deepEqual(s.d.warning("P1").jpeg, Buffer.from("jpg"));
    assert.match(s.pushes.at(-1).title, /Check AMS 3's bed/);
    assert.match(s.pushes.at(-1).body, /You started PlayPad cap, but the camera thought: A disc is near the back/);
    s.d.dismissWarning("P1");
    assert.equal(s.d.view().warnings.length, 0);
    assert.throws(() => s.d.warning("P1"), /No bed warning/);
    // An empty bed says nothing; a warning expires after an hour.
    const clear = setup();
    try {
      await clear.d.warnAfterStart("P1", frame, "x");
      assert.equal(clear.d.view().warnings.length, 0);
      assert.equal(clear.pushes.length, 0);
    } finally {
      clear.done();
    }
    await s.d.warnAfterStart("P1", frame, "again");
    s.later(61 * 60000);
    assert.equal(s.d.view().warnings.length, 0);
  } finally {
    s.done();
  }
});

test("the bed prompt follows the printer's settings, with or without an empty-bed photo", async () => {
  const { claudeBedCheck, bedSystem } = await import("./dispatch.mjs");
  let request;
  const check = claudeBedCheck("k", { confirm: "m" }, async (_url, init) => {
    request = JSON.parse(init.body);
    return Response.json({ content: [{ type: "tool_use", input: { empty: true, reason: "Clear" } }] });
  });
  await check(Buffer.from("now"), "confirm", { visibleOnly: true, allow: ["The bed rests forward, so its front edge is out of frame."] });
  assert.equal(request.system, bedSystem(true));
  assert.match(request.system, /Judge the part of the plate you can see/);
  assert.doesNotMatch(request.system, /only if you can see the whole plate/);
  const texts = request.messages[0].content.filter((c) => c.type === "text").map((c) => c.text);
  assert.ok(!texts.some((t) => /Reference photo/.test(t)), "no empty-bed photo taught");
  assert.match(texts.find((t) => /owner's notes/.test(t)), /- The bed rests forward/);
  await check(Buffer.from("now"), "confirm", { jpeg: Buffer.from("ref"), note: "", visibleOnly: false, allow: [] });
  assert.match(request.system, /only if you can see the whole plate/);
  assert.ok(!request.messages[0].content.some((c) => c.type === "text" && /owner's notes/.test(c.text)));
});

test("a printer is only offered an order whose colorway one of its spools actually is", async () => {
  // AMS 2's real spools: red, blue and grey TPU. Grey's RGB numbers sit close to green's, but grey isn't green.
  const s = setup({ trays: [{ slot: 1, color: "#ED0000", type: "TPU-AMS", materialId: "bambu-tpu-ams" }, { slot: 2, color: "#5898DD", type: "TPU-AMS", materialId: "bambu-tpu-ams" }, { slot: 3, color: "#939393", type: "TPU-AMS", materialId: "bambu-tpu-ams" }] });
  try {
    s.orders.splice(0, s.orders.length, { id: "g", number: "#10416", commercial: "processing", assembled: false, items: [{ id: "i", colorway: "Green" }] });
    await s.d.tick();
    assert.equal(s.d.view().offers.length, 0, "no green spool, no green offer");
    assert.equal(s.d.view().available.length, 0);
    // Load lime green TPU and the order is offered from that slot.
    s.view.trays.push({ slot: 0, color: "#90FF1A", type: "TPU-AMS", materialId: "bambu-tpu-ams" });
    s.later(60 * 60000);
    await s.d.tick();
    assert.equal(s.d.view().offers[0]?.orderNumber, "#10416");
    assert.equal(s.d.view().offers[0].slot, 0);
  } finally {
    s.done();
  }
});

test("Bed cleared looks again right away instead of waiting a few minutes", async () => {
  const s = setup({ bed: { empty: false, reason: "A green part is on the plate." } });
  try {
    await s.d.tick();
    assert.equal(s.d.view().held.length, 1);
    const looks = s.checks.length;
    await s.d.tick();
    assert.equal(s.checks.length, looks, "a held bed normally waits a few minutes before the next look");
    s.d.bedCheck = async (jpeg, kind) => (s.checks.push(kind), { empty: true, reason: "Clear." });
    const view = await s.d.recheck("P1");
    assert.equal(s.checks.length, looks + 1);
    assert.equal(view.held.length, 0);
    assert.equal(view.offers.length, 1);
    await assert.rejects(() => s.d.recheck("nope"), /Unknown printer/);
  } finally {
    s.done();
  }
});

test("the plate can be marked by its four corners; checks then blank everything outside the outline", async () => {
  const { plateArea, cropArea } = await import("./dispatch.mjs");
  const { default: sharp } = await import("sharp");
  // Corners in any order come back in order round the plate, with the box around them.
  const a = plateArea({ quad: [[0.05, 0.98], [0.42, 0.46], [0.56, 0.9], [0.02, 0.5]] });
  assert.deepEqual(a, { left: 0.02, top: 0.46, right: 0.56, bottom: 0.98, quad: [[0.02, 0.5], [0.42, 0.46], [0.56, 0.9], [0.05, 0.98]] });
  assert.throws(() => plateArea({ quad: [[0, 0], [1, 1], [0.5, 0.5]] }), /four corners/);
  assert.throws(() => plateArea({ quad: [[0, 0], [1, 0], [1, 1], [0, 2]] }), /four corners/);
  assert.throws(() => plateArea({ quad: [[0.1, 0.1], [0.11, 0.1], [0.11, 0.11], [0.1, 0.11]] }), /larger shape/);
  assert.deepEqual(plateArea({ left: 0, top: 0.44, right: 0.57, bottom: 1, extra: 1 }), { left: 0, top: 0.44, right: 0.57, bottom: 1 }, "a box still works");
  // A white photo cropped to a diamond: inside stays white, the corners outside the outline go flat grey.
  const white = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
  const diamond = plateArea({ quad: [[0.5, 0.1], [0.9, 0.5], [0.5, 0.9], [0.1, 0.5]] });
  const out = await cropArea(white, diamond);
  const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => data[(Math.round(y * (info.height - 1)) * info.width + Math.round(x * (info.width - 1))) * info.channels];
  assert.ok(px(0.5, 0.5) > 240, "the plate is kept");
  assert.ok(Math.abs(px(0.02, 0.02) - 128) < 12, "outside the outline is grey");
  // A box crops without blanking anything.
  const boxed = await sharp(await cropArea(white, { left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 })).raw().toBuffer({ resolveWithObject: true });
  assert.ok(boxed.data[0] > 240);
});
