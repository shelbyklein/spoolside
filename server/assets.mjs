import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const TYPES = ["Case", "Faceplate", "Part"];
export const STATUSES = ["Current", "Needs check", "Experimental", "Retired"];
const text = (v, max) => String(v ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);

// Binary or ASCII STL check plus bounding box, so bad uploads are rejected early.
export function inspectStl(buf) {
  if (buf.length > 84) {
    const n = buf.readUInt32LE(80);
    if (84 + n * 50 === buf.length && n > 0) {
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < n; i++)
        for (let v = 0; v < 3; v++)
          for (let a = 0; a < 3; a++) {
            const x = buf.readFloatLE(84 + i * 50 + 12 + v * 12 + a * 4);
            if (x < min[a]) min[a] = x;
            if (x > max[a]) max[a] = x;
          }
      return { triangles: n, size: max.map((m, a) => Math.round((m - min[a]) * 10) / 10) };
    }
  }
  const head = buf.subarray(0, 512).toString("utf8");
  if (/^\s*solid\b/.test(head) && buf.includes("facet")) {
    const nums = [...buf.toString("utf8").matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].map((m) => m.slice(1).map(Number));
    if (nums.length) {
      const size = [0, 1, 2].map((a) => Math.round((Math.max(...nums.map((v) => v[a])) - Math.min(...nums.map((v) => v[a]))) * 10) / 10);
      return { triangles: nums.length / 3, size };
    }
  }
  throw Error("Not a valid STL file");
}

function clean(input, prior = {}) {
  const fit = input.fit && typeof input.fit === "object" ? input.fit : prior.fit || {};
  const out = {
    name: text(input.name ?? prior.name, 100),
    type: input.type ?? prior.type,
    generation: Number(input.generation ?? prior.generation ?? 3),
    status: input.status ?? prior.status ?? "Needs check",
    note: text(input.note ?? prior.note, 500),
    fit: {
      phone: text(fit.phone, 60),
      style: text(fit.style, 40),
      size: text(fit.size, 20),
      piece: text(fit.piece, 40),
    },
    source: text(input.source ?? prior.source, 300),
  };
  if (!out.name) throw Error("Name is required");
  if (!TYPES.includes(out.type)) throw Error("Choose Case, Faceplate or Part");
  if (!STATUSES.includes(out.status)) throw Error("Unknown status");
  if (![3, 4].includes(out.generation)) throw Error("Generation must be 3 or 4");
  return out;
}

export class Assets {
  constructor(dbFile, dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(dbFile);
    this.db.exec("CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, body TEXT NOT NULL, hash TEXT NOT NULL, triangles INTEGER NOT NULL, dims TEXT NOT NULL, bytes INTEGER NOT NULL, updated TEXT NOT NULL)");
  }
  row(r) {
    return { id: r.id, ...JSON.parse(r.body), hash: r.hash, triangles: r.triangles, dims: JSON.parse(r.dims), bytes: r.bytes, updated: r.updated };
  }
  list() {
    return this.db.prepare("SELECT * FROM assets").all().map((r) => this.row(r))
      .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  }
  get(id) {
    const r = this.db.prepare("SELECT * FROM assets WHERE id=?").get(String(id));
    return r ? this.row(r) : null;
  }
  file(id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw Object.assign(Error("Unknown asset"), { status: 404 });
    return path.join(this.dir, id + ".stl");
  }
  // Adds a model; re-importing the same source path replaces that asset's STL.
  add(meta, buf) {
    const body = clean(meta);
    const { triangles, size } = inspectStl(buf);
    const hash = createHash("sha256").update(buf).digest("hex");
    const existing = body.source && this.list().find((a) => a.source === body.source);
    const id = existing?.id || randomUUID();
    fs.writeFileSync(this.file(id), buf, { mode: 0o600 });
    this.db.prepare("INSERT INTO assets VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body, hash=excluded.hash, triangles=excluded.triangles, dims=excluded.dims, bytes=excluded.bytes, updated=excluded.updated")
      .run(id, JSON.stringify(existing ? clean({ ...meta, status: existing.status, note: existing.note || body.note }, existing) : body), hash, triangles, JSON.stringify(size), buf.length, new Date().toISOString());
    return this.get(id);
  }
  update(id, patch) {
    const prior = this.get(id);
    if (!prior) throw Object.assign(Error("Unknown asset"), { status: 404 });
    const body = clean(patch, prior);
    this.db.prepare("UPDATE assets SET body=?, updated=? WHERE id=?").run(JSON.stringify(body), new Date().toISOString(), id);
    return this.get(id);
  }
  remove(id) {
    this.db.prepare("DELETE FROM assets WHERE id=?").run(String(id));
    fs.rmSync(this.file(id), { force: true });
  }
  close() {
    this.db.close();
  }
}
