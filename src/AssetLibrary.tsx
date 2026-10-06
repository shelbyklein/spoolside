import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { requestThumbnail } from "./thumbnails";
import { Search, X, Download, Box, LayoutGrid, List } from "lucide-react";

const StlViewer = lazy(() => import("./StlViewer"));

export type Asset = {
  id: string;
  name: string;
  type: "Case" | "Faceplate" | "Part";
  generation: number;
  status: Status;
  note: string;
  fit: { phone: string; style: string; size: string; piece: string };
  source: string;
  dims: number[];
  triangles: number;
  bytes: number;
  updated: string;
  hash: string;
  thumb: boolean;
};
type Status = "Current" | "Needs update" | "Needs check" | "Experimental" | "Retired";
const STATUSES: Status[] = ["Current", "Needs update", "Needs check", "Experimental", "Retired"];
const TYPES = ["All", "Case", "Faceplate", "Part"] as const;
const slug = (s: string) => s.toLowerCase().replace(/\s+/g, "-");

// Groups cases by phone generation and faceplates by style.
const groupOf = (a: Asset) =>
  a.type === "Case"
    ? a.fit.phone.match(/^iPhone (\d+)/)?.[1] ? `iPhone ${a.fit.phone.match(/^iPhone (\d+)/)![1]}` : a.fit.phone.split(" ")[0]
    : a.type === "Faceplate"
      ? a.fit.style
      : "Parts";

const assetFromPath = () => window.location.pathname.match(/^\/library\/([0-9a-f-]{36})$/)?.[1] || null;

export function AssetLibrary({ notify }: { notify: (m: string) => void }) {
  const [view, setView] = useState(() => (localStorage.getItem("spoolside-library-view") === "list" ? "list" : "cards")),
    [assets, setAssets] = useState<Asset[] | null>(null),
    [type, setType] = useState<(typeof TYPES)[number]>("All"),
    [status, setStatus] = useState("Active"),
    [search, setSearch] = useState(""),
    [openId, setOpenState] = useState<string | null>(assetFromPath);
  // An open model has its own address: /library/<asset id>.
  const setOpenId = (id: string | null) => {
    const path = id ? `/library/${id}` : "/library";
    if (window.location.pathname !== path) window.history.pushState(null, "", path);
    setOpenState(id);
  };
  useEffect(() => {
    const onPop = () => setOpenState(assetFromPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const load = () => fetch("/api/assets").then((r) => r.json()).then(setAssets).catch(() => setAssets([]));
  useEffect(() => {
    load();
  }, []);
  const needs = assets?.filter((a) => a.status === "Needs check").length || 0;
  const visible = useMemo(
    () =>
      (assets || []).filter(
        (a) =>
          (type === "All" || a.type === type) &&
          (status === "All" || (status === "Active" ? a.status !== "Retired" : a.status === status)) &&
          `${a.name} ${a.note} ${a.fit.phone} ${a.fit.style}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [assets, type, status, search],
  );
  const groups = useMemo(() => {
    const map = new Map<string, Asset[]>();
    for (const a of visible) map.set(`${a.type}|${groupOf(a)}`, [...(map.get(`${a.type}|${groupOf(a)}`) || []), a]);
    return [...map];
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
      {groups.map(([key, list]) => (
        <div className="asset-group" key={key}>
          <h3>{key.split("|")[1]}</h3>
          {view === "cards" ? (
            <div className="asset-cards">
              {list.map((a) => (
                <AssetCard key={a.id} asset={a} onOpen={() => setOpenId(a.id)} onThumb={() => setAssets((all) => all?.map((x) => (x.id === a.id ? { ...x, thumb: true } : x)) || null)} />
              ))}
            </div>
          ) : (
          <ul>
            {list.map((a) => (
              <li key={a.id}>
                <button className="asset-row" onClick={() => setOpenId(a.id)}>
                  <span className="asset-name">
                    <strong>{a.name}</strong>
                    <small>{[a.fit.size && a.type === "Faceplate" ? a.fit.size : "", a.dims.join(" × ") + " mm", a.note].filter(Boolean).join(" · ")}</small>
                  </span>
                  <span className={`asset-status ${slug(a.status)}`}>{a.status}</span>
                </button>
              </li>
            ))}
          </ul>
          )}
        </div>
      ))}
      {open && (
        <div className="detail-overlay" onClick={() => setOpenId(null)}>
          <section role="dialog" aria-modal="true" aria-label={open.name} className="detail-panel asset-detail" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && setOpenId(null)}>
            <button autoFocus className="close icon-button" aria-label="Close" onClick={() => setOpenId(null)}><X /></button>
            <h2>{open.name}</h2>
            <p>{open.type} · Gen {open.generation}{open.fit.phone ? ` · ${open.fit.phone}` : ""}{open.fit.style ? ` · ${open.fit.style}` : ""}{open.fit.size && open.type === "Faceplate" ? ` · ${open.fit.size}` : ""}</p>
            <Suspense fallback={<div className="stl-viewer" />}>
              <StlViewer url={`/api/assets/${open.id}/stl`} />
            </Suspense>
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
              <div><dt>Size</dt><dd>{open.dims.join(" × ")} mm</dd></div>
              <div><dt>Triangles</dt><dd>{open.triangles.toLocaleString()}</dd></div>
              <div><dt>Source</dt><dd>{open.source || "Uploaded"}</dd></div>
              <div><dt>Updated</dt><dd>{new Date(open.updated).toLocaleDateString()}</dd></div>
            </dl>
            <a className="secondary download-stl" href={`/api/assets/${open.id}/stl`} download={`${open.name}.stl`}><Download size={16} /> Download STL</a>
          </section>
        </div>
      )}
    </section>
  );
}

// Card with a cached model preview; renders one on first sight if missing.
function AssetCard({ asset, onOpen, onThumb }: { asset: Asset; onOpen: () => void; onThumb: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (asset.thumb || failed || !ref.current) return;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      requestThumbnail(asset.id).then((ok) => (ok ? onThumb() : setFailed(true)));
    }, { rootMargin: "200px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [asset.thumb, failed]);
  return (
    <button ref={ref} className="asset-card" onClick={onOpen}>
      <span className="asset-card-image">
        {asset.thumb ? <img src={`/api/assets/${asset.id}/thumb?h=${asset.hash.slice(0, 12)}`} alt="" loading="lazy" /> : <Box size={28} aria-hidden="true" />}
        <span className={`asset-status ${slug(asset.status)}`}>{asset.status}</span>
      </span>
      <span className="asset-card-body">
        <strong>{asset.name}</strong>
        <small>{[asset.fit.size && asset.type === "Faceplate" ? asset.fit.size : "", asset.dims.join(" × ") + " mm"].filter(Boolean).join(" · ")}</small>
      </span>
    </button>
  );
}
