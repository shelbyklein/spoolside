import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Eye, Play, Square, X } from "lucide-react";

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
  mode: "pause" | "warn";
  plan: boolean;
  check: Check | null;
  alert: { at: number; reason: string; file: string; paused: boolean } | null;
};
type Watches = { vision: boolean; watches: Watch[] };

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
  const [busy, setBusy] = useState("");
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
  const alerts = watches.filter((w) => !w.ended && w.alert);
  const asks = watches.filter((w) => w.ended && !w.outcome);
  if (!alerts.length && !asks.length) return null;
  return (
    <div className={`watch-attention${water ? " on-water" : ""}`}>
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
        <article key={w.id} className="watch-card" aria-label={`How did ${jobName(w.job)} go?`}>
          <h3>How did {jobName(w.job)} go?</h3>
          <p className="watch-job">{w.endedAs === "finished" ? "Finished" : "Stopped"} on {w.printerName} · {ago(w.ended!)}</p>
          {photo(w, w.check?.final) && <img src={photo(w, w.check?.final)!} alt={`Camera photo of ${w.printerName} after the print`} loading="lazy" />}
          <div className="watch-actions">
            <button className="primary" disabled={!!busy} onClick={() => act(w.id + "yes", () => fetch(`/api/watches/${w.id}/outcome`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ success: true }) }).then((r) => { if (!r.ok) throw Error("Couldn't save"); }), "Saved. Spoolside will compare future runs with this one.")}>
              <Check size={15} /> Came out fine
            </button>
            <button className="secondary" disabled={!!busy} onClick={() => act(w.id + "no", () => fetch(`/api/watches/${w.id}/outcome`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ success: false }) }).then((r) => { if (!r.ok) throw Error("Couldn't save"); }), "Saved as failed.")}>
              <X size={15} /> Failed
            </button>
          </div>
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
