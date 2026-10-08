import { useEffect, useRef, useState } from "react";
import { Printer, Thermometer, VideoOff } from "lucide-react";
import type { Machine } from "./live-workspace";
import { SpoolChips } from "./LoadedSpools";

const jobName = (job: string) => job.replace(/^spoolside_/, "").replace(/(\.gcode)?\.3mf$/i, "").replace(/_/g, " ");
const temp = (t?: number | null) => (t == null ? "—" : Math.round(t) + "°");

// The printer's camera, refreshed every 2 s (about the A1 mini's own frame rate) while the card is on screen.
function CameraFeed({ machine, live }: { machine: Machine; live: boolean }) {
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
export function PrinterCards({ machines, live, onOpen }: { machines: Machine[]; live: boolean; onOpen: (id: string) => void }) {
  return (
    <section className="printer-cards" aria-label="Printers">
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
                  {m.state}
                </span>
              </span>
              <span className="printer-card-job">{m.job ? jobName(m.job) : "No print information"}</span>
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
      {machines.length === 0 && (
        <div className="empty">
          <p>No printers in this state.</p>
        </div>
      )}
    </section>
  );
}
