import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const TYPES = ["Case", "Faceplate", "Sleeve", "Part", "Phone"];
export const STATUSES = ["Up to date", "Stale"];
// Two statuses only. Older names map in: Current is up to date, everything else is stale.
export const normalizeStatus = (s) => (s === "Up to date" || s === "Current" ? "Up to date" : "Stale");
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
    status: normalizeStatus(input.status ?? prior.status),
    note: text(input.note ?? prior.note, 500),
    fit: {
      phone: text(fit.phone, 60),
      style: text(fit.style, 40),
      size: text(fit.size, 20),
      piece: text(fit.piece, 40),
    },
    source: text(input.source ?? prior.source, 300),
    category: text(input.category ?? prior.category, 40),
  };
  if (!out.name) throw Error("Name is required");
  if (!TYPES.includes(out.type)) throw Error("Choose Case, Faceplate, Sleeve, Part or Phone");
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
    // Each position is x, y, z in mm, plus an optional turn in degrees around the vertical axis.
    if (c.positions.length > 20 || !c.positions.every((p) => Array.isArray(p) && (p.length === 3 || p.length === 4) && p.every((n) => Number.isFinite(n) && Math.abs(n) <= 500)))
      throw Error("Positions must be up to 20 x, y, z offsets in mm, with an optional rotation");
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
    this.db.exec("CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, color TEXT NOT NULL)");
    for (const r of this.db.prepare("SELECT id, body FROM assets").all()) {
      const body = JSON.parse(r.body);
      if (!STATUSES.includes(body.status)) this.db.prepare("UPDATE assets SET body=? WHERE id=?").run(JSON.stringify({ ...body, status: normalizeStatus(body.status) }), r.id);
    }
    this.seedCategories();
  }
  // First run only: create starter categories and sort existing items into them by name/type.
  seedCategories() {
    if (this.db.prepare("SELECT COUNT(*) n FROM categories").get().n) return;
    const starters = [["body", "Body", "#5b6bb5"], ["buttons", "Buttons", "#2b2b2b"], ["membranes", "Membranes", "#5aa9a3"], ["hardware", "Hardware", "#9aa6ab"]];
    for (const c of starters) this.db.prepare("INSERT INTO categories VALUES (?,?,?)").run(...c);
    for (const a of this.list()) {
      if (a.category) continue;
      const n = a.name.toLowerCase();
      const category = /membrane/.test(n) ? "membranes"
        : /button|abxy|d-pad|paddle|trigger|start/.test(n) ? "buttons"
        : ["Case", "Faceplate", "Sleeve"].includes(a.type) ? "body"
        : "hardware";
      this.db.prepare("UPDATE assets SET body=? WHERE id=?").run(JSON.stringify({ ...clean({}, a), category }), a.id);
    }
  }
  categories() {
    return this.db.prepare("SELECT * FROM categories ORDER BY name COLLATE NOCASE").all();
  }
  saveCategory(input, id = randomUUID()) {
    const name = text(input.name, 40), color = String(input.color || "").toLowerCase();
    if (!name || !/^#[0-9a-f]{6}$/.test(color)) throw Error("Category needs a name and a color");
    try {
      this.db.prepare("INSERT INTO categories VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color").run(id, name, color);
    } catch {
      throw Error("A category with that name already exists");
    }
    return this.db.prepare("SELECT * FROM categories WHERE id=?").get(id);
  }
  // Items in a deleted category become uncategorized; nothing else changes.
  deleteCategory(id) {
    for (const a of this.list().filter((a) => a.category === id))
      this.db.prepare("UPDATE assets SET body=? WHERE id=?").run(JSON.stringify({ ...clean({}, a), category: "" }), a.id);
    this.db.prepare("DELETE FROM categories WHERE id=?").run(String(id));
  }
  row(r) {
    const design = this.db.prepare("SELECT d.* FROM designfiles d JOIN design_links l ON l.design=d.id WHERE l.asset=?").get(r.id);
    return { id: r.id, ...JSON.parse(r.body), designFile:design || null, hasStl:r.triangles > 0, complete:!!design, hash: r.hash, triangles: r.triangles, dims: JSON.parse(r.dims), bytes: r.bytes, updated: r.updated, thumb: r.triangles > 0 && fs.existsSync(this.assetThumbFile(r.id, r.hash)) };
  }
  // Small part thumbnails, keyed to the STL hash so a replaced model gets a fresh image.
  assetThumbFile(id, hash) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw Object.assign(Error("Unknown asset"), { status: 404 });
    return path.join(this.dir, `thumb-${id}-${String(hash).slice(0, 12)}.png`);
  }
  setAssetThumb(id, png) {
    const asset = this.get(id);
    if (!asset?.hasStl) throw Object.assign(Error("Unknown asset"), { status: 404 });
    if (!Buffer.isBuffer(png) || png.length > 1_000_000 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error("Thumbnail must be a PNG under 1 MB");
    this.removeAssetThumbs(id);
    fs.writeFileSync(this.assetThumbFile(id, asset.hash), png, { mode: 0o600 });
    return this.get(id);
  }
  removeAssetThumbs(id) {
    for (const f of fs.readdirSync(this.dir)) if (f.startsWith(`thumb-${id}-`)) fs.rmSync(path.join(this.dir, f), { force: true });
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
  // Phone references: an Apple .usdz model per phone, for viewing (AR Quick Look on iPhone) and download.
  phoneFile(id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw Object.assign(Error("Unknown asset"), { status: 404 });
    return path.join(this.dir, `phone-${id}.usdz`);
  }
  addPhone(meta, buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 4 || buf.length > 60 * 1024 * 1024 || buf.readUInt32LE(0) !== 0x04034b50) throw Error("Choose a .usdz model under 60 MB");
    const body = clean({ ...meta, type: "Phone", status: meta.status || "Up to date" });
    if (body.source && this.db.prepare("SELECT 1 FROM deleted_sources WHERE source=?").get(body.source)) throw Object.assign(Error("Deleted in Spoolside; not re-imported"), { status: 409 });
    const existing = body.source && this.list().find((a) => a.source === body.source), id = existing?.id || randomUUID();
    fs.writeFileSync(this.phoneFile(id), buf, { mode: 0o600 });
    this.db.prepare("INSERT INTO assets VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body, hash=excluded.hash, bytes=excluded.bytes, updated=excluded.updated")
      .run(id, JSON.stringify(existing ? clean({ ...body, name: existing.name, status: existing.status, note: existing.note }, existing) : body), createHash("sha256").update(buf).digest("hex"), 0, "[]", buf.length, new Date().toISOString());
    return this.get(id);
  }

  linkDesign(assetId,designId) {
    if(!this.get(assetId))throw Error("Unknown asset");
    if(designId===null)this.db.prepare("DELETE FROM design_links WHERE asset=?").run(assetId);
    else {if(!this.db.prepare("SELECT id FROM designfiles WHERE id=?").get(designId))throw Error("Unknown design");this.db.prepare("INSERT INTO design_links VALUES(?,?) ON CONFLICT(asset) DO UPDATE SET design=excluded.design").run(assetId,designId);}
    return this.get(assetId);
  }
  assemblies() {
    this.db.exec("CREATE TABLE IF NOT EXISTS assembly_thumbs (id TEXT PRIMARY KEY, key TEXT NOT NULL)");
    this.db.exec("CREATE TABLE IF NOT EXISTS assembly_order (id TEXT PRIMARY KEY, pos INTEGER NOT NULL)");
    const keys=new Map(this.db.prepare("SELECT id,key FROM assembly_thumbs").all().map(r=>[r.id,r.key]));
    const pos=new Map(this.db.prepare("SELECT id,pos FROM assembly_order").all().map(r=>[r.id,r.pos]));
    // Your arranged order first; anything not yet placed follows by name.
    return this.db.prepare("SELECT id,body FROM assemblies").all().map(r=>({id:r.id,...JSON.parse(r.body),thumbKey:keys.get(r.id)||null}))
      .sort((a,b)=>(pos.get(a.id)??1e9)-(pos.get(b.id)??1e9) || a.name.localeCompare(b.name,undefined,{numeric:true}));
  }
  orderAssemblies(ids) {
    const known=new Set(this.assemblies().map(a=>a.id));
    if(!Array.isArray(ids) || ids.length>1000 || new Set(ids).size!==ids.length || !ids.every(id=>known.has(id))) throw Error("Invalid assembly order");
    this.db.exec("BEGIN");
    try { this.db.exec("DELETE FROM assembly_order"); ids.forEach((id,i)=>this.db.prepare("INSERT INTO assembly_order VALUES(?,?)").run(id,i)); this.db.exec("COMMIT"); }
    catch(e) { this.db.exec("ROLLBACK"); throw e; }
    return this.assemblies();
  }
  // Snapshot of the assembled preview for list cards. The key is a client-computed
  // fingerprint of parts, positions, colors and STL hashes; a stale key means re-render.
  assemblyThumbFile(id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw Object.assign(Error("Unknown assembly"), { status: 404 });
    return path.join(this.dir, `assembly-${id}.png`);
  }
  setAssemblyThumb(id, key, png) {
    if (!this.db.prepare("SELECT 1 FROM assemblies WHERE id=?").get(id)) throw Object.assign(Error("Unknown assembly"), { status: 404 });
    if (!/^[0-9a-z]{1,40}$/.test(String(key))) throw Error("Invalid preview key");
    if (!Buffer.isBuffer(png) || png.length > 1_500_000 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error("Preview must be a PNG under 1.5 MB");
    fs.writeFileSync(this.assemblyThumbFile(id), png, { mode: 0o600 });
    this.db.prepare("INSERT INTO assembly_thumbs VALUES(?,?) ON CONFLICT(id) DO UPDATE SET key=excluded.key").run(id, String(key));
    return { id, thumbKey: String(key) };
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
    const prior=this.assemblies().find(a=>a.id===id);
    const signature=c=>JSON.stringify(c.map(x=>[x.assetId,x.quantity]).sort());
    const unchanged=prior && signature(prior.components)===signature(components);
    const partsConfirmed=input.partsConfirmed===true && (!prior || unchanged || input.confirmParts===true);
    const body={name,sku,type,components,removed,partsConfirmed};
    this.db.prepare("INSERT INTO assemblies VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(id,JSON.stringify(body));
    return {id,...body};
  }
  deleteAssembly(id) {
    this.db.prepare("DELETE FROM assemblies WHERE id=?").run(id);
    this.db.exec("CREATE TABLE IF NOT EXISTS assembly_thumbs (id TEXT PRIMARY KEY, key TEXT NOT NULL)");
    this.db.prepare("DELETE FROM assembly_thumbs WHERE id=?").run(id);
    if (/^[0-9a-f-]{36}$/.test(id)) fs.rmSync(this.assemblyThumbFile(id), { force: true });
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
    if (body.source && this.db.prepare("SELECT 1 FROM deleted_sources WHERE source=?").get(body.source))
      throw Object.assign(Error("Deleted in Spoolside; not re-imported"), { status: 409 });
    const { triangles, size } = inspectStl(buf);
    const hash = createHash("sha256").update(buf).digest("hex");
    const existing = body.source && this.list().find((a) => a.source === body.source);
    const id = existing?.id || randomUUID();
    fs.writeFileSync(this.file(id), buf, { mode: 0o600 });
    this.db.prepare("INSERT INTO assets VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body, hash=excluded.hash, triangles=excluded.triangles, dims=excluded.dims, bytes=excluded.bytes, updated=excluded.updated")
      .run(id, JSON.stringify(existing ? clean({ ...meta, name: existing.name, status: existing.status, note: existing.note || body.note, category: existing.category }, existing) : body), hash, triangles, JSON.stringify(size), buf.length, new Date().toISOString());
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
    fs.rmSync(this.phoneFile(id), { force: true });
    this.removeAssetThumbs(id);
  }
  close() {
    this.db.close();
  }
}
