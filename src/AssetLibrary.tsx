import { Assemblies } from "./Assemblies";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Search, X, Download, Box, LayoutGrid, List, Upload, Trash2, Palette, Plus } from "lucide-react";

const StlViewer = lazy(() => import("./StlViewer"));

export type Asset = {
  id: string;
  name: string;
  type: "Case" | "Faceplate" | "Sleeve" | "Part" | "Phone Base";
  generation: number;
  status: Status;
  note: string;
  fit: { phone: string; style: string; size: string; piece: string };
  source: string;
  dims: number[];
  triangles: number;
  bytes: number;
  updated: string;
  designFile?: {id:string;name:string;source:string}|null;
  category?: string;
  categoryColor?: string;
  complete?: boolean;
  hasStl?: boolean;
};
type Status = "Current" | "Needs update" | "Needs check" | "Experimental" | "Retired";
const STATUSES: Status[] = ["Current", "Needs update", "Needs check", "Experimental", "Retired"];
const TYPES = ["All", "Case", "Faceplate", "Sleeve", "Part", "Phone Base"] as const;
const slug = (s: string) => s.toLowerCase().replace(/\s+/g, "-");

// Groups cases by phone generation and faceplates by style.
const groupOf = (a: Asset) =>
  a.type === "Case"
    ? a.fit.phone.match(/^iPhone (\d+)/)?.[1] ? `iPhone ${a.fit.phone.match(/^iPhone (\d+)/)![1]}` : a.fit.phone.split(" ")[0]
    : (a.type === "Faceplate" || a.type === "Sleeve")
      ? a.fit.style + (a.type === "Sleeve" ? " sleeves" : "")
      : a.type === "Phone Base" ? "Phone Bases" : "Parts";

const assetFromPath = () => window.location.pathname.match(/^\/library\/([0-9a-f-]{36})$/)?.[1] || null;

export function AssetLibrary({ notify }: { notify: (m: string) => void }) {
  const assemblyReturnPath=useRef(window.location.pathname);
  const [view, setView] = useState(() => (localStorage.getItem("spoolside-library-view") === "list" ? "list" : "cards")),
    [designs, setDesigns] = useState<{id:string;name:string;source:string}[]>([]),
    [section, setSectionState] = useState(window.location.pathname.startsWith("/library/assemblies") ? "Assemblies" : "Assets"),
    [assets, setAssets] = useState<Asset[] | null>(null),
    [type, setType] = useState<(typeof TYPES)[number]>("All"),
    [status, setStatus] = useState("Active"),
    [search, setSearch] = useState(""),
    [uploading, setUploading] = useState(false),
    [openId, setOpenState] = useState<string | null>(assetFromPath);
  const setSection = (value:string) => {setSectionState(value);const path=value === "Assemblies" ? "/library/assemblies" : "/library";if(window.location.pathname!==path)window.history.pushState(null,"",path);};
  // An open model has its own address: /library/<asset id>.
  const setOpenId = (id: string | null) => {
    const path = id ? `/library/${id}` : (section === "Assemblies" ? assemblyReturnPath.current : "/library");
    if(id && section === "Assemblies")assemblyReturnPath.current=window.location.pathname;
    if (window.location.pathname !== path) window.history.pushState(null, "", path);
    setOpenState(id);
  };
  useEffect(() => {
    const onPop = () => {setOpenState(assetFromPath());setSectionState(window.location.pathname.startsWith("/library/assemblies") ? "Assemblies" : "Assets");};
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const load = () => fetch("/api/assets").then((r) => r.json()).then(setAssets).catch(() => setAssets([]));
  const [categories, setCategories] = useState<Category[]>([]),
    [managing, setManaging] = useState(false);
  const loadCategories = () => fetch("/api/categories").then((r) => r.json()).then((c) => setCategories(Array.isArray(c) ? c : [])).catch(() => setCategories([]));
  useEffect(() => { loadCategories(); }, []);
  // Each item carries its category's color so previews can use it as the default.
  const colored = useMemo(() => assets?.map((a) => ({ ...a, categoryColor: categories.find((c) => c.id === a.category)?.color })) || null, [assets, categories]);
  useEffect(() => {
    load();
    fetch("/api/designfiles").then(r=>{if(!r.ok)throw Error();return r.json();}).then(setDesigns).catch(()=>notify("Could not load design files"));
  }, []);
  const needs = assets?.filter((a) => a.status === "Needs check").length || 0;
  const visible = useMemo(
    () =>
      (assets || []).filter(
        (a) =>
          (type === "All" || a.type === type) &&
          (status === "All" || (status === "Missing design" ? !a.designFile && a.status !== "Retired" : status === "Active" ? a.status !== "Retired" : a.status === status)) &&
          `${a.name} ${a.note} ${a.fit.phone} ${a.fit.style}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [assets, type, status, search],
  );
  const groups = useMemo(() => {
    const map = new Map<string, Asset[]>();
    for (const a of visible) map.set(`${a.type}|${groupOf(a)}`, [...(map.get(`${a.type}|${groupOf(a)}`) || []), a]);
    return [...map]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([key, list]): [string, Asset[]] => [key, list.sort((a, b) => Number(b.status === "Current") - Number(a.status === "Current"))]);
  }, [visible]);
  const open = assets?.find((a) => a.id === openId) || null;
  const save = async (a: Asset, patch: Partial<Asset>) => {
    const r = await fetch(`/api/assets/${a.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    const body = await r.json();
    if (!r.ok) return notify(body.error || "Couldn't save");
    setAssets((list) => list?.map((x) => (x.id === a.id ? body : x)) || null);
  };
  return (
    <section className="asset-library">
      <div className="segmented library-sections" role="tablist" aria-label="Library section">
        {["Assets","Assemblies"].map(s=><button key={s} role="tab" aria-selected={section===s} className={section===s?"selected":""} onClick={()=>setSection(s)}>{s}</button>)}
      </div>
      {section === "Assemblies" && colored && <Assemblies assets={colored} onOpen={setOpenId} notify={notify}/>}
      {section === "Assets" && <>
      <div className="asset-toolbar">
        <div className="segmented" role="tablist" aria-label="Asset type">
          {TYPES.map((t) => (
            <button key={t} role="tab" aria-selected={type === t} className={type === t ? "selected" : ""} onClick={() => setType(t)}>
              {t === "All" ? "All" : t === "Case" ? "Cases" : t + "s"}
            </button>
          ))}
        </div>
        <label className="search-field">
          <Search size={17} />
          <input aria-label="Search assets" placeholder="Search phone, style or part" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <select aria-label="Filter status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="Active">Not retired</option>
          <option>Missing design</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
          <option value="All">All statuses</option>
        </select>
        <div className="segmented view-toggle" role="radiogroup" aria-label="View">
          {(["cards", "list"] as const).map((v) => (
            <button key={v} role="radio" aria-checked={view === v} aria-label={v === "cards" ? "Card view" : "List view"} className={view === v ? "selected" : ""} onClick={() => { setView(v); localStorage.setItem("spoolside-library-view", v); }}>
              {v === "cards" ? <LayoutGrid size={16} /> : <List size={16} />}
            </button>
          ))}
        </div>
        <button className="secondary categories-button" onClick={() => setManaging(true)}><Palette size={16} /> Categories</button>
        <button className="primary upload-asset" onClick={() => setUploading(true)}><Upload size={16} /> Upload</button>
      </div>
      {managing && <CategoryManager categories={categories} assets={assets || []} onChange={() => { loadCategories(); load(); }} onClose={() => setManaging(false)} notify={notify} />}
      {uploading && <UploadDialog categories={categories} onClose={() => setUploading(false)} notify={notify} onAdded={(a) => { setAssets((all) => [...(all || []), a]); setUploading(false); setOpenId(a.id); }} />}
      {needs > 0 && status !== "Needs check" && (
        <button className="needs-check-banner" onClick={() => { setStatus("Needs check"); setType("All"); }}>
          {needs} {needs === 1 ? "asset needs" : "assets need"} a check
        </button>
      )}
      {assets && assets.length === 0 && <div className="empty"><Box /><p>No assets yet.</p></div>}
      {view === "cards" ? (
        <div className="group-cards">
          {groups.map(([key, list]) => (
            <GroupCard key={key} title={key.split("|")[1]} assets={list} onOpen={setOpenId} />
          ))}
        </div>
      ) : (
        groups.map(([key, list]) => (
          <div className="asset-group" key={key}>
            <h3>{key.split("|")[1]}</h3>
            <ul>
              {list.map((a) => (
                <li key={a.id}>
                  <button className="asset-row" onClick={() => setOpenId(a.id)}>
                    <span className="asset-name">
                      <strong>{a.name}</strong>
                      <small>{[a.fit.size && a.type === "Faceplate" ? a.fit.size : "", a.hasStl !== false ? a.dims.join(" × ") + " mm" : "Design only", a.note].filter(Boolean).join(" · ")}</small>
                    </span>
                    <span className={`asset-status ${slug(a.status)}`}>{a.status}{!a.designFile ? " · Missing design" : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
      </>}
      {open && (
        <div className="detail-overlay" onClick={() => setOpenId(null)}>
          <section role="dialog" aria-modal="true" aria-label={open.name} className="detail-panel asset-detail" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && setOpenId(null)}>
            <button autoFocus className="close icon-button" aria-label="Close" onClick={() => setOpenId(null)}><X /></button>
            <h2 className="asset-title">
              <input key={open.id} aria-label="Name" defaultValue={open.name} maxLength={100}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { e.currentTarget.value = open.name; e.currentTarget.blur(); e.stopPropagation(); } }}
                onBlur={(e) => { const v = e.target.value.trim(); if (!v) e.target.value = open.name; else if (v !== open.name) save(open, { name: v }); }} />
            </h2>
            <p>{open.type} · Gen {open.generation}{open.fit.phone ? ` · ${open.fit.phone}` : ""}{open.fit.style ? ` · ${open.fit.style}` : ""}{open.fit.size && open.type === "Faceplate" ? ` · ${open.fit.size}` : ""}</p>
            {open.hasStl !== false && <Suspense fallback={<div className="stl-viewer" />}>
              <StlViewer url={`/api/assets/${open.id}/stl`} colors={[categories.find((c) => c.id === open.category)?.color || ""]} />
            </Suspense>}
            <label className="design-picker">Category
              <select aria-label="Category" value={open.category || ""} onChange={(e) => save(open, { category: e.target.value })}>
                <option value="">No category</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="design-picker">Design file
              <select aria-label="Design file" value={open.designFile?.id || ""} onChange={async e=>{
                const r=await fetch(`/api/assets/${open.id}/design`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({designId:e.target.value || null})});
                if(!r.ok){notify("Could not save design link");return;}const updated=await r.json();setAssets(list=>list?.map(a=>a.id===updated.id?updated:a)||null);
              }}><option value="">Missing design</option>{designs.map(d=><option key={d.id} value={d.id}>{d.source}</option>)}</select>
            </label>
            {open.designFile && <a className="secondary download-stl" href={`/api/designfiles/${open.designFile.id}/download`}>Download design</a>}
            <div className="status-picker" role="radiogroup" aria-label="Status">
              {STATUSES.map((s) => (
                <button key={s} role="radio" aria-checked={open.status === s} className={`asset-status ${slug(s)}${open.status === s ? " selected" : ""}`} onClick={() => save(open, { status: s })}>{s}</button>
              ))}
            </div>
            <label className="asset-note">
              Note
              <textarea key={open.id} defaultValue={open.note} maxLength={500} onBlur={(e) => e.target.value !== open.note && save(open, { note: e.target.value })} />
            </label>
            <dl>
              {open.hasStl !== false && <><div><dt>Size</dt><dd>{open.dims.join(" × ")} mm</dd></div>
              <div><dt>Triangles</dt><dd>{open.triangles.toLocaleString()}</dd></div>
              </>}<div><dt>Source</dt><dd>{open.source || "Uploaded"}</dd></div>
              <div><dt>Updated</dt><dd>{new Date(open.updated).toLocaleDateString()}</dd></div>
            </dl>
            {open.hasStl !== false && <a className="secondary download-stl" href={`/api/assets/${open.id}/stl`} download={`${open.name}.stl`}><Download size={16} /> Download STL</a>}
            <button className="secondary danger delete-asset" onClick={async () => {
              if (!window.confirm(`Delete ${open.name} from the library? The original file in Dropbox is not touched, and the folder import won't bring it back.`)) return;
              const r = await fetch(`/api/assets/${open.id}`, { method: "DELETE" });
              const body = await r.json().catch(() => ({}));
              if (!r.ok) return notify(body.error || "Couldn't delete");
              setAssets((all) => all?.filter((x) => x.id !== open.id) || null);
              setOpenId(null);
              notify(`Deleted ${open.name}.`);
            }}><Trash2 size={16} /> Delete</button>
          </section>
        </div>
      )}
    </section>
  );
}

// Short label within its group: "12 Pro Max" under iPhone 12, "Plus Top" under DS.
function cardLabel(a: Asset) {
  if (a.type === "Case") return (a.fit.phone.replace(/^iPhone /, "").replace(/^Samsung /, "") || a.name) + (/\(Rounded\)/.test(a.name) ? " Rounded" : "") + (/\(older\)/.test(a.name) ? " (older)" : "");
  if (a.type === "Faceplate" && ["Top", "Bottom"].includes(a.fit.piece))
    return `${a.fit.size === "Plus" ? "Plus " : ""}${a.fit.piece}${/Ridges/.test(a.name) ? " (Ridges)" : ""}`;
  if (a.type === "Faceplate") return a.name.replace(new RegExp(`^${a.fit.style}( Plus)? – `), "");
  return a.name;
}

// One card per phone generation / faceplate style, with a full-width pill per STL.
function GroupCard({ title, assets, onOpen }: { title: string; assets: Asset[]; onOpen: (id: string) => void }) {
  return (
    <section className="group-card" aria-label={title}>
      <h3>{title}</h3>
      <div className="asset-pills">
        {assets.map((a) => (
          <button key={a.id} className={`asset-pill ${slug(a.status)}`} aria-label={`${a.name}, ${a.status}`} onClick={() => onOpen(a.id)}>
            <span>{cardLabel(a)}</span>
            <small>{a.status}{!a.designFile ? " · Missing design" : ""}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

const STYLES = ["Handheld", "DS", "Classic", "3DS", "N64", "MAME", "Keyboard"];
// Adds a new library item from an STL, with an optional matching design file.
function UploadDialog({ categories, onClose, onAdded, notify }: { categories: Category[]; onClose: () => void; onAdded: (a: Asset) => void; notify: (m: string) => void }) {
  const [stl, setStl] = useState<File | null>(null),
    [design, setDesign] = useState<File | null>(null),
    [name, setName] = useState(""),
    [type, setType] = useState("Part"),
    [phone, setPhone] = useState(""),
    [style, setStyle] = useState("Handheld"),
    [size, setSize] = useState("Standard"),
    [piece, setPiece] = useState("Top"),
    [status, setStatus] = useState<Status>("Current"),
    [category, setCategory] = useState(""),
    [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stl) return;
    setBusy(true);
    try {
      const key = crypto.randomUUID();
      const fit = type === "Case" ? { phone } : type === "Faceplate" ? { style, size, piece } : type === "Sleeve" ? { style, size } : { piece: name };
      const r = await fetch("/api/assets", { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Asset": encodeURIComponent(JSON.stringify({ name, type, status, category, generation: 3, fit, source: `upload/${key}/${stl.name}` })) }, body: stl });
      let asset = await r.json();
      if (!r.ok) throw Error(asset.error || "Upload failed");
      if (design) {
        const d = await fetch("/api/designfiles", { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Design": encodeURIComponent(JSON.stringify({ source: `upload/${key}/${design.name}`, name: design.name })) }, body: design });
        const df = await d.json();
        if (!d.ok) throw Error(`STL added, but the design file failed: ${df.error || "upload error"}`);
        const l = await fetch(`/api/assets/${asset.id}/design`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ designId: df.id }) });
        if (l.ok) asset = await l.json();
      }
      notify(`Added ${asset.name}.`);
      onAdded(asset);
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="detail-overlay" onClick={onClose}>
      <form role="dialog" aria-modal="true" aria-label="Upload library item" className="detail-panel upload-dialog" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()} onSubmit={submit}>
        <button type="button" autoFocus className="close icon-button" aria-label="Close" onClick={onClose}><X /></button>
        <h2>Upload</h2>
        <label>STL file<input type="file" accept=".stl" required onChange={(e) => { const f = e.target.files?.[0] || null; setStl(f); if (f && !name) setName(f.name.replace(/\.stl$/i, "")); }} /></label>
        <label>Design file (optional)<input type="file" accept=".c4d,.blend,.f3d,.step,.stp,.ai" onChange={(e) => setDesign(e.target.files?.[0] || null)} /></label>
        <label>Name<input value={name} required maxLength={100} onChange={(e) => setName(e.target.value)} /></label>
        <label>Type<select value={type} onChange={(e) => setType(e.target.value)}>{["Case", "Faceplate", "Sleeve", "Part"].map((t) => <option key={t}>{t}</option>)}</select></label>
        {type === "Case" && <label>Phone model<input value={phone} required placeholder="iPhone 17 Air" onChange={(e) => setPhone(e.target.value)} /></label>}
        {(type === "Faceplate" || type === "Sleeve") && <>
          <label>Style<select value={style} onChange={(e) => setStyle(e.target.value)}>{STYLES.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label>Size<select value={size} onChange={(e) => setSize(e.target.value)}><option>Standard</option><option>Plus</option></select></label>
        </>}
        {type === "Faceplate" && <label>Piece<select value={piece} onChange={(e) => setPiece(e.target.value)}><option>Top</option><option>Bottom</option></select></label>}
        <label>Status<select value={status} onChange={(e) => setStatus(e.target.value as Status)}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label>Category<select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">No category</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <button className="primary" type="submit" disabled={busy || !stl}>{busy ? "Uploading…" : "Add to library"}</button>
      </form>
    </div>
  );
}

export type Category = { id: string; name: string; color: string };
// Name and color each category; the color is the default for its items in 3D previews.
function CategoryManager({ categories, assets, onChange, onClose, notify }: { categories: Category[]; assets: Asset[]; onChange: () => void; onClose: () => void; notify: (m: string) => void }) {
  const send = async (url: string, method: string, body?: object) => {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) notify(out.error || "Couldn't save category");
    onChange();
  };
  const [name, setName] = useState(""), [color, setColor] = useState("#5aa9a3");
  return (
    <div className="detail-overlay" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-label="Categories" className="detail-panel category-manager" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <button autoFocus className="close icon-button" aria-label="Close" onClick={onClose}><X /></button>
        <h2>Categories</h2>
        <p className="plate-meta">Each item's category sets its color in 3D previews. A color picked on an assembly part still wins.</p>
        <ul>
          {categories.map((c) => {
            const count = assets.filter((a) => a.category === c.id).length;
            return (
              <li key={c.id}>
                <input type="color" aria-label={`${c.name} color`} defaultValue={c.color} onBlur={(e) => e.target.value !== c.color && send(`/api/categories/${c.id}`, "PUT", { name: c.name, color: e.target.value })} />
                <input aria-label="Category name" defaultValue={c.name} maxLength={40} onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && send(`/api/categories/${c.id}`, "PUT", { name: e.target.value.trim(), color: c.color })} />
                <small>{count} {count === 1 ? "item" : "items"}</small>
                <button className="icon-button" aria-label={`Delete ${c.name}`} onClick={() => window.confirm(`Delete ${c.name}? Its ${count} items become uncategorized.`) && send(`/api/categories/${c.id}`, "DELETE")}><Trash2 size={16} /></button>
              </li>
            );
          })}
        </ul>
        <form className="category-add" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; send("/api/categories", "POST", { name: name.trim(), color }); setName(""); }}>
          <input type="color" aria-label="New category color" value={color} onChange={(e) => setColor(e.target.value)} />
          <input aria-label="New category name" placeholder="New category" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          <button className="secondary" type="submit"><Plus size={16} /> Add</button>
        </form>
      </section>
    </div>
  );
}
