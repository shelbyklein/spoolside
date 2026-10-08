import { useEffect, useMemo, useState } from "react";
import { Check, Play, Printer, X } from "lucide-react";
import type { Machine } from "./live-workspace";
import type { Order, PrintGroup } from "./order-model";
import { BedCheck, useLibrary } from "./PrintControls";

// Store colorway names to the color Spoolside looks for among the loaded spools.
const COLORWAYS: Record<string, string> = {
  red: "#e0201b", green: "#3baa35", blue: "#2f6fd6", black: "#111111", grey: "#8a8a8a", gray: "#8a8a8a", white: "#f2f2f2",
  orange: "#f07818", purple: "#7e3fb5", pink: "#f06eaa", yellow: "#f5d000", teal: "#0f8c8c",
};
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0);
const distance = (a: string, b: string) => rgb(a).reduce((n, v, i) => n + (v - rgb(b)[i]) ** 2, 0);
const FAR = 20000; // past this, the closest loaded spool isn't really the order's color
const idle = (m: Machine) => !!m.connected && !m.stale && ["IDLE", "FINISH", "FAILED"].includes(m.rawState || "");
export const colorwayOf = (order: Order) => order.items.find((i) => i.colorway)?.colorway || "";
const groupTitle = (g: PrintGroup) => `Print ${g.label}`;

const family = (t: string) => t.replace(/-AMS$/i, "").split(/[\s-]/)[0].toUpperCase();
const WRONG_MATERIAL = 1e6;
// The closest loaded AMS slot to a color, with how far off it is. A spool of another material
// (PLA when the plate is TPU) only counts if nothing else is loaded, and ranks far behind.
function closestTray(m: Machine, target: string, material = "") {
  const loaded = (m.trays || []).filter((t) => t.type && t.color);
  const off = (t: { type: string; color: string }) => distance(t.color, target) + (material && family(t.type) !== family(material) ? WRONG_MATERIAL : 0);
  return loaded.map((t) => ({ tray: t, off: off(t) })).sort((a, b) => a.off - b.off)[0] || null;
}

// The Print buttons on an order row: one per case and faceplate, with what's already printed.
export function OrderPrintButtons({ order, onPrint, onTick }: { order: Order; onPrint: (group: PrintGroup) => void; onTick: (assetId: string, done: number) => void }) {
  const plan = order.printPlan || [];
  if (!plan.length || order.commercial.toLowerCase() !== "processing") return null;
  return (
    <ul className="order-print-checklist" aria-label="Required prints">
      {plan.map(g => {
        const needed = g.pieces.reduce((n,p)=>n+p.needed,0), done = g.pieces.reduce((n,p)=>n+p.done,0);
        const label = g.label[0].toUpperCase()+g.label.slice(1);
        const tick = (checked: boolean) => {
          for (const id of new Set(g.pieces.map(p=>p.assetId))) {
            const current = plan.flatMap(x=>x.pieces).filter(p=>p.assetId===id).reduce((n,p)=>n+p.done,0);
            const change = g.pieces.filter(p=>p.assetId===id).reduce((n,p)=>n+(checked ? p.needed-p.done : -p.done),0);
            onTick(id,Math.max(0,current+change));
          }
        };
        return <li key={g.key} className={g.done ? "print-check-row printed" : "print-check-row"}>
          <label><input type="checkbox" aria-label={`${label} printed`} checked={g.done} disabled={!!g.activity} onChange={e=>tick(e.target.checked)} /><span>{label}</span></label>
          {g.done ? <small>Printed</small> : g.activity ? <small>{g.activity}</small> : <button className="order-print" disabled={!g.next} title={g.next ? `${g.next.name} · ${g.next.fileName}` : "No sliced plate linked yet"} aria-label={groupTitle(g)} onClick={()=>onPrint(g)}><Printer size={14} /> Print{needed>1 && <small>{done}/{needed}</small>}</button>}
        </li>;
      })}
    </ul>
  );
}

// Choose the printer and spool for one order piece, check the bed, and send it.
export function OrderPrintDialog({ order, group, machines, onClose, onSent, notify, printer: suggested }: { order: Order; group: PrintGroup; machines: Machine[]; onClose: () => void; onSent: () => void; notify: (m: string) => void; printer?: string }) {
  const next = group.next!;
  const { files } = useLibrary();
  const plate = files?.find((f) => f.id === next.fileId)?.plates.find((p) => p.index === next.plate);
  const colorway = colorwayOf(order), target = COLORWAYS[colorway.toLowerCase()] || "";
  const material = plate?.filaments[0]?.type || "";
  // Idle printers, best color match first.
  const ranked = useMemo(
    () => machines.filter(idle).map((m) => ({ m, best: target ? closestTray(m, target, material) : null })).sort((a, b) => (a.best?.off ?? Infinity) - (b.best?.off ?? Infinity)),
    [machines, target, material],
  );
  const [printerId, setPrinterId] = useState(suggested || "");
  // Pick the best printer once the plate's material is known, unless you've chosen one (or an offer did).
  const [picked, setPicked] = useState(!!suggested);
  useEffect(() => {
    if (!picked && ranked[0] && (plate || files)) setPrinterId(ranked[0].m.id);
  }, [ranked, plate, files]);
  const printer = machines.find((m) => m.id === printerId);
  const trays = (printer?.trays || []).filter((t) => t.type);
  const [mapping, setMapping] = useState<number[]>([]);
  const [level, setLevel] = useState(true), [clear, setClear] = useState(false), [sending, setSending] = useState(false);
  const useAms = trays.length > 0;
  // Every filament on the plate prints in the order's colorway: the closest loaded spool.
  useEffect(() => {
    if (!plate || !printer) return;
    const slots = Math.max(0, ...plate.filaments.map((f) => f.id));
    const pick = target ? closestTray(printer, target, material)?.tray.slot ?? -1 : -1;
    setMapping(Array.from({ length: slots }, () => pick));
  }, [plate, printerId]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && !sending && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [sending]);
  const match = printer && target ? closestTray(printer, target, material) : null;
  const send = async () => {
    setSending(true);
    try {
      const r = await fetch(`/api/orders/${order.id}/print`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group: group.key, printer: printerId, plate: `${next.fileId}:${next.plate}`, useAms, amsMapping: mapping, bedLevelling: level, bedClear: clear }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(body.error || "Couldn't start the print");
      notify(`Printing ${next.name} for ${order.number} on ${printer?.name}.`);
      onSent();
      onClose();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSending(false);
    }
  };
  const pieceNo = group.pieces.findIndex((p) => p.assetId === next.assetId) + 1;
  return (
    <div className="modal-backdrop" onClick={() => !sending && onClose()}>
      <div className="modal order-print-dialog" role="dialog" aria-modal="true" aria-label={`${groupTitle(group)} for ${order.number}`} onClick={(e) => e.stopPropagation()}>
        <div className="section-top">
          <h3>{groupTitle(group)} · {order.number}</h3>
          <button className="icon-button" aria-label="Close" disabled={sending} onClick={onClose}><X size={18} /></button>
        </div>
        <div className="order-print-piece">
          <img src={`/api/library/${next.fileId}/preview.png`} alt="" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
          <span>
            <strong>{next.name}</strong>
            <small>{group.pieces.length > 1 ? `Piece ${pieceNo} of ${group.pieces.length} · ` : ""}{next.fileName}</small>
            {colorway && <small><span className="color-dot" style={{ background: target || "#ccc" }} /> {colorway}</small>}
          </span>
        </div>
        {!ranked.length ? (
          <p className="plate-meta">No printer is free right now. Try again when one finishes.</p>
        ) : (
          <>
            <label>
              Printer
              <select value={printerId} onChange={(e) => { setPicked(true); setPrinterId(e.target.value); }}>
                {ranked.map(({ m, best }) => (
                  <option key={m.id} value={m.id}>{m.name}{best ? ` · slot ${best.tray.slot + 1}${best.off >= WRONG_MATERIAL ? ` (no ${family(material)} loaded)` : best.off > FAR ? " (no close color)" : ""}` : " · external spool"}</option>
                ))}
              </select>
            </label>
            {useAms && plate?.filaments.map((f) => (
              <label key={f.id} className="slot-row">
                <span>Spool for {f.type.replace(/-AMS$/i, "")} <span className="color-dot" style={{ background: trays.find((t) => t.slot === mapping[f.id - 1])?.color || "transparent" }} /></span>
                <select aria-label={`AMS slot for filament ${f.id}`} value={mapping[f.id - 1] ?? -1} onChange={(e) => setMapping(mapping.map((v, i) => (i === f.id - 1 ? Number(e.target.value) : v)))}>
                  <option value={-1} disabled>Choose slot</option>
                  {trays.map((t) => <option key={t.slot} value={t.slot}>Slot {t.slot + 1} · {t.type.replace(/-AMS$/i, "")}</option>)}
                </select>
              </label>
            ))}
            {!useAms && <p className="plate-meta">Prints from the external spool. Make sure it's {colorway || "the right color"}.</p>}
            {useAms && match && match.off >= WRONG_MATERIAL && <p className="order-print-warn">{printer?.name} has no {family(material)} loaded. This plate is sliced for {family(material)}.</p>}
            {useAms && match && match.off > FAR && match.off < WRONG_MATERIAL && <p className="order-print-warn">No spool close to {colorway} is loaded in {printer?.name}. Check the slot before printing.</p>}
            <label className="check-row"><input type="checkbox" checked={level} onChange={(e) => setLevel(e.target.checked)} /> Bed leveling</label>
            {printer && <BedCheck machine={printer} />}
            <label className="check-row"><input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} /> Build plate is clear</label>
            <button className="primary" disabled={!clear || sending || !plate || (useAms && mapping.some((m) => m < 0))} onClick={send}>
              <Play size={16} /> {sending ? "Sending to printer…" : `Start print on ${printer?.name || "printer"}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export type Offer = { id: string; printer: string; printerName: string; orderId: string; orderNumber: string; group: string; groupLabel: string; pieceName: string; colorway: string; slot: number; autoBlocked: string | null };
export type Held = { printer: string; printerName: string; reason: string };
type Dispatch = { auto: boolean; vision: boolean; offers: Offer[]; held?: Held[] };

// Free printers offered the next order piece, and the automatic printing setting.
export function useDispatch(enabled: boolean) {
  const [data, setData] = useState<Dispatch>({ auto: false, vision: false, offers: [] });
  const refresh = () =>
    fetch("/api/dispatch", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && Array.isArray(d.offers) && setData(d))
      .catch(() => {});
  useEffect(() => {
    if (!enabled) return;
    refresh();
    const timer = window.setInterval(refresh, 20000);
    return () => clearInterval(timer);
  }, [enabled]);
  const post = async (url: string, body?: unknown) => {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(d.error || "Couldn't save");
    setData(d);
  };
  return { ...data, refresh, dismiss: (printer: string) => post(`/api/dispatch/${printer}/dismiss`), setAuto: (on: boolean) => {
    // Show the change right away; the server's answer settles it.
    setData((d) => ({ ...d, auto: on }));
    return post("/api/dispatch/auto", { on }).catch((e) => { refresh(); throw e; });
  } };
}

// "AMS 3 is free: print the iPhone 12 Case for #10177?"
export function OfferCards({ offers, held = [], onPrint, onDismiss, water = false }: { offers: Offer[]; held?: Held[]; onPrint: (offer: Offer) => void; onDismiss: (offer: Offer) => void; water?: boolean }) {
  if (!offers.length && !held.length) return null;
  return (
    <div className={`watch-attention${water ? " on-water" : ""}`}>
      {held.map((h) => (
        <p key={h.printer} className="held-note">
          <strong>{h.printerName}</strong> could print the next order, but the camera says: {h.reason.replace(/\.$/, "")}. Clear the bed and it'll be offered within a few minutes.
        </p>
      ))}
      {offers.map((o) => (
        <article key={o.id} className="watch-card offer-card" aria-label={`${o.printerName} is free`}>
          <h3><Printer size={17} /> {o.printerName} is free</h3>
          <p>Print the <strong>{o.pieceName}</strong> for {o.orderNumber} · {o.colorway}, slot {o.slot + 1}</p>
          {o.autoBlocked && <p className="watch-job">Didn't start automatically: {o.autoBlocked}</p>}
          <div className="watch-actions">
            <button className="primary" onClick={() => onPrint(o)}><Play size={15} /> Print…</button>
            <button className="text-button" onClick={() => onDismiss(o)}>Not now</button>
          </div>
        </article>
      ))}
    </div>
  );
}

// Settings: let Spoolside start prints by itself.
export function AutoPrintSetting({ auto, vision, onChange }: { auto: boolean; vision: boolean; onChange: (on: boolean) => void }) {
  return (
    <section className="auto-print" aria-label="Automatic printing">
      <h2>Automatic printing</h2>
      <label className="check-row">
        <input type="checkbox" checked={auto} onChange={(e) => onChange(e.target.checked)} /> Start the next order piece on a free printer without asking
      </label>
      <p className="plate-meta">
        Only with a Bambu TPU for AMS spool close to the order's color loaded, and only after you've answered how that printer's last print went and a camera check sees an empty bed. Otherwise you get the usual prompt.
        {!vision && " Camera checks need the vision key, so nothing starts by itself until it's added."}
      </p>
    </section>
  );
}
