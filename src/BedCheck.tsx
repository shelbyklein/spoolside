import { useEffect, useState } from "react";
import { Camera, Check, Plus, Square, X } from "lucide-react";

export type BedWarning = { id: string; printer: string; printerName: string; job: string; reason: string; at: number };
type Settings = { visibleOnly: boolean; allow: { id: string; text: string; at: number }[]; reference: { note: string; taught: number; area: boolean } | null };

async function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, cache: "no-store", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || "Couldn't save");
  return d;
}

// What a wrong hold becomes: a note this printer's later checks are told to accept.
export const rememberText = (reason: string) => `Not a reason to hold: ${reason.replace(/^Bed check:\s*/i, "").trim()}`;
export const rememberBed = (printer: string, reason: string, warning = false) => send<Settings>("POST", `/api/dispatch/${printer}/bed-allow`, { text: rememberText(reason), warning });

// You started a print the camera had doubts about: the photo from just before, and what to do about it.
export function BedWarnings({ warnings, refresh, notify, water = false }: { warnings: BedWarning[]; refresh: () => void; notify: (m: string) => void; water?: boolean }) {
  const [busy, setBusy] = useState("");
  if (!warnings.length) return null;
  const act = async (w: BedWarning, what: () => Promise<unknown>, done: string) => {
    setBusy(w.id);
    try { await what(); notify(done); } catch (e) { notify((e as Error).message); } finally { setBusy(""); refresh(); }
  };
  return (
    <div className={`watch-attention${water ? " on-water" : ""}`}>
      {warnings.map((w) => (
        <article key={w.id} className="watch-card bed-warning" aria-label={`Check ${w.printerName}'s bed`}>
          <h3><Camera size={17} /> Check {w.printerName}'s bed</h3>
          <div className="bed-warning-body">
            <a href={`/api/dispatch/${w.printer}/bed-warning.jpg?id=${w.id}`} target="_blank" rel="noreferrer"><img src={`/api/dispatch/${w.printer}/bed-warning.jpg?id=${w.id}`} alt={`${w.printerName}'s bed just before the print started`} /></a>
            <p>You started <strong>{w.job || "a print"}</strong>, but the camera thought: {w.reason}</p>
          </div>
          <div className="watch-actions">
            <button className="secondary" disabled={busy === w.id} onClick={() => {
              if (!window.confirm(`Stop the print on ${w.printerName}? This can't be undone.`)) return;
              act(w, async () => { await send("POST", `/api/printers/${w.printer}/stop`); await send("DELETE", `/api/dispatch/${w.printer}/bed-warning`); }, `Stopped the print on ${w.printerName}.`);
            }}><Square size={14} /> Stop print</button>
            <button className="primary" disabled={busy === w.id} onClick={() => act(w, () => rememberBed(w.printer, w.reason, true), `Got it. ${w.printerName}'s bed check won't count that again.`)}><Check size={15} /> It was clear, remember this</button>
            <button className="text-button" disabled={busy === w.id} onClick={() => act(w, () => send("DELETE", `/api/dispatch/${w.printer}/bed-warning`), "Dismissed.")}>Dismiss</button>
          </div>
        </article>
      ))}
    </div>
  );
}

// A printer's bed check, tuned: judge the visible plate or the whole plate, and notes on what's fine on it.
export function BedCheckSettings({ printer, name, notify, onTeach, canTeach }: { printer: string; name: string; notify: (m: string) => void; onTeach: () => void; canTeach: boolean }) {
  const [s, setS] = useState<Settings | null>(null), [text, setText] = useState(""), [busy, setBusy] = useState(false);
  const url = `/api/dispatch/${printer}`;
  useEffect(() => {
    setS(null);
    send<Settings>("GET", `${url}/bed-settings`).then((d) => Array.isArray(d?.allow) && setS(d)).catch(() => {});
  }, [printer]);
  const save = async (p: Promise<Settings>, done?: string) => {
    setBusy(true);
    try { setS(await p); if (done) notify(done); return true; } catch (e) { notify((e as Error).message); return false; } finally { setBusy(false); }
  };
  // Until its settings load (or if they can't), the section still offers teaching the empty bed.
  if (!s) return canTeach ? <section className="bed-settings" aria-label={`${name} bed check`}><h3>Bed check</h3><p className="plate-meta"><button className="text-button" onClick={onTeach}>Teach bed check</button></p></section> : null;
  return (
    <section className="bed-settings" aria-label={`${name} bed check`}>
      <h3>Bed check</h3>
      <p className="plate-meta">
        {s.reference ? `Knows ${name}'s empty bed (taught ${new Date(s.reference.taught).toLocaleDateString([], { month: "short", day: "numeric" })}${s.reference.area ? ", plate marked" : ""}).` : `Hasn't been shown ${name}'s empty bed yet.`}{" "}
        {canTeach && <button className="text-button" onClick={onTeach}>{s.reference ? "Teach again" : "Teach bed check"}</button>}
      </p>
      <label className="check-row">
        <input type="checkbox" checked={s.visibleOnly} onChange={(e) => {
          const on = e.target.checked;
          // Flip it right away; if saving fails, the setting goes back.
          setS({ ...s, visibleOnly: on });
          save(send("PUT", `${url}/bed-settings`, { visibleOnly: on })).then((ok) => !ok && setS((cur) => cur && { ...cur, visibleOnly: !on }));
        }} />
        <span>Go by what's visible <small>Don't hold just because part of the plate is out of frame or under glare.</small></span>
      </label>
      <h4>Fine on {name}</h4>
      {!s.allow.length && <p className="plate-meta">Nothing yet. Add things the camera keeps mistaking for a problem, or tap “Wrong, remember this” on a hold.</p>}
      <ul className="bed-allow">
        {s.allow.map((a) => (
          <li key={a.id}>
            <span>{a.text}</span>
            <button className="icon-button" aria-label={`Remove “${a.text}”`} disabled={busy} onClick={() => save(send("DELETE", `${url}/bed-allow/${a.id}`))}><X size={14} /></button>
          </li>
        ))}
      </ul>
      <form className="bed-allow-add" onSubmit={async (e) => { e.preventDefault(); if (await save(send("POST", `${url}/bed-allow`, { text }), "Saved. The next check will take it into account.")) setText(""); }}>
        <input aria-label={`Something that's fine on ${name}'s bed`} maxLength={300} placeholder="e.g. The bed sits forward, so the front edge is out of frame" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="secondary" disabled={busy || !text.trim()}><Plus size={14} /> Add</button>
      </form>
    </section>
  );
}
