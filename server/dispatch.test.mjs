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

test("automatic printing starts only after the last print was answered and the bed looks empty", async () => {
  const unanswered = setup({ last: { ended: 1, outcome: null } });
  try {
    unanswered.d.setAuto(true);
    await unanswered.d.tick();
    assert.equal(unanswered.started.length, 0);
    assert.equal(unanswered.d.view().offers.length, 0, "a finished print still on the bed means the printer isn't free");
    assert.equal(unanswered.pushes.length, 0);
    assert.equal(unanswered.d.view().available.length,0);
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


test("empty-bed teaching uses an exact fresh confirmed photo without bypassing vision", async()=>{
 const s=setup({bed:{empty:false,reason:"Fixture mistaken for part"}});
 try {
  await s.d.tick();const capture=await s.d.captureReference("P1");
  assert.throws(()=>s.d.teachReference("P1",capture.id,false,"fixture"),/Confirm/);
  assert.equal(s.d.reference("P1"),null);
  assert.deepEqual(s.d.referencePhoto("P1",capture.id).jpeg,Buffer.from("jpg"));
  s.d.teachReference("P1",capture.id,true," White circle is a fixture ");
  assert.equal(s.d.reference("P1").note,"White circle is a fixture");
  assert.equal(s.d.reference("other"),null);
  assert.equal(s.d.beds.has("P1"),false);
  await s.d.tick();assert.equal(s.references.at(-1).note,"White circle is a fixture");
  assert.equal(s.d.view().offers.length,0,"reference never forces clear");assert.equal(s.started.length,0);
  const expired=await s.d.captureReference("P1");s.later(300001);
  assert.throws(()=>s.d.teachReference("P1",expired.id,true,""),/expired/);
  const changed=await s.d.captureReference("P1");s.view.rawState="RUNNING";
  assert.throws(()=>s.d.teachReference("P1",changed.id,true,""),/idle/);
  await assert.rejects(()=>s.d.captureReference("P1"),/idle/);
 }finally{s.done();}
 const dark=setup();try{dark.d.shrink=async jpeg=>({jpeg,brightness:5});await assert.rejects(()=>dark.d.captureReference("P1"),/dark/);}finally{dark.done();}
});
test("automatic final check also receives the printer reference",async()=>{
 const s=setup();try{const c=await s.d.captureReference("P1");s.d.teachReference("P1",c.id,true,"fixture");s.d.setAuto(true);await s.d.tick();assert.deepEqual(s.checks,["routine","confirm"]);assert.ok(s.references.every(r=>r.note==="fixture"));}finally{s.done();}
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

test('a reference saved during a camera check invalidates the old in-flight verdict',async()=>{
 const s=setup();let release;const waiting=new Promise(r=>release=r);let calls=0;
 try{s.d.bedCheck=async(_jpeg,_kind,ref)=>{calls++;if(calls===1)await waiting;return {empty:!!ref,reason:'checked'};};
 const checking=s.d.lookAtBed('P1',null);await new Promise(r=>setImmediate(r));const c=await s.d.captureReference('P1');s.d.teachReference('P1',c.id,true,'fixture');release();
 assert.equal((await checking).empty,true);assert.equal(calls,2);
 }finally{s.done();}
});
