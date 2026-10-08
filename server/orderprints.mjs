import { DatabaseSync } from "node:sqlite";

// How many of each piece have been printed for each order: credited when a print started from the
// order comes out fine, or set by hand.
export class OrderPrints {
  constructor(dbFile, now = Date.now) {
    this.now = now;
    this.db = new DatabaseSync(dbFile);
    this.db.exec("CREATE TABLE IF NOT EXISTS order_prints (order_id TEXT NOT NULL, asset_id TEXT NOT NULL, done INTEGER NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (order_id, asset_id))");
    // Prints sent from an order, waiting for the print watcher to pick them up (by printer).
    this.db.exec("CREATE TABLE IF NOT EXISTS order_print_pending (printer TEXT PRIMARY KEY, tag TEXT NOT NULL)");
    this.pending = new Map(this.db.prepare("SELECT printer, tag FROM order_print_pending").all().map(r => [r.printer, JSON.parse(r.tag)]));
  }
  close() {
    this.db.close();
  }
  // orderId -> { assetId: done }
  all() {
    const out = {};
    for (const r of this.db.prepare("SELECT order_id, asset_id, done FROM order_prints WHERE done > 0").all()) (out[r.order_id] ??= {})[r.asset_id] = r.done;
    return out;
  }
  set(orderId, assetId, done) {
    if (typeof orderId !== "string" || typeof assetId !== "string" || !Number.isInteger(done) || done < 0 || done > 100) throw Error("Invalid piece count");
    this.db.prepare("INSERT INTO order_prints VALUES (?,?,?,?) ON CONFLICT(order_id, asset_id) DO UPDATE SET done=excluded.done, updated=excluded.updated").run(orderId, assetId, done, this.now());
  }
  add(orderId, assetIds, delta) {
    const current = this.all()[orderId] || {};
    for (const id of assetIds) this.set(orderId, id, Math.max(0, (current[id] || 0) + delta));
  }
  // A print just sent from an order: remember it until the watcher starts watching that printer.
  sent(printer, tag) {
    const value = { ...tag, at: this.now() };
    this.db.prepare("INSERT INTO order_print_pending VALUES (?,?) ON CONFLICT(printer) DO UPDATE SET tag=excluded.tag").run(printer, JSON.stringify(value));
    this.pending.set(printer, value);
  }
  cancel(printer) {
    this.pending.delete(printer);
    this.db.prepare("DELETE FROM order_print_pending WHERE printer=?").run(printer);
  }
  claim(printer) {
    const tag = this.pending.get(printer);
    this.cancel(printer);
    return tag && this.now() - tag.at < 15 * 60000 ? tag : null;
  }
}
