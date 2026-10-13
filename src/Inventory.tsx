import { useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";

type Item = { kind: "case" | "faceplate"; id: string; name: string; counts: Record<string, number> };
type Data = { colors: string[]; items: Item[]; updated: number | null };

// Store colorway names to swatch colors (matches the order print dialog).
const SWATCH: Record<string, string> = { red: "#e0201b", green: "#3baa35", blue: "#2f6fd6", black: "#111111", grey: "#8a8a8a", white: "#f2f2f2", orange: "#f07818", purple: "#7e3fb5", pink: "#f06eaa", yellow: "#f5d000", teal: "#0f8c8c" };

async function send(method: string, url: string, body: unknown): Promise<Data> {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || "Couldn't save");
  return d;
}

// One count you type in; saved when you leave the field or press Enter.
function CountCell({ value, label, onSave }: { value: number; label: string; onSave: (n: number) => void }) {
  const [text, setText] = useState(value ? String(value) : "");
  useEffect(() => setText(value ? String(value) : ""), [value]);
  const commit = () => {
    const n = text.trim() === "" ? 0 : Math.round(Number(text));
    if (!Number.isFinite(n) || n < 0) return setText(value ? String(value) : "");
    if (n !== value) onSave(n);
  };
  return (
    <input className="inventory-count" aria-label={label} inputMode="numeric" pattern="[0-9]*" placeholder="0" value={text}
      onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ""))} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setText(value ? String(value) : ""); e.currentTarget.blur(); } }} />
  );
}

// PlayCase > Inventory: finished cases and faceplates on hand, by color.
export function Inventory({ notify }: { notify: (m: string) => void }) {
  const [data, setData] = useState<Data | null>(null), [query, setQuery] = useState(""), [adding, setAdding] = useState(""), [addOpen, setAddOpen] = useState(false), [kind, setKind] = useState<"all" | Item["kind"]>("all");
  useEffect(() => {
    fetch("/api/inventory", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject())).then(setData).catch(() => notify("Couldn't load inventory"));
  }, []);
  if (!data) return <div className="empty"><p>Loading inventory…</p></div>;
  const save = (item: Item, color: string, count: number) => {
    // Show it right away; the server's copy settles it.
    setData({ ...data, items: data.items.map((i) => (i === item ? { ...i, counts: { ...i.counts, [color]: count } } : i)) });
    send("PUT", "/api/inventory", { kind: item.kind, id: item.id, color, count }).then(setData).catch((e) => notify(e.message));
  };
  const addColor = () => {
    if (!adding.trim()) return setAddOpen(false);
    send("POST", "/api/inventory/colors", { color: adding }).then((d) => { setData(d); setAdding(""); setAddOpen(false); }).catch((e) => notify(e.message));
  };
  const shown = data.items.filter((i) => (kind === "all" || i.kind === kind) && i.name.toLowerCase().includes(query.toLowerCase()));
  const total = (i: Item) => Object.values(i.counts).reduce((n, c) => n + c, 0);
  const group = (kind: Item["kind"], label: string) => {
    const rows = shown.filter((i) => i.kind === kind);
    if (!rows.length) return null;
    return (
      <tbody>
        <tr className="inventory-group"><th scope="rowgroup" colSpan={data.colors.length + 2}>{label}</th></tr>
        {rows.map((i) => (
          <tr key={i.id}>
            <th scope="row">{i.name}</th>
            {data.colors.map((c) => <td key={c}><CountCell value={i.counts[c] || 0} label={`${i.name} ${c}`} onSave={(n) => save(i, c, n)} /></td>)}
            <td className="inventory-total">{total(i) || ""}</td>
          </tr>
        ))}
      </tbody>
    );
  };
  return (
    <section className="panel inventory" aria-label="Inventory">
      <div className="inventory-toolbar">
        <div className="segmented inventory-kinds" role="tablist" aria-label="Show">
          {([["all", "All"], ["case", "Cases"], ["faceplate", "Faceplates"]] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? "active" : ""} onClick={() => setKind(k)}>{label}</button>
          ))}
        </div>
        <label className="search-field">
          <Search size={17} />
          <input aria-label="Search inventory" placeholder={kind === "case" ? "Search cases" : kind === "faceplate" ? "Search faceplates" : "Search cases and faceplates"} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {addOpen ? (
          <form className="inventory-add-color" onSubmit={(e) => { e.preventDefault(); addColor(); }}>
            <input autoFocus aria-label="New color" placeholder="Color name" maxLength={30} value={adding} onChange={(e) => setAdding(e.target.value)} onBlur={addColor} />
          </form>
        ) : (
          <button className="secondary" onClick={() => setAddOpen(true)}><Plus size={15} /> Color</button>
        )}
      </div>
      <div className="inventory-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Item</th>
              {data.colors.map((c) => <th key={c} scope="col"><span className="color-dot" style={{ background: SWATCH[c.toLowerCase()] || "#ccc" }} /> {c}</th>)}
              <th scope="col">Total</th>
            </tr>
          </thead>
          {group("case", "Cases")}
          {group("faceplate", "Faceplates")}
        </table>
      </div>
      {!shown.length && <div className="empty"><p>Nothing matches.</p></div>}
      <p className="plate-meta">Counts are entered by hand{data.updated ? ` · last changed ${new Date(data.updated).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` : ""}.</p>
    </section>
  );
}
