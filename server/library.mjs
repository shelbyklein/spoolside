import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";

// Minimal ZIP reader for sliced .3mf files (no zip64; sliced files are far below 4 GB).
export function zipEntries(buf) {
  const min = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--)
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw Error("Not a valid .3mf file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw Error("Not a valid .3mf file");
    const method = buf.readUInt16LE(p + 10),
      crc = buf.readUInt32LE(p + 16),
      size = buf.readUInt32LE(p + 20),
      usize = buf.readUInt32LE(p + 24),
      nameLen = buf.readUInt16LE(p + 28),
      extraLen = buf.readUInt16LE(p + 30),
      commentLen = buf.readUInt16LE(p + 32),
      offset = buf.readUInt32LE(p + 42);
    entries.set(buf.toString("utf8", p + 46, p + 46 + nameLen), { method, crc, size, usize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
const zipData = (buf, entry) => {
  const p = entry.offset;
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  return buf.subarray(start, start + entry.size);
};
export function zipRead(buf, entry) {
  const data = zipData(buf, entry);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRawSync(data);
  throw Error("Unsupported .3mf compression");
}
// Writes a ZIP from entries whose data is already compressed (method 0 = stored, 8 = deflate).
export function zipWrite(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8"), local = Buffer.alloc(30), dir = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(f.method, 8);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(f.crc, 14);
    local.writeUInt32LE(f.data.length, 18);
    local.writeUInt32LE(f.usize, 22);
    local.writeUInt16LE(name.length, 26);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(f.method, 10);
    dir.writeUInt16LE(0x21, 14);
    dir.writeUInt32LE(f.crc, 16);
    dir.writeUInt32LE(f.data.length, 20);
    dir.writeUInt32LE(f.usize, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    parts.push(local, name, f.data);
    central.push(dir, name);
    offset += 30 + name.length + f.data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
const PLATE_FILE = /^Metadata\/(?:plate|plate_no_light|top|pick)_(\d+)(?:_small)?\.(?:gcode(?:\.md5)?|png|json)$/;
// Splits a sliced file with several plates into one printable file per plate: that plate's G-code,
// thumbnails, slice info and G-code relationship, with everything else copied byte for byte.
// Each is named after the parts on its plate. Returns null for single-plate files.
export function splitPlates(buf) {
  const entries = zipEntries(buf), { plates } = inspect3mf(buf);
  if (plates.length < 2) return null;
  const text = (name) => (entries.has(name) ? zipRead(buf, entries.get(name)).toString("utf8") : null);
  const info = text("Metadata/slice_info.config") || "", rels = text("Metadata/_rels/model_settings.config.rels");
  const blocks = [...info.matchAll(/<plate>[\s\S]*?<\/plate>\s*/g)].map((m) => m[0]);
  const packed = (name, body) => {
    const raw = Buffer.from(body, "utf8");
    return { name, method: 8, crc: crc32(raw), usize: raw.length, data: deflateRawSync(raw) };
  };
  return plates.map((plate) => {
    const own = blocks.find((b) => b.includes(`key="index" value="${plate.index}"`)) || "";
    const parts = [...new Set([...own.matchAll(/<object [^>]*name="([^"]*)"/g)].map((m) => m[1].replace(/\.(stl|step|3mf|obj)$/i, "").trim()).filter(Boolean))];
    const label = parts.length === 0 ? `Plate ${plate.index}` : parts.length <= 3 ? parts.join(" + ") : `${parts[0]} + ${parts.length - 1} more`;
    const files = [];
    for (const [name, entry] of entries) {
      const n = name.match(PLATE_FILE)?.[1];
      if (n && Number(n) !== plate.index) continue;
      if (name === "Metadata/slice_info.config") files.push(packed(name, blocks.reduce((s, b) => (b === own ? s : s.replace(b, "")), info)));
      else if (name === "Metadata/_rels/model_settings.config.rels" && rels) files.push(packed(name, rels.replace(/\s*<Relationship [^>]*Target="\/Metadata\/plate_(\d+)\.gcode"[^>]*\/>/g, (m, i) => (Number(i) === plate.index ? m : ""))));
      else files.push({ name, method: entry.method, crc: entry.crc, usize: entry.usize, data: zipData(buf, entry) });
    }
    return { index: plate.index, label, buf: zipWrite(files) };
  });
}
const attr = (tag, name) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? "";
// Reads sliced plates (time, weight, filaments) from a Bambu/Orca .gcode.3mf.
export function inspect3mf(buf) {
  const entries = zipEntries(buf);
  const sliced = [...entries.keys()]
    .map((n) => n.match(/^Metadata\/plate_(\d+)\.gcode$/)?.[1])
    .filter(Boolean)
    .map(Number)
    .sort((a, b) => a - b);
  if (!sliced.length) throw Error("This file isn't sliced yet. In Orca or Bambu Studio, slice all plates, then File → Export → Export all sliced file. Spoolside splits it into one print per plate.");
  const info = entries.has("Metadata/slice_info.config")
    ? zipRead(buf, entries.get("Metadata/slice_info.config")).toString("utf8")
    : "";
  const plates = sliced.map((index) => {
    const block = [...info.matchAll(/<plate>([\s\S]*?)<\/plate>/g)]
      .map((m) => m[1])
      .find((b) => b.includes(`key="index" value="${index}"`)) || "";
    const meta = (k) => block.match(new RegExp(`key="${k}" value="([^"]*)"`))?.[1];
    return {
      index,
      minutes: Math.round(Number(meta("prediction") || 0) / 60),
      grams: Number(meta("weight") || 0),
      filaments: [...block.matchAll(/<filament [^>]*\/>/g)].map((m) => ({
        id: Number(attr(m[0], "id")),
        type: attr(m[0], "type"),
        color: attr(m[0], "color"),
      })),
    };
  });
  return { plates };
}
export class Library {
  constructor(dbFile, dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(dbFile);
    this.db.exec("CREATE TABLE IF NOT EXISTS library (id TEXT PRIMARY KEY, name TEXT NOT NULL, size INTEGER NOT NULL, plates TEXT NOT NULL, created TEXT NOT NULL)");
    if (!this.db.prepare("PRAGMA table_info(library)").all().some((c) => c.name === "updated")) this.db.exec("ALTER TABLE library ADD COLUMN updated TEXT");
  }
  setCoverage(id, plateIndex, ids, assets) {
    const file = this.get(id);
    if (!file || !file.plates.some(p => p.index === plateIndex)) throw Error("Choose a sliced plate");
    if (!Array.isArray(ids) || ids.length > 100 || new Set(ids).size !== ids.length) throw Error("Choose unique assets");
    const coverage = ids.map(assetId => {
      const a = assets?.get(assetId);
      if (!a || !a.hasStl) throw Error("Choose assets with an STL");
      return {assetId, hash: a.hash};
    });
    const plates = file.plates.map(p => p.index === plateIndex ? {...p, coverage} : p);
    this.db.prepare("UPDATE library SET plates=? WHERE id=?").run(JSON.stringify(plates), id);
    return this.get(id);
  }
  list() {
    return this.db
      .prepare("SELECT id, name, size, plates, created, updated FROM library ORDER BY name COLLATE NOCASE")
      .all()
      .map((r) => ({ ...r, plates: JSON.parse(r.plates) }));
  }
  get(id) {
    return this.list().find((f) => f.id === id) || null;
  }
  file(id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw Error("Unknown file");
    return path.join(this.dir, id + ".3mf");
  }
  // Adds a sliced file; one with several plates becomes one entry per plate. Returns the entries;
  // an entry whose name is already in the library replaces that one (marked replaced: true).
  add(name, buf) {
    const split = splitPlates(buf);
    if (!split) return [this.addOne(name, buf)];
    return split.map((p) => this.addOne(p.label, p.buf));
  }
  addOne(name, buf) {
    const { plates } = inspect3mf(buf);
    const clean = String(name || "").replace(/\.gcode\.3mf$|\.3mf$/i, "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 80) || "Untitled print";
    const now = new Date().toISOString();
    const existing = this.list().find((f) => f.name.toLowerCase() === clean.toLowerCase());
    if (existing) {
      // Same print, re-sliced: keep its id and the assets linked to its plates.
      const carried = plates.map((p) => {
        const old = existing.plates.find((o) => o.index === p.index) || (plates.length === 1 && existing.plates.length === 1 ? existing.plates[0] : null);
        return old?.coverage ? { ...p, coverage: old.coverage } : p;
      });
      fs.writeFileSync(this.file(existing.id), buf, { mode: 0o600 });
      this.db.prepare("UPDATE library SET size=?, plates=?, updated=? WHERE id=?").run(buf.length, JSON.stringify(carried), now, existing.id);
      return { ...this.get(existing.id), replaced: true };
    }
    const id = randomUUID();
    fs.writeFileSync(this.file(id), buf, { mode: 0o600 });
    this.db.prepare("INSERT INTO library (id, name, size, plates, created) VALUES (?,?,?,?,?)").run(id, clean, buf.length, JSON.stringify(plates), now);
    return this.get(id);
  }
  // The slicer's preview picture of the file's first plate, if it has one.
  preview(id) {
    const file = this.get(id);
    if (!file) return null;
    const buf = fs.readFileSync(this.file(id)), entries = zipEntries(buf);
    const entry = entries.get(`Metadata/plate_${file.plates[0]?.index}.png`);
    return entry ? zipRead(buf, entry) : null;
  }
  rename(id, name) {
    const clean = String(name || "").trim().slice(0, 80);
    if (!clean || !this.get(id)) throw Error("Unknown file");
    this.db.prepare("UPDATE library SET name=? WHERE id=?").run(clean, id);
    return this.get(id);
  }
  remove(id) {
    this.db.prepare("DELETE FROM library WHERE id=?").run(id);
    fs.rmSync(this.file(id), { force: true });
  }
  close() {
    this.db.close();
  }
}
