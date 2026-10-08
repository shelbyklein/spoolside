import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scryptSync } from "node:crypto";
import { Library, inspect3mf, splitPlates, zipEntries, zipRead, zipWrite } from "./library.mjs";
import { crc32, deflateRawSync } from "node:zlib";
import { createApp } from "./app.mjs";
import { findLastFile } from "./printers.mjs";
const fixture = fs.readFileSync(new URL("./fixtures/plate.gcode.3mf", import.meta.url));

test("sliced 3mf plates, time, weight and filaments are read", () => {
  assert.deepEqual(inspect3mf(fixture).plates, [
    { index: 1, minutes: 64, grams: 22.24, filaments: [
      { id: 1, type: "TPU-AMS", color: "#ED0000" },
      { id: 3, type: "PLA", color: "#000000" },
    ] },
  ]);
  assert.throws(() => inspect3mf(Buffer.from("not a zip")), /valid/);
});

test("print API validates library file, plate clearance and AMS mapping", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spoolside-lib-"));
  const library = new Library(":memory:", dir);
  const calls = [];
  const printers = {
    snapshot: () => [],
    startPrint: async (id, opts) => calls.push(["start", id, opts]),
    lastPrint: async (id) => (id === "P1" ? { remoteName: "Touch Pin.gcode.3mf", subtask: "Touch Pin.gcode.3mf", name: "Touch Pin", plates: inspect3mf(fixture).plates } : null),
    reprint: async (id, opts) => calls.push(["reprint", id, opts]),
    control: async (id, action) => {
      if (!["pause", "resume", "stop"].includes(action)) throw Object.assign(Error("Unknown action"), { status: 400 });
      calls.push([action, id]);
    },
  };
  const salt = "b".repeat(32);
  const { app, close } = createApp({ pinHash: salt + ":" + scryptSync("12345678", salt, 64).toString("hex"), origin: "http://localhost", secure: false, printers, library });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await fetch(base + "/login", { method: "POST", headers: { Origin: "http://localhost" }, body: new URLSearchParams({ pin: "12345678" }), redirect: "manual" });
    const headers = { Cookie: login.headers.get("set-cookie").split(";")[0], Origin: "http://localhost" };
    const up = await fetch(base + "/api/library", { method: "POST", headers: { ...headers, "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent("Handheld – Green.gcode.3mf") }, body: fixture });
    const [file] = await up.json();
    assert.equal(up.status, 200);
    assert.equal(file.name, "Handheld – Green");
    const bad = await fetch(base + "/api/library", { method: "POST", headers: { ...headers, "Content-Type": "application/octet-stream" }, body: Buffer.from("PK nope") });
    assert.equal(bad.status, 400);
    const print = (body) => fetch(base + "/api/printers/P1/print", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const base_ = { fileId: file.id, plate: 1, useAms: true, amsMapping: [2, -1, 3] };
    assert.match((await (await print(base_)).json()).error, /plate is clear/);
    assert.match((await (await print({ ...base_, bedClear: true, amsMapping: [2] })).json()).error, /AMS slot/);
    assert.equal((await print({ ...base_, bedClear: true })).status, 200);
    assert.equal(calls[0][1], "P1");
    assert.deepEqual(calls[0][2].amsMapping, [2, -1, 3]);
    assert.equal(calls[0][2].localFile, library.file(file.id));
    const last = await (await fetch(base + "/api/printers/P1/last-print", { headers })).json();
    assert.deepEqual(Object.keys(last), ["name", "plates"]);
    assert.equal(last.name, "Touch Pin");
    assert.equal(await (await fetch(base + "/api/printers/P2/last-print", { headers })).json(), null);
    const reprint = (id, body) => fetch(base + `/api/printers/${id}/reprint`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.match((await (await reprint("P1", { plate: 1, useAms: true, amsMapping: [2, -1, 3] })).json()).error, /plate is clear/);
    assert.match((await (await reprint("P1", { plate: 2, bedClear: true, useAms: false })).json()).error, /sliced plate/);
    assert.equal((await reprint("P2", { plate: 1, bedClear: true })).status, 404);
    assert.equal((await reprint("P1", { plate: 1, bedClear: true, useAms: true, amsMapping: [2, -1, 3] })).status, 200);
    assert.deepEqual(calls.at(-1), ["reprint", "P1", { plate: 1, amsMapping: [2, -1, 3], useAms: true, bedLevelling: true }]);
    assert.equal((await fetch(base + "/api/printers/P1/stop", { method: "POST", headers })).status, 200);
    assert.equal((await fetch(base + "/api/printers/P1/explode", { method: "POST", headers })).status, 400);
    assert.equal((await fetch(base + "/api/library/" + file.id, { method: "DELETE", headers })).status, 200);
    assert.equal(fs.existsSync(library.file(file.id)), false);
  } finally {
    server.close();
    close();
    library.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the last job's file is found by Bambu Studio and Spoolside names", () => {
  const files = [{ name: "Touch Pin.gcode.3mf" }, { name: "spoolside_Handheld_Green.3mf" }, { name: "Bridge.3mf" }, { name: "Case.gcode.3mf", type: 2 }];
  assert.equal(findLastFile("Touch Pin.gcode.3mf", files).name, "Touch Pin.gcode.3mf");
  assert.equal(findLastFile("Touch Pin", files).name, "Touch Pin.gcode.3mf");
  assert.equal(findLastFile("Handheld – Green", files).name, "spoolside_Handheld_Green.3mf");
  assert.equal(findLastFile("Handheld Green", files).name, "spoolside_Handheld_Green.3mf");
  assert.equal(findLastFile("Bridge", files).name, "Bridge.3mf");
  assert.equal(findLastFile("Case", files), null);
  assert.equal(findLastFile("Missing", files), null);
});

// A two-plate sliced file made from the fixture: plate 2 is a copy of plate 1 with its own part.
function twoPlates() {
  const entries = zipEntries(fixture), files = [];
  const add = (name, raw) => files.push({ name, method: 8, crc: crc32(raw), usize: raw.length, data: deflateRawSync(raw) });
  for (const [name, e] of entries) {
    const raw = zipRead(fixture, e);
    if (name === "Metadata/slice_info.config") {
      const text = raw.toString().replace(/<plate>/, '<plate>\n<object identify_id="1" name="Handheld Green.stl" skipped="false" />');
      const block = text.match(/<plate>[\s\S]*?<\/plate>/)[0];
      add(name, Buffer.from(text.replace(block, block + block.replace('key="index" value="1"', 'key="index" value="2"').replace("Handheld Green.stl", "DS Black.stl"))));
    } else add(name, raw);
    if (name === "Metadata/plate_1.gcode") add("Metadata/plate_2.gcode", Buffer.concat([raw, Buffer.from("; plate 2")]));
  }
  return zipWrite(files);
}

test("a sliced file with several plates splits into one printable file per plate", () => {
  const buf = twoPlates();
  assert.deepEqual(inspect3mf(buf).plates.map((p) => p.index), [1, 2]);
  const parts = splitPlates(buf);
  assert.deepEqual(parts.map((p) => [p.index, p.label]), [[1, "Handheld Green"], [2, "DS Black"]]);
  for (const p of parts) {
    const e = zipEntries(p.buf);
    assert.deepEqual(inspect3mf(p.buf).plates.map((x) => x.index), [p.index]);
    assert.ok(e.has(`Metadata/plate_${p.index}.gcode`));
    assert.equal(e.has(`Metadata/plate_${3 - p.index}.gcode`), false);
    assert.ok(zipRead(p.buf, e.get(`Metadata/plate_${p.index}.gcode`)).equals(zipRead(buf, zipEntries(buf).get(`Metadata/plate_${p.index}.gcode`))));
  }
  assert.equal(splitPlates(fixture), null, "single-plate files stay whole");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spoolside-split-"));
  const library = new Library(":memory:", dir);
  try {
    const added = library.add("Cases v3.gcode.3mf", buf);
    assert.deepEqual(added.map((f) => [f.name, f.plates.map((p) => p.index)]), [["Handheld Green", [1]], ["DS Black", [2]]]);
    assert.ok(fs.statSync(library.file(added[0].id)).size < buf.length);
  } finally {
    library.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
