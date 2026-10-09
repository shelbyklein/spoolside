import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Eye, Play, Square, X, NotebookPen, Trash2, Plus } from "lucide-react";

type Check = { at: number; verdict: "ok" | "problem" | "unsure" | "dark" | "error" | "saved"; reason?: string; file?: string; final?: string | null; reference?: boolean };
export type Watch = {
  id: string;
  printer: string;
  printerName: string;
  job: string;
  started: number;
  ended: number | null;
  endedAs: "finished" | "stopped" | "ended" | null;
  outcome: "success" | "failed" | null;
  note?: string | null;
  inLibrary?: boolean;
  external?: boolean;
  importDismissed?: boolean;
  mode: "pause" | "warn";
  plan: boolean;
  check: Check | null;
  alert: { at: number; reason: string; file: string; paused: boolean } | null;
};
type Watches = { vision: boolean; watches: Watch[]; recent?: Watch[] };
const saveOutcome = (id: string, success: boolean, note?: string) =>
  fetch(`/api/watches/${id}/outcome`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(note === undefined ? { success } : { success, note }) }).then((r) => {
    if (!r.ok) throw Error("Couldn't save");
  });

const saveNote = (id: string, note: string) =>
  fetch(`/api/watches/${id}/note`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) }).then(r => { if (!r.ok) throw Error("Couldn't save note"); });
// Notes can be saved independently of the print outcome.
function FailureNote({ initial = "", label, onSave, onCancel, busy, general = false }: { general?: boolean; initial?: string; label: string; onSave: (note: string) => void; onCancel: () => void; busy: boolean }) {
  const [note, setNote] = useState(initial);
  return (
    <form className="failure-note" onSubmit={(e) => { e.preventDefault(); onSave(note); }}>
      <label>
        {general ? "Print notes" : "What went wrong?"} <small>Optional</small>
        <textarea autoFocus rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={general ? "Add an observation or reminder about this print" : "e.g. Corner lifted, spaghetti after the bridge, wrong filament"} />
      </label>
      <div className="watch-actions">
        <button className="primary" disabled={busy}>{label}</button>
        <button type="button" className="text-button" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

async function post(url: string) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(body.error || "Request failed");
  return body;
}
const ago = (at: number) => {
  const m = Math.round((Date.now() - at) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};
const photo = (w: Watch, file?: string | null) => (file ? `/api/watches/${w.id}/${file}` : null);
const jobName = (job: string) => job.replace(/^spoolside_/, "").replace(/(\.gcode)?\.3mf$/i, "").replace(/_/g, " ");

// Polls the print watcher: active prints, alerts, and finished prints waiting for your answer.
export function useWatches(enabled: boolean) {
  const [data, setData] = useState<Watches>({ vision: false, watches: [] });
  const refresh = () =>
    fetch("/api/watches", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && Array.isArray(d.watches) && setData(d))
      .catch(() => {});
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    refresh();
    timer.current = window.setInterval(refresh, 20000);
    return () => clearInterval(timer.current);
  }, [enabled]);
  return { ...data, refresh };
}

// Alerts first, then "how did it go?" for finished prints. Renders nothing when all is quiet.
export function WatchAttention({ watches, refresh, notify, water = false }: { watches: Watch[]; refresh: () => void; notify: (m: string) => void; water?: boolean }) {
  const [busy, setBusy] = useState(""), [failing, setFailing] = useState(""), [noting, setNoting] = useState(""), [succeeding, setSucceeding] = useState("");
  const act = async (key: string, run: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await run();
      notify(done);
      refresh();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const focusedRating = useRef("");
  const rating = new URLSearchParams(window.location.search).get("rate");
  useEffect(() => {
    if (!rating || focusedRating.current === rating || !watches.some(w=>w.id===rating && w.ended && !w.outcome)) return;
    const card=document.getElementById(`rate-${rating}`);
    if (card) focusedRating.current = rating;
    card?.scrollIntoView({block:"center"});
    card?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});
  }, [rating, watches]);
  const importing = new URLSearchParams(window.location.search).get("import");
  useEffect(() => {
    if (importing) document.getElementById(`import-${importing}`)?.scrollIntoView({block:"center"});
  }, [importing, watches]);
  const alerts = watches.filter((w) => !w.ended && w.alert);
  const asks = watches.filter((w) => w.ended && !w.outcome);
  const imports = watches.filter(w => w.external && w.inLibrary === false && !w.importDismissed);
  if (!alerts.length && !asks.length && !imports.length) return null;
  return (
    <div className={`watch-attention${water ? " on-water" : ""}`}>
      {imports.map(w => <article id={`import-${w.id}`} key={`import-${w.id}`} className="watch-card" aria-label={`Add ${jobName(w.job)} to library?`}>
        <h3>Add this print to the library?</h3>
        <p className="watch-job">{jobName(w.job)} · {w.printerName}</p>
        <p>Started outside Spoolside. Save its sliced plate for printing again.</p>
        <div className="watch-actions">
          <button className="primary" disabled={!!busy} onClick={() => act(w.id + "library", () => post(`/api/watches/${w.id}/library`), "Added to Sliced prints with this printer as its default.")}><Plus size={15} /> {busy === w.id + "library" ? "Adding…" : "Add to library"}</button>
          <button className="secondary" disabled={!!busy} onClick={() => act(w.id + "dismiss", () => post(`/api/watches/${w.id}/dismiss-import`), "Skipped this print.")}>Not now</button>
        </div>
      </article>)}
      {alerts.map((w) => (
        <article key={w.id} className="watch-card alert" aria-label={`${w.printerName} alert`}>
          <h3><AlertTriangle size={17} /> {w.alert!.paused ? `Spoolside paused ${w.printerName}` : `Check ${w.printerName}`}</h3>
          <p className="watch-job">{jobName(w.job)} · {ago(w.alert!.at)}</p>
          <img src={photo(w, w.alert!.file)!} alt={`Camera photo of ${w.printerName} when the problem was spotted`} loading="lazy" />
          <p>{w.alert!.reason}</p>
          <div className="watch-actions">
            <button className="primary" disabled={!!busy} onClick={() => act(w.id + "ok", () => post(`/api/watches/${w.id}/false-alarm`), w.alert!.paused ? `Resumed ${w.printerName}.` : "Thanks, noted.")}>
              {w.alert!.paused ? <><Play size={15} /> False alarm, resume</> : <><Check size={15} /> Looks fine</>}
            </button>
            <button className="secondary danger" disabled={!!busy} onClick={() => window.confirm(`Stop the print on ${w.printerName}? This can't be undone.`) && act(w.id + "stop", () => post(`/api/printers/${w.printer}/stop`), `Stopped ${w.printerName}.`)}>
              <Square size={14} /> Stop print
            </button>
          </div>
        </article>
      ))}
      {asks.map((w) => (
        <article id={`rate-${w.id}`} key={w.id} className={`watch-card${rating===w.id ? " rating-target" : ""}`} aria-label={`How did ${jobName(w.job)} go?`}>
          <h3>How did {jobName(w.job)} go?</h3>
          <p className="watch-job">{w.endedAs === "finished" ? "Finished" : "Stopped"} on {w.printerName} · {ago(w.ended!)}</p>
          {photo(w, w.check?.final) && <img src={photo(w, w.check?.final)!} alt={`Camera photo of ${w.printerName} after the print`} loading="lazy" />}
          {w.note && <p className="recent-print-note">{w.note}</p>}
          {w.inLibrary === false && (!w.external || w.importDismissed) && <button className="text-button" disabled={!!busy} onClick={() => act(w.id + "library", () => post(`/api/watches/${w.id}/library`), "Added to Sliced prints with this printer as its default.")}><Plus size={15} /> {busy === w.id + "library" ? "Adding…" : "Add to library"}</button>}
          {noting === w.id ? (
            <FailureNote general initial={w.note || ""} label="Save note" busy={!!busy} onCancel={() => setNoting("")} onSave={(note) => act(w.id + "note", () => saveNote(w.id, note), "Note saved.").then(() => setNoting(""))} />
          ) : succeeding === w.id ? (
            <FailureNote general initial={w.note || ""} label="Save as successful" busy={!!busy} onCancel={() => setSucceeding("")} onSave={(note) => act(w.id + "yes", () => saveOutcome(w.id, true, note), "Saved as successful.").then(() => setSucceeding(""))} />
          ) : failing === w.id ? (
            <FailureNote initial={w.note || ""} label="Save as failed" busy={!!busy} onCancel={() => setFailing("")} onSave={(note) => act(w.id + "no", () => saveOutcome(w.id, false, note), "Saved as failed.").then(() => setFailing(""))} />
          ) : (
            <div className="watch-actions">
              <button className="primary icon-only" aria-label="Came out fine" title="Came out fine" disabled={!!busy} onClick={() => setSucceeding(w.id)}>
                <Check size={18} />
              </button>
              <button className="secondary icon-only" aria-label="Failed" title="Failed" disabled={!!busy} onClick={() => setFailing(w.id)}>
                <Trash2 size={18} />
              </button>
              <button className="secondary" disabled={!!busy} onClick={() => setNoting(w.id)}><NotebookPen size={15} /> Notes</button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

const VERDICT: Record<Check["verdict"], string> = {
  ok: "Looks good",
  problem: "Something looks off, taking a second look",
  unsure: "Couldn't tell from the photo",
  dark: "Too dark to see",
  error: "Couldn't check",
  saved: "Saving progress photos",
};
// One line in a printer's details: what the watcher last saw.
export function WatchStatus({ watch, vision }: { watch?: Watch; vision: boolean }) {
  if (!watch || watch.ended) return null;
  const c = watch.check;
  return (
    <p className="watch-status">
      <Eye size={15} />
      <span>
        Watching{watch.mode === "warn" ? " (warnings only)" : ""}
        {c ? ` · ${VERDICT[c.verdict]} · ${ago(c.at)}` : " · first check in about a minute"}
        {!vision && " · Problem checks start once the vision key is added."}
        {c?.verdict === "ok" && !c.reference && " · First run of this job: answer at the end to teach it."}
      </span>
    </p>
  );
}

// A printer's latest answered prints; failed ones show their note, which can be added or edited.
export function RecentPrints({ printer, recent, refresh, notify }: { printer: string; recent: Watch[]; refresh: () => void; notify: (m: string) => void }) {
  const [editing, setEditing] = useState(""), [busy, setBusy] = useState(false);
  const mine = recent.filter((w) => w.printer === printer).slice(0, 5);
  if (!mine.length) return null;
  const save = async (w: Watch, note: string) => {
    setBusy(true);
    try {
      await saveNote(w.id, note);
      setEditing("");
      refresh();
      notify("Note saved.");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="recent-prints" aria-label="Recent prints">
      <h3>Recent prints</h3>
      <ul>
        {mine.map((w) => (
          <li key={w.id} className={w.outcome || ""}>
            <span className="recent-print-head">
              {w.outcome === "success" ? <Check size={14} /> : <X size={14} />}
              <strong>{jobName(w.job)}</strong>
              <small>{w.ended ? ago(w.ended) : ""}</small>
            </span>
            {w.inLibrary === false && <button className="text-button" disabled={busy} onClick={async () => {
              setBusy(true);
              try { await post(`/api/watches/${w.id}/library`); refresh(); notify("Added to Sliced prints."); }
              catch (e) { notify((e as Error).message); }
              finally { setBusy(false); }
            }}><Plus size={15} /> Add to library</button>}
            {(editing === w.id ? (
                <FailureNote general initial={w.note || ""} label="Save note" busy={busy} onCancel={() => setEditing("")} onSave={(note) => save(w, note)} />
              ) : (
                <span className="recent-print-note">
                  {w.note ? <p>{w.note}</p> : null}
                  <button className="text-button" onClick={() => setEditing(w.id)}>{w.note ? "Edit note" : "Add note"}</button>
                </span>
              ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
