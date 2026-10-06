import { Assemblies } from "./Assemblies";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Search, X, Download, Box, LayoutGrid, List } from "lucide-react";

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
  const [view, setView] = useState(() => (localStorage.getItem("spoolside-library-view") === "list" ? "list" : "cards")),
    [designs, setDesigns] = useState<{id:string;name:string;source:string}[]>([]),
    [section, setSectionState] = useState(window.location.pathname === "/library/assemblies" ? "Assemblies" : "Assets"),
    [assets, setAssets] = useState<Asset[] | null>(null),
    [type, setType] = useState<(typeof TYPES)[number]>("All"),
    [status, setStatus] = useState("Active"),
    [search, setSearch] = useState(""),
    [openId, setOpenState] = useState<string | null>(assetFromPath);
  const setSection = (value:string) => {setSectionState(value);const path=value === "Assemblies" ? "/library/assemblies" : "/library";if(window.location.pathname!==path)window.history.pushState(null,"",path);};
  // An open model has its own address: /library/<asset id>.
  const setOpenId = (id: string | null) => {
    const path = id ? `/library/${id}` : "/library";
    if (window.location.pathname !== path) window.history.pushState(null, "", path);
    setOpenState(id);
  };
  useEffect(() => {
    const onPop = () => {setOpenState(assetFromPath());setSectionState(window.location.pathname === "/library/assemblies" ? "Assemblies" : "Assets");};
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const load = () => fetch("/api/assets").then((r) => r.json()).then(setAssets).catch(() => setAssets([]));
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
      {section === "Assemblies" && assets && <Assemblies assets={assets} onOpen={setOpenId} notify={notify}/>}
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
      </div>
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
            <h2>{open.name}</h2>
            <p>{open.type} · Gen {open.generation}{open.fit.phone ? ` · ${open.fit.phone}` : ""}{open.fit.style ? ` · ${open.fit.style}` : ""}{open.fit.size && open.type === "Faceplate" ? ` · ${open.fit.size}` : ""}</p>
            {open.hasStl !== false && <Suspense fallback={<div className="stl-viewer" />}>
              <StlViewer url={`/api/assets/${open.id}/stl`} />
            </Suspense>}
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
