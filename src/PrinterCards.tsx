import { useEffect, useRef, useState } from "react";
import { Printer, Repeat, Thermometer, VideoOff } from "lucide-react";
import type { Machine } from "./live-workspace";
import { Skeleton } from "./Skeleton";
import { SpoolChips, loadedSpools } from "./LoadedSpools";

export const jobName = (job: string) => job.replace(/^spoolside_/, "").replace(/(\.gcode)?\.3mf$/i, "").replace(/_/g, " ");
const temp = (t?: number | null) => (t == null ? "—" : Math.round(t) + "°");

// The printer's camera, refreshed every 2 s (about the A1 mini's own frame rate) while the card is on screen.
export function CameraFeed({ machine, live }: { machine: Machine; live: boolean }) {
  const box = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [frame, setFrame] = useState<{ src: string; at: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const online = live && !!machine.connected && !machine.stale;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!online || !visible) return;
    let stop = false, timer = 0;
    const urls: string[] = [];
    const next = async () => {
      if (document.hidden) return void (timer = window.setTimeout(next, 2000));
      try {
        const r = await fetch(`/api/printers/${machine.id}/feed.jpg`, { cache: "no-store" });
        if (!r.ok) throw Error();
        const blob = await r.blob();
        if (stop) return;
        const src = URL.createObjectURL(blob);
        urls.push(src);
        // Keep the frame on screen until its replacement has drawn, then let it go.
        if (urls.length > 2) URL.revokeObjectURL(urls.shift()!);
        setFrame({ src, at: Number(r.headers.get("X-Frame-At")) || Date.now() });
        setFailed(false);
        timer = window.setTimeout(next, 2000);
      } catch {
        if (stop) return;
        setFailed(true);
        timer = window.setTimeout(next, 8000);
      }
    };
    next();
    return () => {
      stop = true;
      clearTimeout(timer);
      setFrame(null);
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [online, visible, machine.id]);
  const fresh = frame && Date.now() - frame.at < 15000 && !failed;
  return (
    <span className="printer-feed" ref={box}>
      {online && frame ? (
        <img src={frame.src} alt={`Camera view of ${machine.name}`} />
      ) : (
        <span className="printer-feed-empty">
          {!live ? <Printer size={34} /> : online ? (failed ? <><VideoOff size={22} /> Camera unavailable</> : "Connecting to camera…") : <><VideoOff size={22} /> Offline</>}
        </span>
      )}
      {online && fresh && <span className="feed-live">Live</span>}
    </span>
  );
}

// One card per printer: its camera, state, job, progress and temperatures. Tap for details and controls.
export type RepeatStatus = { printer: string; name: string; done: number; times: number | null; status: string };
// "Paused at layer 76 of 78: a pause in the file, or…" as a short label for cards and rows.
export const shortPause = (m: Machine) => {
  const where = m.pauseReason?.match(/at layer \d+ of \d+/)?.[0];
  const why = !m.pauseReason ? "" : /a pause in the file/.test(m.pauseReason) ? "file pause" : "printer pause";
  return [where ? `Paused ${where}` : "Paused", why].filter(Boolean).join(" · ");
};
// What a printer is doing in one word, counting a pause Spoolside made itself.
export const stateLabel = (m: Machine, heldBySpoolside?: Set<string>) => (m.state === "Paused" && heldBySpoolside?.has(m.id) ? "Held by Spoolside" : m.state);

// The Overview's printers: one compact row each (small live view, state, job, progress, the spool feeding).
export function PrinterRows({ placeholder, machines, live, onOpen, heldBySpoolside, onAll }: { placeholder?: "loading" | "unavailable"; machines: Machine[]; live: boolean; onOpen: (id: string) => void; heldBySpoolside?: Set<string>; onAll: () => void }) {
  return (
    <section className="printer-rows-section" aria-label="Printers">
      <div className="section-title"><h2>Printers {!placeholder && <span className="count">{machines.length}</span>}</h2><button className="text-button" onClick={onAll}>All printers →</button></div>
      {placeholder ? <div className="printer-rows"><Skeleton rows={2} still={placeholder === "unavailable"} /></div> : machines.length === 0 ? <div className="printer-rows"><p className="queue-empty">No printers are connected yet.</p></div> : <div className="printer-rows">
        {machines.map((m) => {
          const label = stateLabel(m, heldBySpoolside), state = m.state.toLowerCase(), active = m.state === "Printing" || m.state === "Paused";
          const feeding = loadedSpools(m).find((x) => x.feeding) || (!m.hasAms ? loadedSpools(m)[0] : undefined);
          return (
            <button key={m.id} className={`printer-row ${state}`} onClick={() => onOpen(m.id)} aria-label={`${m.name}, ${label}`}>
              <CameraFeed machine={m} live={live} />
              <span className="printer-row-body">
                <span className="printer-row-top"><strong>{m.name}</strong><span className={`pill ${label === "Held by Spoolside" ? "red" : state === "paused" ? "blue" : state === "printing" ? "teal" : state === "error" || state === "offline" ? "red" : ""}`}>{label}</span></span>
                <span className="printer-row-job" title={m.job ? jobName(m.job) : undefined}>{m.job ? jobName(m.job) : "No print information"}{m.state === "Paused" && m.pauseReason ? ` · ${shortPause(m).replace(/^Paused /, "")}` : ""}</span>
                {active && <span className={`mini-progress${m.state === "Paused" ? " paused" : ""}`}><i style={{ width: `${m.progress}%` }} /></span>}
                <span className="printer-row-meta">{feeding && <><span className="sw" style={{ background: feeding.color || "transparent" }} />{feeding.type.replace(/-AMS$/i, "")} {feeding.key === "external" ? "external" : `slot ${feeding.label.replace(/\D/g, "")}`}</>}{active ? `${feeding ? " · " : ""}${m.remaining} left` : ""}{!m.connected || m.stale ? "Offline" : ""}</span>
              </span>
            </button>
          );
        })}
      </div>}
    </section>
  );
}

export function PrinterCards({ machines, total, placeholder, live, onOpen, repeats = [], heldBySpoolside }: { total?: number; placeholder?: "loading" | "unavailable"; machines: Machine[]; live: boolean; onOpen: (id: string) => void; repeats?: RepeatStatus[]; heldBySpoolside?: Set<string> }) {
  return (
    <section className="printer-cards" aria-label="Printers">
      {placeholder && <Skeleton rows={3} still={placeholder === "unavailable"} tall />}
      {machines.map((m) => {
        const state = m.state.toLowerCase(), active = m.state === "Printing" || m.state === "Paused";
        return (
          <button key={m.id} className={`printer-card ${state}`} onClick={() => onOpen(m.id)} aria-label={`${m.name}, ${m.state}`}>
            <CameraFeed machine={m} live={live} />
            <span className="printer-card-body">
              <span className="printer-card-top">
                <strong>{m.name}</strong>
                <span className={`status ${state}`}>
                  <span />
                  {stateLabel(m, heldBySpoolside)}
                </span>
              </span>
              <span className="printer-card-job" title={m.job ? jobName(m.job) : undefined}>{m.job ? jobName(m.job) : "No print information"}</span>
              {live && (!m.connected || m.stale) && m.error && <span className="printer-card-issue" role="note">{m.error}</span>}
              {live && m.connected && !m.stale && m.state === "Paused" && m.pauseReason && !heldBySpoolside?.has(m.id) && <span className="printer-card-issue paused" role="note" title={m.pauseReason}>{shortPause(m)}</span>}
              {repeats.filter((r) => r.printer === m.id).map((r) => (
                <span key={r.printer} className="printer-card-repeat" title={r.status}>
                  <Repeat size={13} /> <strong>Repeating</strong>{r.times ? ` ${r.done}/${r.times}` : r.done ? ` · ${r.done} so far` : ""} · {r.status}
                </span>
              ))}
              {active && (
                <>
                  <span className="mini-progress">
                    <i style={{ width: `${m.progress}%` }} />
                  </span>
                  <span className="printer-card-meta">{m.progress}% · {m.remaining} left</span>
                </>
              )}
              {live && <SpoolChips machine={m} />}
              <span className="printer-card-temps">
                <Thermometer size={14} /> {temp(m.nozzle)} nozzle · {temp(m.bed)} bed
              </span>
            </span>
          </button>
        );
      })}
      {!placeholder && machines.length === 0 && (
        <div className="empty centered">
          <p>{total === 0 ? "No printers are connected yet." : "No printers in this state."}</p>
        </div>
      )}
    </section>
  );
}
