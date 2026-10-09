import { useEffect, useState, useRef } from "react";
import { Pause, Play, Square, Upload, Trash2, FileBox, RefreshCw, Pencil, Plus, Info } from "lucide-react";
import type { Asset, Category } from "./AssetLibrary";
import type { Machine } from "./live-workspace";

export type Plate = { quantity?: number | null; coverage?: {assetId: string; hash: string}[]; index: number; minutes: number; grams: number; filaments: { id: number; type: string; color: string }[] };
export type LibraryFile = { scope?: "playcase" | "personal"; printer?: string | null; preferredPrinter?: string | null; printerSource?: string | null; preferredPrinterName?: string | null; id: string; name: string; size: number; plates: Plate[]; created: string; updated?: string | null; replaced?: boolean };

const duration = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`);
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0);
const distance = (a: string, b: string) => rgb(a).reduce((sum, v, i) => sum + (v - rgb(b)[i]) ** 2, 0);
const family = (t: string) => t.replace(/-AMS$/i, "").split(/[\s-]/)[0].toUpperCase();

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(body.error || "Request failed");
  return body as T;
}

export function useLibrary(scope?: "playcase" | "personal") {
  const [files, setFiles] = useState<LibraryFile[] | null>(null);
  const refresh = () => api<LibraryFile[]>(scope ? `/api/library?scope=${scope}` : "/api/library").then(value => setFiles(Array.isArray(value) ? value : [])).catch(() => setFiles([]));
  useEffect(() => {
    refresh();
  }, [scope]);
  return { files, refresh };
}

// Picks the loaded AMS slot closest in color, preferring the same material.
export function defaultMapping(plate: Plate, trays: Machine["trays"] = []) {
  const loaded = trays.filter((t) => t.type);
  const slots = Math.max(0, ...plate.filaments.map((f) => f.id));
  const mapping = Array<number>(slots).fill(-1);
  for (const f of plate.filaments) {
    const pool = loaded.filter((t) => family(t.type) === family(f.type));
    const best = (pool.length ? pool : loaded).sort((a, b) => distance(a.color, f.color) - distance(b.color, f.color))[0];
    mapping[f.id - 1] = best ? best.slot : -1;
  }
  return mapping;
}

export function PrintControls({ machine, notify }: { machine: Machine; notify: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const act = async (action: "pause" | "resume" | "stop") => {
    if (action === "stop" && !window.confirm(`Stop the print on ${machine.name}? This can't be undone.`)) return;
    setBusy(true);
    try {
      await api(`/api/printers/${machine.id}/${action}`, { method: "POST" });
      notify(`${machine.name}: ${action === "stop" ? "print stopped" : action === "pause" ? "paused" : "resumed"}.`);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!machine.connected || machine.stale) return null;
  if (["RUNNING", "PREPARE", "PAUSE"].includes(machine.rawState || ""))
    return (
      <div className="print-controls">
        {machine.rawState === "PAUSE" ? (
          <button className="primary" disabled={busy} onClick={() => act("resume")}><Play size={16} /> Resume</button>
        ) : (
          <button className="secondary" disabled={busy} onClick={() => act("pause")}><Pause size={16} /> Pause</button>
        )}
        <button className="secondary danger" disabled={busy} onClick={() => act("stop")}><Square size={15} /> Stop</button>
      </div>
    );
  if (["IDLE", "FINISH", "FAILED"].includes(machine.rawState || "")) return <StartPrint machine={machine} notify={notify} />;
  return null;
}

type LastPrint = { name: string; plates: Plate[] };
const LAST = "last";
function StartPrint({ machine, notify, initialFile = "", onSent }: { machine: Machine; notify: (m: string) => void; initialFile?: string; onSent?: () => void }) {
  const { files } = useLibrary();
  // The job the printer just ran, if its file is still on the SD card: it can start again with no upload.
  const [last, setLast] = useState<LastPrint | null | undefined>(undefined);
  const justPrinted = ["FINISH", "FAILED"].includes(machine.rawState || "");
  useEffect(() => {
    let live = true;
    api<LastPrint | null>(`/api/printers/${machine.id}/last-print`).then((v) => live && setLast(v?.plates?.length ? v : null)).catch(() => live && setLast(null));
    return () => { live = false; };
  }, [machine.id, machine.rawState]);
  const [fileId, setFileId] = useState(initialFile),
    [plateIndex, setPlateIndex] = useState(1),
    [mapping, setMapping] = useState<number[]>([]),
    // Printers with no AMS loaded print from the external spool.
    [useAms, setUseAms] = useState(() => (machine.trays || []).some((t) => t.type)),
    [level, setLevel] = useState(true),
    [clear, setClear] = useState(false),
    [sending, setSending] = useState(false);
  useEffect(() => {
    if (last && justPrinted && !fileId) setFileId(LAST);
  }, [last]);
  const file = fileId === LAST ? last || undefined : files?.find((f) => f.id === fileId);
  const plate = file?.plates.find((p) => p.index === plateIndex) || file?.plates[0];
  const trays = (machine.trays || []).filter((t) => t.type);
  useEffect(() => {
    if (plate) setMapping(defaultMapping(plate, machine.trays));
  }, [fileId, plateIndex, plate]);
  if (!files) return null;
  if (!files.length && !last) return <><BedCheck machine={machine} /><p className="detail-note">Upload sliced files in Printers → Print library to start prints here.</p></>;
  const start = async () => {
    if (!file || !plate) return;
    setSending(true);
    try {
      const again = fileId === LAST;
      await api(`/api/printers/${machine.id}/${again ? "reprint" : "print"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(again ? {} : { fileId }), plate: plate.index, amsMapping: mapping, useAms, bedLevelling: level, bedClear: clear }),
      });
      notify(`Started ${file.name}${again ? " again" : ""} on ${machine.name}.`);
      setClear(false);
      onSent?.();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="start-print">
      {!initialFile && <h3>{fileId === LAST ? "Print again" : "Start a print"}</h3>}
      <label>
        File
        <select value={fileId} onChange={(e) => { setFileId(e.target.value); setPlateIndex(1); }}>
          <option value="">Choose a file…</option>
          {last && (
            <optgroup label="On the printer">
              <option value={LAST}>{last.name} (last print)</option>
            </optgroup>
          )}
          {files.length > 0 && (
            <optgroup label="Print library">
              {files.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </optgroup>
          )}
        </select>
      </label>
      {file && file.plates.length > 1 && (
        <label>
          Plate
          <select value={plate?.index} onChange={(e) => setPlateIndex(Number(e.target.value))}>
            {file.plates.map((p) => <option key={p.index} value={p.index}>Plate {p.index} · {duration(p.minutes)}</option>)}
          </select>
        </label>
      )}
      {plate && (
        <>
          <p className="plate-meta">{duration(plate.minutes)} · {plate.grams} g{plate.quantity ? ` · ${plate.quantity} pieces` : ""}</p>
          {trays.length > 0 && <label className="check-row"><input type="checkbox" checked={useAms} onChange={(e) => setUseAms(e.target.checked)} /> Use AMS</label>}
          {useAms && plate.filaments.map((f) => (
            <label key={f.id} className="slot-row">
              <span><span className="color-dot" style={{ background: f.color }} /> {f.type} <span aria-hidden="true">→</span> <span className="color-dot" style={{ background: trays.find((t) => t.slot === mapping[f.id - 1])?.color || "transparent" }} /></span>
              <select aria-label={`AMS slot for filament ${f.id}`} value={mapping[f.id - 1] ?? -1} onChange={(e) => setMapping(previous => { const next = Array.from({length: Math.max(previous.length, f.id)}, (_, i) => previous[i] ?? -1); next[f.id - 1] = Number(e.target.value); return next; })}>
                <option value={-1} disabled>Choose slot</option>
                {trays.map((t) => <option key={t.slot} value={t.slot}>Slot {t.slot + 1} · {t.type}</option>)}
              </select>
            </label>
          ))}
          {!useAms && <p className="plate-meta">Prints from the external spool{machine.external ? ` (${machine.external.type})` : ""}.</p>}
          <label className="check-row"><input type="checkbox" checked={level} onChange={(e) => setLevel(e.target.checked)} /> Bed leveling</label>
          <BedCheck machine={machine} />
          <label className="check-row"><input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} /> Build plate is clear</label>
          <button className="primary" disabled={!clear || sending || (useAms && plate.filaments.some((f) => (mapping[f.id - 1] ?? -1) < 0))} onClick={start}>
            <Play size={16} /> {sending ? "Sending to printer…" : "Start print"}
          </button>
        </>
      )}
    </div>
  );
}

export function PrintUploadButton({ notify, onUploaded, label = "Upload .3mf", scope = "playcase" }: { notify: (m: string) => void; onUploaded?: () => void; label?: string; scope?: "playcase" | "personal" }) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const upload = async (list: FileList | null) => {
    const picked = Array.from(list || []);
    if (!picked.length) return;
    setUploading(true);
    try {
      // A file with several sliced plates comes back as one entry per plate.
      // Entries with a name already in the library replace it, keeping their linked assets.
      let added = 0, replaced = 0;
      for (const f of picked) {
        const entries = await api<LibraryFile[]>("/api/library", { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(f.name), "X-Library-Scope": scope }, body: f });
        for (const e of Array.isArray(entries) ? entries : []) e.replaced ? replaced++ : added++;
      }
      const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
      notify([replaced && `Updated ${count(replaced, "print", "prints")} (linked assets kept)`, added && `added ${count(added, "new print", "new prints")}`].filter(Boolean).join(", ").replace(/^a/, "A") + ".");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setUploading(false);
      onUploaded?.();
    }
  };
  return <>
    <button className="secondary upload-button" disabled={uploading} onClick={() => input.current?.click()}><Upload size={16} /> {uploading ? "Uploading…" : label}</button>
    <input ref={input} aria-label={label} type="file" accept=".3mf" multiple hidden disabled={uploading} onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
  </>;
}

export function PrintLibrary({ notify, title = "Print library", scope = "playcase", fileIds }: { notify: (m: string) => void; title?: string; scope?: "playcase" | "personal"; fileIds?: string[] }) {
  const [printing, setPrinting] = useState<LibraryFile | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  useEffect(() => { api<Asset[]>("/api/assets").then(a => setAssets(Array.isArray(a) ? a : [])).catch(() => notify("Could not load assets")); }, []);
  const { files: allFiles, refresh } = useLibrary(scope);
  const files=allFiles?.filter(f=>!fileIds || fileIds.includes(f.id));
  const [query,setQuery]=useState(""), [printerFilter,setPrinterFilter]=useState(""), [typeFilter,setTypeFilter]=useState(""), [categoryFilter,setCategoryFilter]=useState(""), [materialFilter,setMaterialFilter]=useState("");
  const [categories,setCategories]=useState<Category[]>([]);
  useEffect(()=>{api<Category[]>("/api/categories").then(c=>setCategories(Array.isArray(c)?c:[])).catch(()=>{});},[]);
  const linked=(f:LibraryFile)=>assets.filter(a=>f.plates.some(p=>p.coverage?.some(c=>c.assetId===a.id)));
  const printerOptions=Array.from(new Map((files||[]).filter(f=>f.preferredPrinter).map(f=>[f.preferredPrinter!,f.preferredPrinterName||f.preferredPrinter!])).entries()).sort((a,b)=>a[1].localeCompare(b[1]));
  const types=Array.from(new Set((files||[]).flatMap(f=>linked(f).map(a=>a.type)))).sort();
  const materials=Array.from(new Set((files||[]).flatMap(f=>f.plates.flatMap(p=>p.filaments.map(x=>x.type).filter(Boolean))))).sort();
  const visible=files?.filter(f=>{
    const parts=linked(f), text=[f.name,...parts.map(a=>a.name)].join(" ").toLowerCase();
    return text.includes(query.trim().toLowerCase()) && (!printerFilter || (printerFilter==='override'?!!f.printer:printerFilter==='unassigned'?!f.preferredPrinter:f.preferredPrinter===printerFilter)) && (!typeFilter || (typeFilter==='unlinked'?!parts.length:parts.some(a=>a.type===typeFilter))) && (!categoryFilter || parts.some(a=>a.category===categoryFilter)) && (!materialFilter || f.plates.some(p=>p.filaments.some(x=>x.type===materialFilter)));
  });
  const filtered=!!(query||printerFilter||typeFilter||categoryFilter||materialFilter);
  const reset=()=>{setQuery("");setPrinterFilter("");setTypeFilter("");setCategoryFilter("");setMaterialFilter("");};
  const remove = async (f: LibraryFile) => {
    if (!window.confirm(`Remove ${f.name} from the library?`)) return;
    await api(`/api/library/${f.id}`, { method: "DELETE" }).catch((e) => notify(e.message));
    refresh();
  };
  return (
    <section className="panel print-library" aria-label="Print library">
      <div className="section-top">
        <h2>{title}</h2>
        {!fileIds && <PrintUploadButton scope={scope} notify={notify} onUploaded={refresh} />}
      </div>
      {files && files.length === 0 && <div className="empty"><FileBox /><p>Upload sliced files from Orca or Bambu Studio (File → Export → Export all sliced file). Each plate becomes its own print.</p></div>}
      {!!files?.length && <div className="sliced-filters" aria-label="Filter sliced prints">
        <input type="search" aria-label="Search sliced prints" placeholder="Search prints or linked assets…" value={query} onChange={e=>setQuery(e.target.value)}/>
        <select aria-label="Filter by printer" value={printerFilter} onChange={e=>setPrinterFilter(e.target.value)}><option value="">All printers</option><option value="override">Print overrides only</option><option value="unassigned">No assigned printer</option>{printerOptions.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select>
        <select aria-label="Filter by part type" value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}><option value="">All part types</option>{types.map(t=><option key={t} value={t}>{t}</option>)}<option value="unlinked">No linked assets</option></select>
        <select aria-label="Filter by category" value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)}><option value="">All categories</option>{categories.filter(c=>(files||[]).some(f=>linked(f).some(a=>a.category===c.id))).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select aria-label="Filter by material" value={materialFilter} onChange={e=>setMaterialFilter(e.target.value)}><option value="">All materials</option>{materials.map(m=><option key={m} value={m}>{m}</option>)}</select>
        <div className="sliced-filter-summary"><small>{visible?.length} of {files.length} prints</small>{filtered&&<button className="text-button" onClick={reset}>Clear filters</button>}</div>
      </div>}
      {!!files?.length && !visible?.length && <p className="sliced-no-matches" role="status">No prints match these filters. Try another filter or clear them.</p>}
      <ul className="sliced-grid">
        {visible?.map((f) => (
          <li key={f.id} className="sliced-card">
            <div className="sliced-thumb">
              <SlicedPreview file={f} />
              <PrintDetails file={f} onSaved={refresh} notify={notify} />
              {!fileIds && <button className="icon-button sliced-delete" aria-label={`Remove ${f.name}`} onClick={() => remove(f)}><Trash2 size={15} /></button>}
            </div>
            <div className="sliced-body">
              <strong title={f.name}>{f.name}</strong>
              <small>
                {f.plates.map((p) => `${f.plates.length > 1 ? `Plate ${p.index} · ` : ""}${duration(p.minutes)} · ${p.grams} g${p.quantity ? ` · ${p.quantity} pieces` : ""}`).join("  ·  ")}
                {f.plates[0]?.filaments.map((x) => <span key={x.id} className="color-dot" title={x.type} style={{ background: x.color }} />)}
              </small>
              {f.preferredPrinterName && <small>{f.printerSource}: {f.preferredPrinterName}</small>}
              <PrintMetadata file={f} />
              <button className="primary sliced-print" onClick={() => setPrinting(f)}><Play size={14} /> Print</button>
              {scope !== "personal" && f.plates.map(p => <PlateAssets key={p.index} file={f} plate={p} assets={assets} onSaved={refresh} notify={notify} />)}
            </div>
          </li>
        ))}
      </ul>
      {printing && <LibraryPrintDialog file={printing} notify={notify} onClose={() => setPrinting(null)} />}
    </section>
  );
}

function LibraryPrintDialog({file, notify, onClose}: {file: LibraryFile; notify: (m:string) => void; onClose: () => void}) {
  const [machines, setMachines] = useState<Machine[]>([]), [selected, setSelected] = useState(""), [error, setError] = useState(""), [loaded, setLoaded] = useState(false);
  useEffect(() => {
    api<{machines:Machine[]}>("/api/workspace").then(data => {
      const idle = (data.machines || []).filter(m => m.connected && !m.stale && ["IDLE","FINISH","FAILED"].includes(m.rawState || ""));
      setMachines(idle); setSelected(file.preferredPrinter ? idle.find(m=>m.id===file.preferredPrinter)?.id || "" : idle[0]?.id || ""); setLoaded(true);
    }).catch(()=>{setError("Could not load printers");setLoaded(true);});
  }, []);
  const machine=machines.find(m=>m.id===selected);
  return <div className="modal-backdrop" onClick={onClose}><div className="order-print-dialog library-print-dialog" role="dialog" aria-modal="true" aria-label={`Print ${file.name}`} onClick={e=>e.stopPropagation()} onKeyDown={e=>e.key==="Escape" && onClose()}>
    <div className="section-top"><h3>Print {file.name}</h3><button className="text-button" onClick={onClose}>Close</button></div>
    {error ? <p role="alert">{error}</p> : !loaded ? <p>Loading printers…</p> : !machines.length ? <p>No connected idle printer is available.</p> : <>{file.preferredPrinter && !machines.some(m=>m.id===file.preferredPrinter) && <p className="plate-meta">{file.preferredPrinterName || "The default printer"} is busy or offline. Choose another printer to continue.</p>}<label>Printer<select aria-label="Printer" value={selected} onChange={e=>setSelected(e.target.value)}><option value="" disabled>Choose a printer…</option>{machines.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>{machine && <StartPrint key={machine.id} machine={machine} notify={notify} initialFile={file.id} onSent={onClose} />}</>}
  </div></div>;
}

function PrintDetails({file, onSaved, notify}: {file: LibraryFile; onSaved: () => void; notify: (m: string) => void}) {
  const [editing, setEditing] = useState(false), [name, setName] = useState(file.name), [counts, setCounts] = useState<Record<number,string>>({}), [busy, setBusy] = useState(false);
  const [printers, setPrinters] = useState<Machine[]>([]), [printer, setPrinter] = useState(file.printer || "");
  const open = () => { api<{machines:Machine[]}>("/api/workspace").then(d=>setPrinters(d.machines || [])).catch(()=>{}); setPrinter(file.printer || ""); setName(file.name); setCounts(Object.fromEntries(file.plates.map(p => [p.index, p.quantity == null ? "" : String(p.quantity)]))); setEditing(true); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await api(`/api/library/${file.id}`, {method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({name, printer: printer || null, quantities: file.plates.map(p => ({plate:p.index,quantity: counts[p.index] ? Number(counts[p.index]) : null}))})}); onSaved(); setEditing(false); notify("Print details saved"); }
    catch(e) { notify((e as Error).message); } finally { setBusy(false); }
  };
  return <><button className="icon-button sliced-edit" title="Edit details" aria-label={`Edit print details for ${file.name}`} onClick={open}><Pencil size={15} /></button>
    {editing && <div className="modal-backdrop" onClick={() => !busy && setEditing(false)}><form className="modal plate-assets-editor print-details-editor" role="dialog" aria-modal="true" aria-label={`Print details for ${file.name}`} onClick={e=>e.stopPropagation()} onKeyDown={e=>e.key==="Escape" && !busy && setEditing(false)} onSubmit={save}>
      <div className="section-top"><h3>Print details</h3><button type="button" className="text-button" disabled={busy} onClick={()=>setEditing(false)}>Cancel</button></div>
      <label>Print name<input autoFocus required maxLength={80} value={name} onChange={e=>setName(e.target.value)} /></label>
      {file.plates.map(p=><label key={p.index}>{file.plates.length>1 ? `Plate ${p.index} · ` : ""}Pieces per print<input type="number" min={1} max={10000} step={1} placeholder="e.g. 144" value={counts[p.index] || ""} onChange={e=>setCounts({...counts,[p.index]:e.target.value})} /></label>)}
      <label>Default printer<select aria-label="Default printer" value={printer} onChange={e=>setPrinter(e.target.value)}><option value="">Use category default</option>{printers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <p className="plate-meta">Total pieces made by this plate. Leave blank if unknown.</p>
      <button className="primary" disabled={busy}>{busy ? "Saving…" : "Save print details"}</button>
    </form></div>}
  </>;
}

// The slicer's picture of the plate, from inside the sliced file.
function SlicedPreview({ file }: { file: LibraryFile }) {
  const [failed, setFailed] = useState(false);
  return failed ? <FileBox size={34} /> : <img src={`/api/library/${file.id}/preview.png?v=${encodeURIComponent(file.updated || file.created)}`} alt={`Slicer preview of ${file.name}`} loading="lazy" onError={() => setFailed(true)} />;
}

const PLATE_TYPES = ["Case", "Faceplate", "Sleeve", "Part"];
function PlateAssets({file, plate, assets, onSaved, notify}: {file: LibraryFile; plate: Plate; assets: Asset[]; onSaved: () => void; notify: (m:string) => void}) {
  const [editing, setEditing] = useState(false), [ids, setIds] = useState<string[]>([]), [query, setQuery] = useState(""), [busy, setBusy] = useState(false);
  const [type, setType] = useState("All");
  const choosable = assets.filter(a => a.hasStl && !ids.includes(a.id)).sort((x, y) => PLATE_TYPES.indexOf(x.type) - PLATE_TYPES.indexOf(y.type) || x.name.localeCompare(y.name));
  const coverage = plate.coverage || [];
  const save = async () => {
    setBusy(true);
    try { await api(`/api/library/${file.id}`, {method: "PATCH", headers: {"Content-Type": "application/json"}, body: JSON.stringify({plate: plate.index, assetIds: ids})}); onSaved(); setEditing(false); notify("Plate assets saved"); }
    catch(e) { notify((e as Error).message); } finally { setBusy(false); }
  };
  const open = () => { setIds(coverage.map(c => c.assetId)); setQuery(""); setType("All"); setEditing(true); };
  return <div className="plate-assets">
    <div className="part-chips-list">{coverage.length ? coverage.map(c => <span className="part-chip" key={c.assetId}>{assets.find(a => a.id === c.assetId)?.name || "Deleted asset"}</span>) : <small>No assets linked</small>}</div>
    <button className="asset-add-pill" aria-label="Edit assets" title="Edit assets" onClick={open}><Plus size={15} /></button>
    {editing && <div className="modal-backdrop" onClick={() => !busy && setEditing(false)}><div className="modal plate-assets-editor" role="dialog" aria-modal="true" aria-label={`Assets for ${file.name}`} onClick={e => e.stopPropagation()} onKeyDown={e => e.key === "Escape" && !busy && setEditing(false)}>
      <div className="section-top"><h3>{file.name}{file.plates.length > 1 ? ` · Plate ${plate.index}` : ""}</h3><button className="text-button" disabled={busy} onClick={() => setEditing(false)}>Cancel</button></div>
      <div className="part-chips-list">{ids.map(id => <button className="part-chip" key={id} disabled={busy} onClick={() => setIds(ids.filter(x => x !== id))}>{assets.find(a => a.id === id)?.name || "Deleted asset"} ×</button>)}</div>
      <input aria-label={`Search assets for plate ${plate.index}`} placeholder="Search assets" value={query} onChange={e => setQuery(e.target.value)} />
      <div className="plate-types" role="group" aria-label="Asset type">{["All", ...PLATE_TYPES].map(t => <button key={t} className={`filter-chip${type === t ? " selected" : ""}`} aria-pressed={type === t} onClick={() => setType(t)}>{t === "All" ? "All" : `${t}s`} <small>{choosable.filter(a => t === "All" || a.type === t).length}</small></button>)}</div>
      <div className="plate-options">{choosable.filter(a => (type === "All" || a.type === type) && a.name.toLowerCase().includes(query.toLowerCase())).map(a => <button disabled={busy} key={a.id} className="text-button" onClick={() => setIds([...ids,a.id])}>{a.name}</button>)}</div>
      <p className="plate-meta">Choose every part this plate prints.</p>
      <button className="primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save plate assets"}</button>
    </div></div>}
  </div>;
}

// A fresh photo from the printer's camera, to confirm the bed is empty before starting.
export function BedCheck({ machine }: { machine: Machine }) {
  const [stamp, setStamp] = useState(() => Date.now()), [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const refresh = () => { setState("loading"); setStamp(Date.now()); };
  return (
    <figure className="bed-check">
      <img key={stamp} src={`/api/printers/${machine.id}/camera.jpg?t=${stamp}`} alt={`Camera view of ${machine.name}'s bed`} onLoad={() => setState("ready")} onError={() => setState("error")} hidden={state !== "ready"} />
      {state !== "ready" && <div className="bed-check-placeholder">{state === "loading" ? "Getting a photo of the bed…" : "Camera unavailable"}</div>}
      <figcaption>
        <span>{state === "ready" ? `Bed photo · ${new Date(stamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : "Bed photo"}</span>
        <button type="button" className="text-button" onClick={refresh} disabled={state === "loading"}><RefreshCw size={14} /> Refresh</button>
      </figcaption>
    </figure>
  );
}


function PrintMetadata({file}:{file:LibraryFile}) {
 const [open,setOpen]=useState(false),[data,setData]=useState<Record<string,unknown>|null>(null),[error,setError]=useState("");
 const show=()=>{setOpen(true);setError("");setData(null);api<{settings:Record<string,unknown>}>(`/api/library/${file.id}/metadata`).then(d=>setData(d.settings)).catch(e=>setError(e.message));};
 return <><button className="text-button sliced-metadata" onClick={show}><Info size={14}/> Print settings</button>{open&&<div className="modal-backdrop" onClick={()=>setOpen(false)}><section className="plate-assets-editor" role="dialog" aria-modal="true" aria-label={`Print settings for ${file.name}`} onClick={e=>e.stopPropagation()} onKeyDown={e=>e.key==='Escape'&&setOpen(false)}><div className="section-top"><h3>{file.name}</h3><button className="text-button" onClick={()=>setOpen(false)}>Close</button></div><p className="plate-meta">Settings recorded by the slicer. Check the printer profile, nozzle and bed before using another printer.</p>{file.preferredPrinterName&&<p>Assigned printer: {file.preferredPrinterName}</p>}{error?<p role="alert">{error}</p>:data===null?<p>Loading settings…</p>:Object.keys(data).length?<dl className="print-metadata">{Object.entries(data).map(([key,value])=><div key={key}><dt>{({curr_bed_type:'Bed type',printer_model:'Printer model',printer_variant:'Printer variant',printer_settings_id:'Printer profile',nozzle_diameter:'Nozzle diameter (mm)',layer_height:'Layer height (mm)',filament_settings_id:'Filament profile'} as Record<string,string>)[key] || key.replaceAll('_',' ')}</dt><dd>{Array.isArray(value)?value.join(', '):String(value)}</dd></div>)}</dl>:<p>No printer or bed settings were recorded in this file.</p>}<p className="plate-meta">Material: {Array.from(new Set(file.plates.flatMap(p=>p.filaments.map(f=>f.type)))).join(', ')||'Not recorded'}</p></section></div>}</>;
}
