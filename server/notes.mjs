import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

// Reminder cards on the home page: customer service to-dos like "send #10199 a replacement d-pad".
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, max);
const orderNumber = (s) => {
  const n = clean(s, 20).replace(/^#/, "");
  if (n && !/^[0-9]{1,10}$/.test(n)) throw Error("Order numbers are digits, like 10199");
  return n ? "#" + n : null;
};
export class Notes {
  constructor(dbFile, now = Date.now) {
    this.now = now;
    this.db = new DatabaseSync(dbFile);
    this.db.exec("CREATE TABLE IF NOT EXISTS home_notes (id TEXT PRIMARY KEY, text TEXT NOT NULL, order_number TEXT, created INTEGER NOT NULL, updated INTEGER NOT NULL)");
  }
  close() {
    this.db.close();
  }
  list() {
    return this.db.prepare("SELECT id, text, order_number, created, updated FROM home_notes ORDER BY created").all()
      .map((r) => ({ id: r.id, text: r.text, order: r.order_number, created: r.created, updated: r.updated }));
  }
  add({ text, order } = {}) {
    const body = clean(text, 1000);
    if (!body) throw Error("Write what needs doing");
    this.db.prepare("INSERT INTO home_notes VALUES (?,?,?,?,?)").run(randomUUID(), body, orderNumber(order), this.now(), this.now());
    return this.list();
  }
  update(id, { text, order } = {}) {
    const body = clean(text, 1000);
    if (!body) throw Error("Write what needs doing");
    if (!this.db.prepare("UPDATE home_notes SET text=?, order_number=?, updated=? WHERE id=?").run(body, orderNumber(order), this.now(), id).changes)
      throw Object.assign(Error("That note is gone"), { status: 404 });
    return this.list();
  }
  // Done and deleted are the same: the reminder has served its purpose.
  remove(id) {
    this.db.prepare("DELETE FROM home_notes WHERE id=?").run(id);
    return this.list();
  }
}
