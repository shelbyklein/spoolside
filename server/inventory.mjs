import { DatabaseSync } from "node:sqlite";

// On-hand stock of finished cases and faceplates, by color. Counted by hand, not from prints.
const BASE_COLORS = ["Black", "Grey", "Red", "Green", "Blue"];
const clean = (s) => String(s || "").replace(/[\u0000-\u001f]/g, "").trim();
const title = (s) => clean(s).replace(/\b\w/g, (c) => c.toUpperCase()).replace(/^Gray$/i, "Grey");
export class Inventory {
  constructor(dbFile, now = Date.now) {
    this.now = now;
    this.db = new DatabaseSync(dbFile);
    this.db.exec(`CREATE TABLE IF NOT EXISTS inventory (kind TEXT NOT NULL, item TEXT NOT NULL, color TEXT NOT NULL, count INTEGER NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (kind, item, color));
      CREATE TABLE IF NOT EXISTS inventory_colors (color TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS inventory_hidden (kind TEXT NOT NULL, item TEXT NOT NULL, PRIMARY KEY (kind, item));`);
  }
  close() {
    this.db.close();
  }
  // Cases are the case assets; faceplates are the faceplate assemblies (one per style and size).
  view({ assets = [], assemblies = [], orderColors = [] } = {}) {
    const rows = this.db.prepare("SELECT kind, item, color, count, updated FROM inventory").all();
    const added = this.db.prepare("SELECT color FROM inventory_colors").all().map((r) => r.color);
    const colors = [];
    for (const c of [...BASE_COLORS, ...orderColors.map(title), ...added, ...rows.filter((r) => r.count > 0).map((r) => r.color)])
      if (c && !colors.some((x) => x.toLowerCase() === c.toLowerCase())) colors.push(c);
    const counts = (kind, item) => Object.fromEntries(rows.filter((r) => r.kind === kind && r.item === item && r.count > 0).map((r) => [r.color, r.count]));
    const hidden = new Set(this.db.prepare("SELECT kind, item FROM inventory_hidden").all().map((r) => `${r.kind}|${r.item}`));
    const natural = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
    const items = [
      ...assets.filter((a) => a.type === "Case").sort(natural).map((a) => ({ kind: "case", id: a.id, name: a.name.replace(/\s+(phone\s+)?case$/i, ""), counts: counts("case", a.id), hidden: hidden.has(`case|${a.id}`) })),
      ...assemblies.filter((a) => a.type === "Faceplate").map((a) => ({ kind: "faceplate", id: a.id, name: a.name, counts: counts("faceplate", a.id), hidden: hidden.has(`faceplate|${a.id}`) })),
    ];
    const updated = rows.reduce((n, r) => Math.max(n, r.updated), 0) || null;
    return { colors, items, updated };
  }
  set(kind, item, color, count) {
    if (!["case", "faceplate"].includes(kind) || typeof item !== "string" || !item) throw Error("Choose a case or faceplate");
    const c = title(color);
    if (!c || c.length > 30) throw Error("Choose a color");
    if (!Number.isInteger(count) || count < 0 || count > 100000) throw Error("Enter a count from 0 to 100000");
    this.db.prepare("INSERT INTO inventory VALUES (?,?,?,?,?) ON CONFLICT(kind, item, color) DO UPDATE SET count=excluded.count, updated=excluded.updated").run(kind, item, c, count, this.now());
  }
  // Items not currently sold are hidden from the table; their counts are kept.
  hide(kind, item, hidden) {
    if (!["case", "faceplate"].includes(kind) || typeof item !== "string" || !item) throw Error("Choose a case or faceplate");
    if (typeof hidden !== "boolean") throw Error("Choose hide or show");
    if (hidden) this.db.prepare("INSERT OR IGNORE INTO inventory_hidden VALUES (?,?)").run(kind, item);
    else this.db.prepare("DELETE FROM inventory_hidden WHERE kind = ? AND item = ?").run(kind, item);
  }
  addColor(color) {
    const c = title(color);
    if (!c || c.length > 30) throw Error("Enter a color name");
    this.db.prepare("INSERT OR IGNORE INTO inventory_colors VALUES (?)").run(c);
  }
}
