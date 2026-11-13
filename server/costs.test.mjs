import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scryptSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { costing, stlVolume } from "./costs.mjs";
import { Materials } from "./materials.mjs";
import { Assets } from "./assets.mjs";
import { Library } from "./library.mjs";
import { createApp } from "./app.mjs";

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);
// A 1 × 1 × 1 mm cube as a binary STL (12 triangles, outward winding).
function cube(s = 1) {
  const v = [[0,0,0],[s,0,0],[s,s,0],[0,s,0],[0,0,s],[s,0,s],[s,s,s],[0,s,s]];
  const f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  const buf = Buffer.alloc(84 + f.length * 50); buf.writeUInt32LE(f.length, 80);
  f.forEach((t, i) => t.forEach((p, k) => v[p].forEach((x, a) => buf.writeFloatLE(x, 84 + i * 50 + 12 + k * 12 + a * 4))));
  return buf;
}

const A = (id, type, extra = {}) => ({ id, name: id, type, fit: {}, hasStl: type !== "Purchased", hash: id, ...extra });
const assets = [
  A("top", "Faceplate", { fit: { style: "Handheld", size: "Standard" } }), A("bottom", "Faceplate"), A("bridge", "Part"),
  A("magnet", "Purchased", { supplyId: "mag" }), A("case16", "Case", { fit: { phone: "iPhone 16 Pro" } }), A("pin", "Part"),
];
const vol = { top: 2000, bottom: 1000, bridge: 100, case16: 9000, pin: 50 };
const files = [
  { id: "f1", name: "Handheld top + bottom", scope: "playcase", updated: "2026-11-10", filamentSupplies: {}, plates: [{ index: 1, grams: 30, quantity: null, filaments: [{ id: 1, type: "TPU-AMS", grams: 30 }], coverage: [{ assetId: "top" }, { assetId: "bottom" }] }] },
  { id: "f2", name: "Bridges", scope: "playcase", filamentSupplies: {}, plates: [{ index: 1, grams: 2, quantity: 2, filaments: [{ id: 1, type: "PLA", grams: 2 }], coverage: [{ assetId: "bridge" }] }] },
  { id: "f3", name: "16 Pro case", scope: "playcase", filamentSupplies: {}, plates: [{ index: 1, grams: 50, filaments: [{ id: 1, type: "TPU-AMS", grams: 50 }], coverage: [{ assetId: "case16" }] }] },
  { id: "f4", name: "Personal test", scope: "personal", filamentSupplies: {}, plates: [{ index: 1, grams: 1, filaments: [{ id: 1, type: "PLA" }], coverage: [{ assetId: "pin" }] }] },
];
const prices = { "bambu-tpu-ams": 0.024, "proto-conductive": 0.09, flex: 0.1098, mag: 0.045, small: 0.5, large: 0.88, pouch: 0.11 };
const supplies = (over = {}) => ({
  settings: { filamentMap: { "TPU-AMS": "bambu-tpu-ams", PLA: "proto-conductive" }, packaging: { small: "small", large: "large", pouch: "pouch" }, pouchesPerPiece: 1, ...over },
  best: (id) => (prices[id] === undefined ? null : { price: prices[id], name: id, unit: "x", delivered: false }),
});
const handheld = { id: "hh", name: "Handheld", type: "Faceplate", components: [{ assetId: "top", quantity: 1 }, { assetId: "bottom", quantity: 1 }, { assetId: "bridge", quantity: 1 }, { assetId: "magnet", quantity: 12 }] };
const make = (o = {}) => costing({ assets, assemblies: [handheld], files, supplies: supplies(), volumeOf: (id) => vol[id] ?? null, ...o });

test("STL volume of a closed mesh", () => {
  near(stlVolume(cube()), 1);
  near(stlVolume(cube(2)), 8);
});

test("assembly cost: plate grams split by volume, filament per gram, bought parts per piece", () => {
  const c = make().assemblyCost(handheld);
  const line = (id) => c.parts.find((p) => p.assetId === id);
  near(line("top").grams, 20); near(line("top").cost, 20 * 0.024);   // 2000 of 3000 mm³ of a 30 g plate
  near(line("bottom").cost, 10 * 0.024);
  near(line("bridge").cost, 1 * 0.09);                                 // 2 g plate, 2 pieces
  near(line("magnet").cost, 12 * 0.045); assert.equal(line("magnet").kind, "bought");
  near(c.total, 0.48 + 0.24 + 0.09 + 0.54);
  assert.equal(c.complete, true); assert.deepEqual(c.missing, []);
});

test("missing prints, unmatched filament and missing prices are listed, never counted as $0", () => {
  const withPin = { ...handheld, components: [...handheld.components, { assetId: "pin", quantity: 8 }] };
  const c = make().assemblyCost(withPin);
  assert.equal(c.complete, false);
  assert.match(c.missing.join(), /pin: no sliced print linked/); // personal prints don't count
  near(c.total, 0.48 + 0.24 + 0.09 + 0.54);
  const noMap = make({ supplies: supplies({ filamentMap: { "TPU-AMS": "bambu-tpu-ams" } }) }).assemblyCost(handheld);
  assert.match(noMap.missing.join(), /filament PLA on "Bridges" isn't matched/);
  const noMagnetPrice = costing({ assets, assemblies: [handheld], files, volumeOf: (id) => vol[id], supplies: { ...supplies(), best: (id) => (id === "mag" ? null : supplies().best(id)) } }).assemblyCost(handheld);
  assert.match(noMagnetPrice.missing.join(), /magnet: no price/);
});

test("a print's filament override and per-filament grams are used", () => {
  const over = files.map((f) => (f.id === "f1" ? { ...f, filamentSupplies: { 1: "flex" } } : f));
  near(make({ files: over }).assemblyCost(handheld).parts[0].cost, 20 * 0.1098);
  const two = files.map((f) => (f.id === "f1" ? { ...f, plates: [{ ...f.plates[0], grams: 22.24, coverage: [{ assetId: "top" }], filaments: [{ id: 1, type: "TPU-AMS", grams: 20 }, { id: 3, type: "PLA", grams: 2.24 }] }] } : f));
  const top = make({ files: two }).assemblyCost(handheld).parts[0];
  near(top.cost, 20 * 0.024 + 2.24 * 0.09); assert.equal(top.estimated, false);
});

test("order cost: case + faceplate assemblies + packaging chosen by what's in the order", () => {
  const caseOnly = make().orderCost({ items: [{ name: "Case only", phone: "iPhone 16 Pro", quantity: 1 }] });
  near(caseOnly.total, 50 * 0.024 + 0.5 + 0.11);
  assert.deepEqual(caseOnly.lines.slice(1).map((l) => l.label), ["small (case only)", "pouch"]);
  const kit = make().orderCost({ items: [{ name: "Kit", phone: "iPhone 16 Pro", quantity: 1, parts: [{ name: "Handheld Faceplate" }] }] });
  near(kit.total, 1.2 + 1.35 + 0.88 + 2 * 0.11); // a pouch for the case and one for the faceplate assert.equal(kit.complete, true);
  const twoCases = make().orderCost({ items: [{ name: "Case only", phone: "iPhone 16 Pro", quantity: 2 }] });
  near(twoCases.total, 2 * 1.2 + 0.88 + 2 * 0.11);
  const pouches = make({ supplies: supplies({ pouchesPerPiece: 2 }) }).orderCost({ items: [{ name: "Case only", phone: "iPhone 16 Pro", quantity: 1 }] });
  near(pouches.total, 1.2 + 0.5 + 0.22);
  const twoKits = make().orderCost({ items: [{ name: "Kit", phone: "iPhone 16 Pro", quantity: 2, parts: [{ name: "Handheld Faceplate" }] }] });
  assert.equal(twoKits.lines.find((l) => l.label === "pouch").quantity, 4);
  const noPouch = make({ supplies: supplies({ pouchesPerPiece: 0 }) }).orderCost({ items: [{ name: "Case only", phone: "iPhone 16 Pro", quantity: 1 }] });
  assert.equal(noPouch.lines.some((l) => l.label === "pouch"), false);
  const noBox = make({ supplies: supplies({ packaging: { small: null, large: "large", pouch: "pouch" } }) }).orderCost({ items: [{ name: "Case only", phone: "iPhone 16 Pro", quantity: 1 }] });
  assert.equal(noBox.complete, false); assert.match(noBox.missing.join(), /no packaging supply/);
});

test("supplies, bought-part and cost API: authenticated, validated, and /api/materials keeps its shape", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spoolside-costs-"));
  const db = new DatabaseSync(":memory:");
  const materials = new Materials(db, { fetcher: async () => ({ ok: false, status: 503 }) });
  const assetStore = new Assets(":memory:", path.join(dir, "assets"));
  const library = new Library(":memory:", path.join(dir, "library"));
  const salt = "d".repeat(32);
  const { app, close } = createApp({ pinHash: salt + ":" + scryptSync("12345678", salt, 64).toString("hex"), secure: false, origin: "http://localhost", assets: assetStore, library, materials });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + "/api/supplies")).status, 401);
    const login = await fetch(base + "/login", { method: "POST", redirect: "manual", headers: { Origin: "http://localhost" }, body: new URLSearchParams({ pin: "12345678" }) });
    const cookie = login.headers.get("set-cookie").split(";")[0], h = { Cookie: cookie, Origin: "http://localhost", "Content-Type": "application/json" };
    const call = (m, u, b) => fetch(base + u, { method: m, headers: h, body: b === undefined ? undefined : JSON.stringify(b) });
    let r = await (await call("POST", "/api/supplies", { name: "Magnets, 3 x 2 mm", kind: "part", url: "https://www.amazon.com/dp/B08NZTN426" })).json();
    const mag = r.supplies.find((s) => s.kind === "part");
    await call("POST", "/api/supply-offers", { supplyId: mag.id, seller: "Amazon", label: "MEALOS 200 pcs", url: "https://www.amazon.com/dp/B08NZTN426", price: 8.99, quantity: 200, available: true });
    const old = await (await call("GET", "/api/materials")).json();
    assert.deepEqual(Object.keys(old).sort(), ["materials", "settings"]);
    assert.deepEqual(Object.keys(old.settings).sort(), ["sort", "zip"]);
    assert.equal(old.materials.length, 4); assert.ok(old.materials.every((m) => m.kind === "filament"));
    assert.equal((await call("POST", "/api/assets/purchased", { name: "Magnet", supplyId: "nope" })).status, 400);
    assert.equal((await call("POST", "/api/assets/purchased", { name: "Magnet", supplyId: "bambu-tpu-ams" })).status, 400);
    const magnet = await (await call("POST", "/api/assets/purchased", { name: "Magnet", supplyId: mag.id })).json();
    assert.equal(magnet.type, "Purchased");
    assert.equal((await call("DELETE", "/api/supplies/" + mag.id)).status, 409);
    const asm = assetStore.saveAssembly({ name: "Magnets only", type: "Faceplate", components: [{ assetId: magnet.id, quantity: 12 }] });
    const cost = await (await call("GET", `/api/assemblies/${asm.id}/cost`)).json();
    near(cost.total, 12 * 8.99 / 200); assert.equal(cost.complete, true);
    const all = await (await call("GET", "/api/costs/assemblies")).json();
    near(all[asm.id].total, cost.total);
    assert.equal((await call("GET", "/api/assemblies/nope/cost")).status, 404);
    const [file] = library.add("Two filaments", fs.readFileSync(new URL("./fixtures/plate.gcode.3mf", import.meta.url)));
    assert.equal((await call("PUT", `/api/library/${file.id}/filaments`, { 1: "recreus-filaflex-70a" })).status, 200);
    assert.equal((await call("PUT", `/api/library/${file.id}/filaments`, { 1: mag.id })).status, 400);
  } finally { await new Promise((r) => server.close(r)); close(); library.close(); assetStore.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
