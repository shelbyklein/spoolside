import { useEffect, useState } from "react";
import { Check, Plus, Square, X } from "lucide-react";
import { NeedPhoto, NeedRow } from "./NeedsYou";
import { failure, type Notify } from "./Toast";
import { confirmAction } from "./Confirm";
import { Fold } from "./Fold";

export type BedWarning = { id: string; printer: string; printerName: string; job: string; reason: string; at: number };
type Settings = { visibleOnly: boolean; allow: { id: string; text: string; at: number }[]; reference: { note: string; taught: number; area: boolean } | null };

async function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, cache: "no-store", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || "Couldn't save");
  return d;
}

// You started a print the camera had doubts about: the photo from just before, and what to do about it.
// "It was clear" only answers this warning; notes on what's fine on a bed are written by hand in its settings,
// so the camera is never told to ignore something it described as a part.
export function BedWarnings({ warnings, refresh, notify }: { warnings: BedWarning[]; refresh: () => void; notify: Notify }) {
  const [busy, setBusy] = useState("");
  const act = async (w: BedWarning, what: () => Promise<unknown>, done: string): Promise<void> => {
    setBusy(w.id);
    try { await what(); notify(done); } catch (e) { notify((e as Error).message, failure(() => act(w, what, done))); } finally { setBusy(""); refresh(); }
  };
  return (
    <>
      {warnings.map((w) => (
        <NeedRow key={w.id} tone="warn" label={`Check ${w.printerName}'s bed`} title={`Check ${w.printerName}'s bed`}
          media={<a href={`/api/dispatch/${w.printer}/bed-warning.jpg?id=${w.id}`} aria-label={`Open ${w.printerName}'s bed photo`} target="_blank" rel="noreferrer"><NeedPhoto src={`/api/dispatch/${w.printer}/bed-warning.jpg?id=${w.id}`} alt={`${w.printerName}'s bed just before the print started`} /></a>}
          actions={<>
            <button className="secondary danger" disabled={busy === w.id} onClick={async () => {
              if (!(await confirmAction({ title: `Stop the print on ${w.printerName}?`, body: "This can't be undone.", confirmLabel: "Stop print", danger: true }))) return;
              act(w, async () => { await send("POST", `/api/printers/${w.printer}/stop`); await send("DELETE", `/api/dispatch/${w.printer}/bed-warning`); }, `Stopped the print on ${w.printerName}.`);
            }}><Square size={13} /> Stop print</button>
            <button className="primary" disabled={busy === w.id} onClick={() => act(w, () => send("DELETE", `/api/dispatch/${w.printer}/bed-warning`), "Thanks. Teach its empty bed if the camera keeps getting it wrong.")}><Check size={14} /> It was clear</button>
          </>}>
          You started <b>{w.job || "a print"}</b>; the camera thought: {w.reason}
        </NeedRow>
      ))}
    </>
  );
}

// A note that describes a thing on the plate ("a green part is sitting on the build plate") tells the camera to
// ignore exactly what it's there to catch; such notes are flagged.
export const describesAPart = (text: string) => /\b(part|parts|object|piece|print|disc|strand|strands|blob|tool|case|membrane|material|filament)\b/i.test(text) && /\b(on|sitting|left|lying|resting)\b/i.test(text) && !/\b(fixture|tape|clip|sticker|outline|scratch|mark|edge|frame|glare)\b/i.test(text);

// A printer's bed check, tuned: judge the visible plate or the whole plate, and notes on what's fine on it.
export function BedCheckSettings({ printer, name, notify, onTeach, canTeach }: { printer: string; name: string; notify: Notify; onTeach: () => void; canTeach: boolean }) {
  const [s, setS] = useState<Settings | null>(null), [text, setText] = useState(""), [busy, setBusy] = useState(false);
  const url = `/api/dispatch/${printer}`;
  useEffect(() => {
    setS(null);
    send<Settings>("GET", `${url}/bed-settings`).then((d) => Array.isArray(d?.allow) && setS(d)).catch(() => {});
  }, [printer]);
  const save = async (p: Promise<Settings>, done?: string) => {
    setBusy(true);
    try { setS(await p); if (done) notify(done); return true; } catch (e) { notify((e as Error).message, failure()); return false; } finally { setBusy(false); }
  };
  // Until its settings load (or if they can't), the section still offers teaching the empty bed.
  if (!s) return canTeach ? <section className="bed-settings" aria-label={`${name} bed check`}><Fold title="Bed check" summary="Loading…"><p className="plate-meta"><button className="text-button" onClick={onTeach}>Teach bed check</button></p></Fold></section> : null;
  const risky = s.allow.filter((a) => describesAPart(a.text)).length;
  const summary = [
    s.reference ? `Empty bed taught ${new Date(s.reference.taught).toLocaleDateString([], { month: "short", day: "numeric" })}` : "Not taught yet",
    s.visibleOnly ? "goes by what's visible" : "checks the whole plate",
    s.allow.length ? `${s.allow.length} ${s.allow.length === 1 ? "note" : "notes"}` : "",
    risky ? "a note may hide a part" : "",
  ].filter(Boolean).join(" · ");
  return (
    <section className="bed-settings" aria-label={`${name} bed check`}>
    <Fold title="Bed check" summary={summary} tone={risky ? "warn" : undefined}>
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
      {s.allow.filter((a) => describesAPart(a.text)).length > 0 && <p className="bed-allow-warn" role="alert">{s.allow.filter((a) => describesAPart(a.text)).length === 1 ? "1 note describes" : `${s.allow.filter((a) => describesAPart(a.text)).length} notes describe`} something on the plate. The camera may ignore a real part left on the bed; remove {s.allow.filter((a) => describesAPart(a.text)).length === 1 ? "it" : "them"} unless it's a fixture.</p>}
      {!s.allow.length && <p className="plate-meta">Nothing yet. Add fixed things the camera keeps mistaking for a part, like tape, a clip or the plate sitting forward. For anything else, teach the empty bed.</p>}
      <ul className="bed-allow">
        {s.allow.map((a) => (
          <li key={a.id} className={describesAPart(a.text) ? "risk" : undefined}>
            <span>{a.text}</span>
            {describesAPart(a.text) && <em>Describes a part</em>}
            <button className="icon-button" aria-label={`Remove “${a.text}”`} disabled={busy} onClick={() => save(send("DELETE", `${url}/bed-allow/${a.id}`))}><X size={14} /></button>
          </li>
        ))}
      </ul>
      <form className="bed-allow-add" onSubmit={async (e) => { e.preventDefault(); if (await save(send("POST", `${url}/bed-allow`, { text }), "Saved. The next check will take it into account.")) setText(""); }}>
        <input aria-label={`Something that's fine on ${name}'s bed`} maxLength={300} placeholder="e.g. The bed sits forward, so the front edge is out of frame" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="secondary" disabled={busy || !text.trim()}><Plus size={14} /> Add</button>
      </form>
    </Fold>
    </section>
  );
}
