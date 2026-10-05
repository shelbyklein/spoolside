import { test } from "node:test";
import assert from "node:assert/strict";
import { Workspace, normalizeOrder, variantDetails } from "./workspace.mjs";
import { mergeTelemetry, printerView } from "./printers.mjs";
const raw = {
  id: 12,
  number: "12",
  status: "processing",
  date_created: "2026-10-05T12:00:00",
  line_items: [
    {
      id: 9,
      name: "Case",
      quantity: 2,
      product_id: 1,
      variation_id: 2,
      sku: "PC",
      meta_data: [
        { key: "Color", value: "Orange" },
        { key: "_secret", value: "hidden" },
      ],
    },
  ],
  refunds: [],
  billing: { email: "private@example.com" },
  shipping: { address_1: "private" },
};
test("normalize keeps source IDs, quantities and variants without customer/payment data", () => {
  const o = normalizeOrder(raw);
  assert.equal(o.items[0].quantity, 2);
  assert.equal(o.items[0].id, "9");
  assert.equal(o.items[0].variant, "Color: Orange");
  assert.equal(JSON.stringify(o).includes("private"), false);
  assert.equal(JSON.stringify(o).includes("hidden"), false);
  assert.equal(
    normalizeOrder({ ...raw, refunds: [{ id: 1 }] }).refundReview,
    true,
  );
});
test("paginated Woo import is atomic and retains production mapping; failed sync keeps last snapshot", async () => {
  let fail = false,
    calls = 0;
  const ws = new Workspace(":memory:", {
    woo: { url: "https://playcase.gg", key: "test", secret: "test" },
    fetcher: async (url) => {
      calls++;
      if (fail) return new Response("", { status: 503 });
      const page = new URL(url).searchParams.get("page");
      return Response.json(page === "1" ? [raw] : [{ ...raw, id: 13 }], {
        headers: { "x-wp-totalpages": "2" },
      });
    },
  });
  try {
    await ws.sync();
    assert.equal(calls, 2);
    assert.equal(ws.state.orders.length, 2);
    const next = ws.snapshot();
    next.orders[0].items[0].recipe = [
      { component: "Body", units: 1, material: "PLA", time: "1h" },
    ];
    next.orders[0].note = "Production note";
    ws.update(next);
    await ws.sync();
    assert.equal(ws.state.orders[0].note, "Production note");
    assert.equal(ws.state.orders[0].items[0].recipe[0].component, "Body");
    fail = true;
    await ws.sync();
    assert.equal(ws.state.orders.length, 2);
    assert.match(ws.state.syncError, /HTTP 503/);
  } finally {
    ws.close();
  }
});
test("server rejects stale revisions, premature shipping, duplicate jobs and cancelled changes", () => {
  const ws = new Workspace(":memory:");
  try {
    ws.state.orders = [normalizeOrder(raw)];
    let next = ws.snapshot();
    next.orders[0].shipped = true;
    assert.throws(() => ws.update(next), /fulfillment/);
    next = ws.snapshot();
    next.orders[0].items[0].recipe = [
      { component: "Body", units: 1, material: "PLA", time: "1h" },
    ];
    ws.update(next);
    assert.throws(() => ws.update(next), /Workspace changed/);
    next = ws.snapshot();
    const job = {
      id: "j1",
      name: "Body",
      material: "PLA",
      time: "1h",
      printer: "AMS 2",
      orderId: "wc-12",
      itemId: "9",
      component: "Body",
      units: 2,
      state: "Queued",
    };
    next.jobs = [job, { ...job, id: "j2" }];
    assert.throws(() => ws.update(next), /already have a job/);
    next.jobs = [job];
    ws.update(next);
    next = ws.snapshot();
    next.jobs[0].state = "Accepted";
    next.orders[0].assembled = true;
    next.orders[0].packed = true;
    next.orders[0].shipped = true;
    ws.update(next);
    ws.state.orders[0].commercial = "cancelled";
    ws.state.orders[0].assembled = false;
    ws.state.orders[0].packed = false;
    ws.state.orders[0].shipped = false;
    next = ws.snapshot();
    next.jobs[0].state = "Printing";
    assert.throws(() => ws.update(next), /on hold/);
    next = ws.snapshot();
    next.jobs = [];
    assert.throws(() => ws.update(next), /history/);
  } finally {
    ws.close();
  }
});
test("printer partial packets preserve values; stale and disconnected telemetry stays explicit", () => {
  const data = mergeTelemetry(
    { gcode_state: "RUNNING", mc_percent: 42, nozzle_temper: 210 },
    { bed_temper: 60 },
  );
  const cfg = { serial: "printer-1", name: "Maker" };
  const p = printerView(cfg, { data, connected: true, seen: 100000 }, 120000);
  assert.equal(p.state, "Printing");
  assert.equal(p.progress, 42);
  assert.equal(p.nozzle, 210);
  assert.equal(p.bed, 60);
  assert.equal(
    printerView(cfg, { data, connected: true, seen: 100000 }, 200001).state,
    "Offline",
  );
  assert.equal(
    printerView(cfg, { data, connected: false, seen: 100000 }, 120000).stale,
    false,
  );
  assert.equal("accessCode" in p, false);
});

test("PlayCase variants prefer readable fields without duplicate form values", () => {
  assert.equal(variantDetails([
    {key:"Phone",value:"4458"}, {key:"Colorway",value:"#000000"},
    {key:"Options",value:"<span>DS Faceplate</span>$14.99",display_value:"DS Faceplate$14.99"},
    {key:"Phone model",value:"iPhone 16 Pro"}, {key:"Colorway",value:"Black"},
    {key:"Options",value:"DS Faceplate"}
  ]), "Colorway: Black · Options: DS Faceplate · Phone model: iPhone 16 Pro");
});

test("changed source preserves history and notes while fulfillment requires review", () => {
  const ws = new Workspace(":memory:");
  try {
    ws.state.orders = [normalizeOrder(raw)];
    let next = ws.snapshot();
    next.orders[0].items[0].recipe = [{component:"Body",units:1,material:"PLA",time:"1h"}];
    next.jobs = [{id:"old",name:"Body",printer:"AMS 2",material:"PLA",time:"1h",orderId:"wc-12",itemId:"9",component:"Body",units:2,state:"Accepted"}];
    ws.update(next);
    ws.state.orders = [normalizeOrder({...raw,line_items:[{...raw.line_items[0],quantity:1}]},ws.state.orders[0])];
    assert.equal(ws.state.orders[0].sourceReview,true);
    next = ws.snapshot(); next.orders[0].note = "Still saves"; ws.update(next);
    next = ws.snapshot(); next.orders[0].assembled = true;
    assert.throws(()=>ws.update(next), /fulfillment/);
    next = ws.snapshot(); next.orders[0].sourceReview = false; ws.update(next);
    ws.state.orders = [normalizeOrder({...raw,line_items:[]},ws.state.orders[0])];
    next = ws.snapshot(); next.orders[0].note = "Removed item history retained"; ws.update(next);
    assert.equal(ws.state.jobs[0].units,2);
    next = ws.snapshot(); delete next.jobs[0].orderId;
    assert.throws(()=>ws.update(next), /relinked/);
  } finally {ws.close();}
});
test("printer preparation, unknown and disconnected states never claim readiness", () => {
  const config={serial:"p",name:"Printer"};
  for (const [raw,state] of [["PREPARE","Preparing"],["UNKNOWN","Unknown"],[undefined,"Unknown"]]) {
    assert.equal(printerView(config,{data:{gcode_state:raw},connected:true,seen:1000},1001).state,state);
  }
  const offline=printerView(config,{data:{gcode_state:"FINISH"},connected:false,seen:1000},1001);
  assert.equal(offline.connected,false); assert.equal(offline.state,"Offline");
});
