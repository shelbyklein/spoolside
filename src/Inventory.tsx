import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, Plus, Search } from "lucide-react";
import { useSort, byName } from "./sort";

type Item = { kind: "case" | "faceplate"; id: string; name: string; counts: Record<string, number>; hidden?: boolean };
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
  const [data, setData] = useState<Data | null>(null), [query, setQuery] = useState(""), [adding, setAdding] = useState(""), [addOpen, setAddOpen] = useState(false), [kind, setKind] = useState<"all" | Item["kind"]>("all"), [showHidden, setShowHidden] = useState(false);
  const total = (i: Item) => Object.values(i.counts).reduce((n, c) => n + c, 0);
  const sorting = useSort<Item>("inventory", "inventory", [
    { id: "name", label: "Name (A–Z)", compare: (a, b) => byName(a.name, b.name) },
    { id: "name-desc", label: "Name (Z–A)", compare: (a, b) => byName(b.name, a.name) },
    { id: "most", label: "Most on hand", compare: (a, b) => total(b) - total(a) || byName(a.name, b.name) },
    { id: "fewest", label: "Fewest on hand", compare: (a, b) => total(a) - total(b) || byName(a.name, b.name) },
  ]);
  const [loads, setLoads] = useState(0);
  useEffect(() => {
    fetch("/api/inventory", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => { setData(d); setLoads((n) => n + 1); }).catch(() => notify("Couldn't load inventory"));
  }, []);
  // Rows keep their place while counts are typed in; they re-sort when the sort changes or the page loads.
  const order = useMemo(() => sorting.sort(data?.items || []).map((i) => `${i.kind}|${i.id}`), [sorting.id, loads, data?.items.length]);
  if (!data) return <div className="empty"><p>Loading inventory…</p></div>;
  const save = (item: Item, color: string, count: number) => {
    // Show it right away; the server's copy settles it.
    setData({ ...data, items: data.items.map((i) => (i === item ? { ...i, counts: { ...i.counts, [color]: count } } : i)) });
    send("PUT", "/api/inventory", { kind: item.kind, id: item.id, color, count }).then(setData).catch((e) => notify(e.message));
  };
  // Items not sold right now are hidden; their counts are kept.
  const hide = (item: Item, hidden: boolean) => {
    setData({ ...data, items: data.items.map((i) => (i === item ? { ...i, hidden } : i)) });
    send("PUT", "/api/inventory/hidden", { kind: item.kind, id: item.id, hidden }).then(setData).catch((e) => notify(e.message));
  };
  const hiddenCount = data.items.filter((i) => i.hidden && (kind === "all" || i.kind === kind)).length;
  const addColor = () => {
    if (!adding.trim()) return setAddOpen(false);
    send("POST", "/api/inventory/colors", { color: adding }).then((d) => { setData(d); setAdding(""); setAddOpen(false); }).catch((e) => notify(e.message));
  };
  const place = (i: Item) => order.indexOf(`${i.kind}|${i.id}`);
  const shown = data.items.filter((i) => (kind === "all" || i.kind === kind) && (showHidden || !i.hidden) && i.name.toLowerCase().includes(query.toLowerCase())).sort((a, b) => place(a) - place(b));
  const group = (kind: Item["kind"], label: string) => {
    const rows = shown.filter((i) => i.kind === kind);
    if (!rows.length) return null;
    return (
      <tbody>
        <tr className="inventory-group"><th scope="rowgroup" colSpan={data.colors.length + 2}>{label}</th></tr>
        {rows.map((i) => (
          <tr key={i.id} className={i.hidden ? "inventory-hidden" : undefined}>
            <th scope="row">{i.name}{i.hidden && <small> · not sold</small>}</th>
            {data.colors.map((c) => <td key={c}><CountCell value={i.counts[c] || 0} label={`${i.name} ${c}`} onSave={(n) => save(i, c, n)} /></td>)}
            <td className="inventory-hide">
              <button className="icon-button" aria-label={i.hidden ? `Show ${i.name}` : `Hide ${i.name}`} title={i.hidden ? "Selling again: show it" : "Not selling this: hide it"} onClick={() => hide(i, !i.hidden)}>
                {i.hidden ? <Eye size={15} /> : <EyeOff size={15} />}
              </button>
            </td>
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
        {sorting.menu}
        {(hiddenCount > 0 || showHidden) && <button className="text-button inventory-show-hidden" aria-pressed={showHidden} onClick={() => setShowHidden(!showHidden)}>{showHidden ? "Hide not sold" : `Show hidden (${hiddenCount})`}</button>}
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
              <th scope="col" aria-label="Hide" />
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
