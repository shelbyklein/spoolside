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
    if (!this.db.prepare("PRAGMA table_info(library)").all().some(c=>c.name === "scope")) this.db.exec("ALTER TABLE library ADD COLUMN scope TEXT NOT NULL DEFAULT 'playcase'");
    this.db.exec("CREATE TABLE IF NOT EXISTS library_jobs (printer TEXT, job TEXT, plate INTEGER, file TEXT, PRIMARY KEY(printer,job,plate))");
    if (!this.db.prepare("PRAGMA table_info(library)").all().some(c => c.name === "printer")) this.db.exec("ALTER TABLE library ADD COLUMN printer TEXT");
    if (!this.db.prepare("PRAGMA table_info(library)").all().some((c) => c.name === "updated")) this.db.exec("ALTER TABLE library ADD COLUMN updated TEXT");
    if (!this.db.prepare("PRAGMA table_info(library)").all().some(c => c.name === "source_name")) {
      this.db.exec("ALTER TABLE library ADD COLUMN source_name TEXT");
      this.db.exec("UPDATE library SET source_name=name");
    }
  }
  // Retain the source-job identity even after the saved print is renamed.
  forJob(printer, job, plate) {
    const link = this.db.prepare("SELECT file FROM library_jobs WHERE printer=? AND job=? AND plate=?").get(printer, job, plate);
    if (link && this.get(link.file)) return this.get(link.file);
    const base = String(job).replace(/(\.gcode)?\.3mf$/i, "");
    const matches = this.list().filter(f => f.plates.some(p => p.index === plate) && [f.name, f.source_name].filter(Boolean).some(name =>
      name === base || "spoolside_" + name.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0,60) === base));
    return matches.length === 1 ? matches[0] : null;
  }
  linkJob(printer, job, plate, file) {
    this.db.prepare("INSERT OR REPLACE INTO library_jobs VALUES (?,?,?,?)").run(printer, job, plate, file);
  }
  details(id, name, quantities, printer) {
    const file = this.get(id);
    const clean = typeof name === "string" ? name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 80) : "";
    if (!file || !clean) throw Error("Enter a print name");
    const owner=file.scope === "personal" && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_slices'").get() ? this.db.prepare("SELECT project FROM project_slices WHERE file=?").get(id)?.project : null;
    if (this.list().some(f => f.id !== id && f.scope === file.scope && (!owner || this.db.prepare("SELECT 1 FROM project_slices WHERE project=? AND file=?").get(owner,f.id)) && f.name.toLowerCase() === clean.toLowerCase())) throw Error("That print name is already in use");
    if (!Array.isArray(quantities) || quantities.length !== file.plates.length || file.plates.some(p => quantities.filter(q => q.plate === p.index).length !== 1) || quantities.some(q => q.quantity !== null && (!Number.isInteger(q.quantity) || q.quantity < 1 || q.quantity > 10000))) throw Error("Choose 1–10000 pieces per plate, or leave it blank");
    if (printer !== undefined) this.db.prepare("UPDATE library SET printer=? WHERE id=?").run(printer || null, id);
    const plates = file.plates.map(p => ({...p, quantity: quantities.find(q => q.plate === p.index).quantity}));
    this.db.prepare("UPDATE library SET name=?, plates=? WHERE id=?").run(clean, JSON.stringify(plates), id);
    return this.get(id);
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
      .prepare("SELECT id, name, size, plates, created, updated, source_name, printer, scope FROM library ORDER BY name COLLATE NOCASE")
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
  add(name, buf, scope = "playcase", project = null) {
    if (!["playcase","personal"].includes(scope)) throw Error("Unknown print library");
    const split = splitPlates(buf);
    if (!split) return [this.addOne(name, buf, scope, project)];
    return split.map((p) => this.addOne(p.label, p.buf, scope, project));
  }
  addOne(name, buf, scope = "playcase", project = null) {
    const { plates } = inspect3mf(buf);
    const clean = String(name || "").replace(/\.gcode\.3mf$|\.3mf$/i, "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 80) || "Untitled print";
    const now = new Date().toISOString();
    const existing = this.list().filter(f=>f.scope===scope && (!project || this.db.prepare("SELECT 1 FROM project_slices WHERE project=? AND file=?").get(project,f.id))).find((f) => (f.source_name || f.name).toLowerCase() === clean.toLowerCase() || f.name.toLowerCase() === clean.toLowerCase());
    if (existing) {
      // Same print, re-sliced: keep its id and the assets linked to its plates.
      const carried = plates.map((p) => {
        const old = existing.plates.find((o) => o.index === p.index) || (plates.length === 1 && existing.plates.length === 1 ? existing.plates[0] : null);
        return old ? { ...p, ...(old.coverage ? {coverage: old.coverage} : {}), ...(old.quantity != null ? {quantity: old.quantity} : {}) } : p;
      });
      fs.writeFileSync(this.file(existing.id), buf, { mode: 0o600 });
      this.db.prepare("UPDATE library SET size=?, plates=?, updated=? WHERE id=?").run(buf.length, JSON.stringify(carried), now, existing.id);
      return { ...this.get(existing.id), replaced: true };
    }
    const id = randomUUID();
    fs.writeFileSync(this.file(id), buf, { mode: 0o600 });
    this.db.prepare("INSERT INTO library (id, name, size, plates, created, source_name, scope) VALUES (?,?,?,?,?,?,?)").run(id, clean, buf.length, JSON.stringify(plates), now, clean, scope);
    return this.get(id);
  }
  metadata(id) {
    const file=this.get(id);if(!file)throw Error("Unknown file");
    const buf=fs.readFileSync(this.file(id)),entries=zipEntries(buf);
    let settings={};const config=entries.get("Metadata/project_settings.config");
    if(config){try{settings=JSON.parse(zipRead(buf,config).toString("utf8"));}catch{}}
    const keys=["printer_model","printer_variant","printer_settings_id","nozzle_diameter","curr_bed_type","bed_type","printable_area","printable_height","layer_height","initial_layer_print_height","filament_type","filament_settings_id","nozzle_temperature","nozzle_temperature_initial_layer","bed_temperature","textured_plate_temp","hot_plate_temp","cool_plate_temp","enable_support","sparse_infill_density","brim_type"];
    const relevant=Object.fromEntries(keys.filter(k=>settings[k]!==undefined).map(k=>[k,settings[k]]));
    const first=entries.get(`Metadata/plate_${file.plates[0]?.index}.gcode`);
    if(first){const header=zipRead(buf,first).toString("utf8").slice(0,30000);for(const k of keys){if(relevant[k]!==undefined)continue;const line=header.match(new RegExp("^;\\s*"+k+"\\s*=\\s*(.+)$","m"));if(line)relevant[k]=line[1].trim();}}
    return {settings:relevant,plates:file.plates};
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
