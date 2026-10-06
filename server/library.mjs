import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
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
      size = buf.readUInt32LE(p + 20),
      nameLen = buf.readUInt16LE(p + 28),
      extraLen = buf.readUInt16LE(p + 30),
      commentLen = buf.readUInt16LE(p + 32),
      offset = buf.readUInt32LE(p + 42);
    entries.set(buf.toString("utf8", p + 46, p + 46 + nameLen), { method, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
export function zipRead(buf, entry) {
  const p = entry.offset;
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const data = buf.subarray(start, start + entry.size);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRawSync(data);
  throw Error("Unsupported .3mf compression");
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
  if (!sliced.length) throw Error("This file isn't sliced. Export it from Bambu Studio with File → Export → Export plate sliced file.");
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
  }
  list() {
    return this.db
      .prepare("SELECT id, name, size, plates, created FROM library ORDER BY name COLLATE NOCASE")
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
  add(name, buf) {
    const { plates } = inspect3mf(buf);
    const clean = String(name || "").replace(/\.gcode\.3mf$|\.3mf$/i, "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 80) || "Untitled print";
    const id = randomUUID();
    fs.writeFileSync(this.file(id), buf, { mode: 0o600 });
    this.db.prepare("INSERT INTO library VALUES (?,?,?,?,?)").run(id, clean, buf.length, JSON.stringify(plates), new Date().toISOString());
    return this.get(id);
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
