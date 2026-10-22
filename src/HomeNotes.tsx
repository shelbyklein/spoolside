import { useEffect, useState } from "react";
import { Check, Pencil, Plus, StickyNote } from "lucide-react";
import type { Order } from "./order-model";

type Note = { id: string; text: string; order: string | null; created: number; updated: number };

async function send(method: string, url: string, body?: unknown): Promise<Note[]> {
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || "Couldn't save the note");
  return d;
}
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

// Writing or editing a note: what needs doing, and optionally which order it's for.
function NoteForm({ initial, onSave, onCancel }: { initial?: Note; onSave: (text: string, order: string) => Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState(initial?.text || ""), [order, setOrder] = useState(initial?.order?.replace("#", "") || ""), [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try { await onSave(text, order); } finally { setBusy(false); }
  };
  return (
    <form className="home-note editing" onSubmit={save} onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <textarea aria-label="Note" autoFocus required maxLength={1000} rows={2} placeholder="e.g. Send Jane a replacement d-pad membrane" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="home-note-form-row">
        <label>Order <span>#</span><input aria-label="Order number (optional)" inputMode="numeric" placeholder="optional" value={order} onChange={(e) => setOrder(e.target.value.replace(/[^0-9]/g, ""))} /></label>
        <button type="button" className="text-button" onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={busy || !text.trim()}>{initial ? "Save" : "Add note"}</button>
      </div>
    </form>
  );
}

// Home page: reminder cards for customer service to-dos, above the orders.
export function HomeNotes({ orders, openOrder, notify, water = false }: { orders: Order[]; openOrder: (id: string) => void; notify: (m: string) => void; water?: boolean }) {
  const [notes, setNotes] = useState<Note[] | null>(null), [adding, setAdding] = useState(false), [editing, setEditing] = useState("");
  useEffect(() => {
    const load = () => fetch("/api/notes", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => Array.isArray(d) && setNotes(d)).catch(() => {});
    load();
    const timer = window.setInterval(load, 60000);
    return () => clearInterval(timer);
  }, []);
  const run = async (p: Promise<Note[]>, done?: string) => {
    try { setNotes(await p); if (done) notify(done); } catch (e) { notify((e as Error).message); throw e; }
  };
  if (!notes) return null;
  return (
    <section className={`home-notes${water ? " on-water" : ""}`} aria-label="Reminders">
      <div className="home-notes-head">
        <h2><StickyNote size={17} /> Reminders {notes.length > 0 && <span>{notes.length}</span>}</h2>
        {!adding && <button className="text-button" onClick={() => setAdding(true)}><Plus size={15} /> Add note</button>}
      </div>
      {adding && <NoteForm onCancel={() => setAdding(false)} onSave={(text, order) => run(send("POST", "/api/notes", { text, order }), "Note added.").then(() => setAdding(false))} />}
      {notes.map((n) => {
        if (editing === n.id) return <NoteForm key={n.id} initial={n} onCancel={() => setEditing("")} onSave={(text, order) => run(send("PATCH", `/api/notes/${n.id}`, { text, order })).then(() => setEditing(""))} />;
        const order = n.order ? orders.find((o) => o.number === n.order) : undefined;
        return (
          <article key={n.id} className="home-note" aria-label={`Note: ${n.text}`}>
            <p>{n.text}</p>
            <div className="home-note-meta">
              {n.order && (order ? <button className="home-note-order" onClick={() => openOrder(order.id)}>{n.order}</button> : <span className="home-note-order">{n.order}</span>)}
              <small>{ago(n.created)}</small>
              <span className="home-note-actions">
                <button className="icon-button" aria-label="Edit note" title="Edit" onClick={() => setEditing(n.id)}><Pencil size={14} /></button>
                <button className="secondary home-note-done" onClick={() => run(send("DELETE", `/api/notes/${n.id}`), "Done. Note cleared.")}><Check size={14} /> Done</button>
              </span>
            </div>
          </article>
        );
      })}
    </section>
  );
}
