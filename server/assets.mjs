import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const TYPES = ["Case", "Faceplate", "Sleeve", "Part", "Phone Base"];
export const STATUSES = ["Current", "Needs update", "Needs check", "Experimental", "Retired"];
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
  if (!TYPES.includes(out.type)) throw Error("Choose Case, Faceplate, Sleeve, Part or Phone Base");
  if (!STATUSES.includes(out.status)) throw Error("Unknown status");
  if (![3, 4].includes(out.generation)) throw Error("Generation must be 3 or 4");
  return out;
}

// Optional display-only settings for an assembly part: color, and positions (mm offsets
// from where the STL sits) so one printed piece can be shown several times, e.g. ABXY.
function extras(c) {
  const out = {};
  if (/^#[0-9a-f]{6}$/i.test(c.color || "")) out.color = c.color.toLowerCase();
  if (Array.isArray(c.positions) && c.positions.length) {
    if (c.positions.length > 20 || !c.positions.every((p) => Array.isArray(p) && p.length === 3 && p.every((n) => Number.isFinite(n) && Math.abs(n) <= 500)))
      throw Error("Positions must be up to 20 x, y, z offsets in mm");
    out.positions = c.positions.map((p) => p.map((n) => Math.round(n * 100) / 100));
  }
  return out;
}
export class Assets {
  constructor(dbFile, dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(dbFile);
    this.db.exec("CREATE TABLE IF NOT EXISTS designfiles (id TEXT PRIMARY KEY, source TEXT UNIQUE NOT NULL, name TEXT NOT NULL, hash TEXT NOT NULL, bytes INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS design_links (asset TEXT PRIMARY KEY, design TEXT NOT NULL); CREATE TABLE IF NOT EXISTS deleted_sources (source TEXT PRIMARY KEY, deleted TEXT NOT NULL)");
    this.db.exec("CREATE TABLE IF NOT EXISTS assemblies (id TEXT PRIMARY KEY, body TEXT NOT NULL)");
    this.db.exec("CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, body TEXT NOT NULL, hash TEXT NOT NULL, triangles INTEGER NOT NULL, dims TEXT NOT NULL, bytes INTEGER NOT NULL, updated TEXT NOT NULL)");
  }
  row(r) {
    const design = this.db.prepare("SELECT d.* FROM designfiles d JOIN design_links l ON l.design=d.id WHERE l.asset=?").get(r.id);
    return { id: r.id, ...JSON.parse(r.body), designFile:design || null, hasStl:r.triangles > 0, complete:!!design, hash: r.hash, triangles: r.triangles, dims: JSON.parse(r.dims), bytes: r.bytes, updated: r.updated };
  }
  list() {
    return this.db.prepare("SELECT * FROM assets").all().map((r) => this.row(r))
      .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  }
  designs() {return this.db.prepare("SELECT * FROM designfiles ORDER BY source").all();}
  designFile(id) {const d=this.db.prepare("SELECT * FROM designfiles WHERE id=?").get(id);if(!d)throw Error("Unknown design file");return {meta:d,path:path.join(this.dir,`design-${d.id}${path.extname(d.name).toLowerCase()}`)};}
  addDesign(meta,buf) {
    const source=text(meta.source,300),name=text(meta.name,120);
    if(!source||!name||!/[.](c4d|blend|f3d|step|stp|ai)$/i.test(name)||!Buffer.isBuffer(buf)||!buf.length||buf.length>150*1024*1024)throw Error("Invalid design file");
    const prior=this.db.prepare("SELECT id FROM designfiles WHERE source=?").get(source),id=prior?.id || randomUUID();
    fs.writeFileSync(path.join(this.dir,`design-${id}${path.extname(name).toLowerCase()}`),buf,{mode:0o600});
    this.db.prepare("INSERT INTO designfiles VALUES(?,?,?,?,?) ON CONFLICT(source) DO UPDATE SET name=excluded.name,hash=excluded.hash,bytes=excluded.bytes").run(id,source,name,createHash("sha256").update(buf).digest("hex"),buf.length);
    return this.db.prepare("SELECT * FROM designfiles WHERE id=?").get(id);
  }
  addPhoneBase(meta, designId) {
    const design=this.designFile(designId).meta;
    const body=clean({...meta,type:"Phone Base"});
    const existing=this.list().find(a=>a.source===body.source),id=existing?.id || randomUUID();
    this.db.prepare("INSERT INTO assets VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,hash=excluded.hash,bytes=excluded.bytes,updated=excluded.updated").run(id,JSON.stringify(existing?clean({...body,status:existing.status,note:existing.note},existing):body),design.hash,0,"[]",design.bytes,new Date().toISOString());
    return this.linkDesign(id,designId);
  }
  linkDesign(assetId,designId) {
    if(!this.get(assetId))throw Error("Unknown asset");
    if(designId===null)this.db.prepare("DELETE FROM design_links WHERE asset=?").run(assetId);
    else {if(!this.db.prepare("SELECT id FROM designfiles WHERE id=?").get(designId))throw Error("Unknown design");this.db.prepare("INSERT INTO design_links VALUES(?,?) ON CONFLICT(asset) DO UPDATE SET design=excluded.design").run(assetId,designId);}
    return this.get(assetId);
  }
  assemblies() {
    return this.db.prepare("SELECT id,body FROM assemblies").all().map(r=>({id:r.id,...JSON.parse(r.body)})).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
  }
  saveAssembly(input, id = randomUUID()) {
    const name=text(input.name,100),sku=text(input.sku,100),type=input.type;
    if(!name || !["Case","Faceplate","Sleeve"].includes(type)) throw Error("Assembly name and type are required");
    if(!Array.isArray(input.components) || input.components.length>100) throw Error("Select assembly components");
    const seen=new Set();
    const components=input.components.map(c=>{
      if(!this.get(c.assetId) || seen.has(c.assetId) || !Number.isInteger(c.quantity) || c.quantity<1 || c.quantity>100) throw Error("Invalid assembly component or quantity");
      seen.add(c.assetId);return {assetId:c.assetId,quantity:c.quantity,...extras(c)};
    });
    // Removed parts are kept (not deleted) so they can be restored later.
    const removed=(Array.isArray(input.removed)?input.removed:[]).filter(c=>this.get(c.assetId) && !seen.has(c.assetId)).slice(0,100)
      .map(c=>({assetId:c.assetId,quantity:Number.isInteger(c.quantity)&&c.quantity>0&&c.quantity<=100?c.quantity:1,...extras(c)}))
      .filter((c,i,all)=>all.findIndex(x=>x.assetId===c.assetId)===i);
    if(!components.length && !removed.length) throw Error("Select assembly components");
    const body={name,sku,type,components,removed};
    this.db.prepare("INSERT INTO assemblies VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(id,JSON.stringify(body));
    return {id,...body};
  }
  deleteAssembly(id) {this.db.prepare("DELETE FROM assemblies WHERE id=?").run(id);}
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
    if (body.source && this.db.prepare("SELECT 1 FROM deleted_sources WHERE source=?").get(body.source))
      throw Object.assign(Error("Deleted in Spoolside; not re-imported"), { status: 409 });
    const { triangles, size } = inspectStl(buf);
    const hash = createHash("sha256").update(buf).digest("hex");
    const existing = body.source && this.list().find((a) => a.source === body.source);
    const id = existing?.id || randomUUID();
    fs.writeFileSync(this.file(id), buf, { mode: 0o600 });
    this.db.prepare("INSERT INTO assets VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body, hash=excluded.hash, triangles=excluded.triangles, dims=excluded.dims, bytes=excluded.bytes, updated=excluded.updated")
      .run(id, JSON.stringify(existing ? clean({ ...meta, name: existing.name, status: existing.status, note: existing.note || body.note }, existing) : body), hash, triangles, JSON.stringify(size), buf.length, new Date().toISOString());
    return this.get(id);
  }
  update(id, patch) {
    const prior = this.get(id);
    if (!prior) throw Object.assign(Error("Unknown asset"), { status: 404 });
    const body = clean(patch, prior);
    this.db.prepare("UPDATE assets SET body=?, updated=? WHERE id=?").run(JSON.stringify(body), new Date().toISOString(), id);
    return this.get(id);
  }
  // Deleting removes the item from Spoolside only (Dropbox is untouched) and remembers its
  // source so the folder import doesn't bring it back.
  remove(id) {
    const used = this.assemblies().filter(a=>[...a.components,...(a.removed||[])].some(c=>c.assetId===id)).map(a=>a.name);
    if (used.length) throw Object.assign(Error(`Used in ${used.join(", ")}. Remove it from ${used.length === 1 ? "that assembly" : "those assemblies"} first.`), { status: 409 });
    const source = this.get(id)?.source;
    if (source) this.db.prepare("INSERT OR IGNORE INTO deleted_sources VALUES (?, ?)").run(source, new Date().toISOString());
    this.db.prepare("DELETE FROM design_links WHERE asset=?").run(String(id));
    this.db.prepare("DELETE FROM assets WHERE id=?").run(String(id));
    fs.rmSync(this.file(id), { force: true });
  }
  close() {
    this.db.close();
  }
}
