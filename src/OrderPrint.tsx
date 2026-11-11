import { useEffect, useMemo, useState } from "react";
import { Check, Play, Printer, X } from "lucide-react";
import type { Machine } from "./live-workspace";
import type { Order, PrintGroup } from "./order-model";
import { BedHeld, useLibrary } from "./PrintControls";
import type { BedWarning } from "./BedCheck";
import { NeedIcon, NeedPhoto, NeedRow } from "./NeedsYou";

// Shared with the server's print offers, so both agree on which spool is the order's color.
import { COLORWAYS, colorwayName, deltaE, matchesColorway } from "../server/colorway.mjs";
const idle = (m: Machine) => !!m.connected && !m.stale && ["IDLE", "FINISH", "FAILED"].includes(m.rawState || "");
export const colorwayOf = (order: Order) => order.items.find((i) => i.colorway)?.colorway || "";
const groupTitle = (g: PrintGroup) => `Print ${g.label}`;

const family = (t: string) => t.replace(/-AMS$/i, "").split(/[\s-]/)[0].toUpperCase();
const WRONG_MATERIAL = 1e6;
const WRONG_COLOR = 1e3; // more than any real colour difference
// The best loaded AMS slot for an order's colorway, with how far off it is. A spool that doesn't read as the
// colorway (grey for a green order) ranks behind every one that does; a spool of another material (PLA when
// the plate is TPU) ranks behind everything.
function closestTray(m: Machine, colorway: string, material = "") {
  const target = COLORWAYS[colorwayName(colorway)];
  const loaded = (m.trays || []).filter((t) => t.type && t.color);
  const off = (t: { type: string; color: string }) => (matchesColorway(t.color, colorway) ? 0 : WRONG_COLOR) + deltaE(t.color, target) + (material && family(t.type) !== family(material) ? WRONG_MATERIAL : 0);
  return loaded.map((t) => ({ tray: t, off: off(t) })).sort((a, b) => a.off - b.off)[0] || null;
}

// The Print buttons on an order row: one per case and faceplate, with what's already printed.
export function OrderPrintButtons({ order, onPrint, onTick }: { order: Order; onPrint: (group: PrintGroup) => void; onTick: (assetId: string, done: number) => void }) {
  const plan = order.printPlan || [];
  if (!plan.length || order.commercial.toLowerCase() !== "processing") return null;
  return (
    <ul className="order-print-checklist" aria-label="Required prints">
      {plan.map(g => {
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
          {g.done ? <small>Printed</small> : g.activity ? <small>{g.activity}</small> : <button className="order-print" disabled={!g.next} title={g.next ? `${g.next.name} · ${g.next.fileName}` : "No sliced plate linked yet"} aria-label={groupTitle(g)} onClick={()=>onPrint(g)}><Printer size={14} /> Print</button>}
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
  const colorway = colorwayOf(order), target = COLORWAYS[colorwayName(colorway)] || "";
  const material = plate?.filaments[0]?.type || "";
  // Idle printers, best color match first.
  const ranked = useMemo(
    () => machines.filter(idle).map((m) => ({ m, best: target ? closestTray(m, colorway, material) : null })).sort((a, b) => (a.best?.off ?? Infinity) - (b.best?.off ?? Infinity)),
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
  const [level, setLevel] = useState(true), [held, setHeld] = useState<string | null>(null), [sending, setSending] = useState(false);
  const useAms = trays.length > 0;
  // Every filament on the plate prints in the order's colorway: the closest loaded spool.
  useEffect(() => {
    if (!plate || !printer) return;
    const slots = Math.max(0, ...plate.filaments.map((f) => f.id));
    const pick = target ? closestTray(printer, colorway, material)?.tray.slot ?? -1 : -1;
    setMapping(Array.from({ length: slots }, () => pick));
  }, [plate, printerId]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && !sending && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [sending]);
  const match = printer && target ? closestTray(printer, colorway, material) : null;
  const send = async (anyway = false) => {
    setSending(true);
    setHeld(null);
    try {
      const r = await fetch(`/api/orders/${order.id}/print`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group: group.key, printer: printerId, plate: `${next.fileId}:${next.plate}`, useAms, amsMapping: mapping, bedLevelling: level, bedClear: anyway }),
      });
      const body = await r.json().catch(() => ({}));
      if (body.bed) return setHeld(body.error);
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
            <small>{next.fileName}</small>
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
                  <option key={m.id} value={m.id}>{m.name}{best ? ` · slot ${best.tray.slot + 1}${best.off >= WRONG_MATERIAL ? ` (no ${family(material)} loaded)` : best.off >= WRONG_COLOR ? ` (no ${colorway.toLowerCase()} loaded)` : ""}` : " · external spool"}</option>
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
            {useAms && match && match.off >= WRONG_COLOR && match.off < WRONG_MATERIAL && <p className="order-print-warn">No {colorway.toLowerCase()} spool is loaded in {printer?.name}. Check the slot before printing.</p>}
            <label className="check-row"><input type="checkbox" checked={level} onChange={(e) => setLevel(e.target.checked)} /> Bed leveling</label>
            <button className="primary" disabled={sending || !plate || (useAms && mapping.some((m) => m < 0))} onClick={() => send()}>
              <Play size={16} /> {sending ? "Checking the bed…" : `Start print on ${printer?.name || "printer"}`}
            </button>
            {held && <BedHeld reason={held} busy={sending} onAnyway={() => send(true)} />}
          </>
        )}
      </div>
    </div>
  );
}

export type Offer = { id: string; printer: string; printerName: string; orderId: string; orderNumber: string; group: string; groupLabel: string; pieceName: string; colorway: string; slot: number; autoBlocked: string | null };
export type Held = { printer: string; printerName: string; reason: string };
type Dispatch = { auto: boolean; vision: boolean; offers: Offer[]; held?: Held[]; warnings?: BedWarning[]; available?: {orderId: string; printer: string; printerName: string}[] };

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
  const post = async (url: string, body?: unknown): Promise<Dispatch> => {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
    const d = await r.json().catch(() => null);
    if (!d) throw Error("Spoolside didn't answer. Try again.");
    if (!r.ok) throw Error(d.error || "Couldn't save");
    setData(d);
    return d;
  };
  return { ...data, refresh, dismiss: (printer: string) => post(`/api/dispatch/${printer}/dismiss`), recheck: (printer: string) => post(`/api/dispatch/${printer}/recheck`), setAuto: (on: boolean) => {
    // Show the change right away; the server's answer settles it.
    setData((d) => ({ ...d, auto: on }));
    return post("/api/dispatch/auto", { on }).catch((e) => { refresh(); throw e; });
  } };
}

// "AMS 3 is free: print the iPhone 12 Case for #10177?"
// A free printer the camera won't hand the next order to: what it sees, with a photo, and the two answers.
// "Bed cleared" looks again now; "Teach empty bed" is for when the camera is wrong about this printer.
function HeldRow({ held, onRecheck, onTeach }: { held: Held; onRecheck?: (printer: string, name: string) => Promise<void>; onTeach?: (printer: string, name: string) => void }) {
  const [checking, setChecking] = useState(false);
  const [stamp, setStamp] = useState(Date.now());
  useEffect(() => setStamp(Date.now()), [held.reason]);
  return (
    <NeedRow tone="wait" label={`${held.printerName} is waiting on its bed`} title={`${held.printerName} is waiting on its bed`}
      media={<NeedPhoto src={`/api/printers/${held.printer}/feed.jpg?t=${stamp}`} alt={`${held.printerName}'s bed now`} />}
      actions={<>
        {onTeach && <button className="secondary" disabled={checking} onClick={() => onTeach(held.printer, held.printerName)}>Teach empty bed</button>}
        {onRecheck && <button className="primary" disabled={checking} onClick={async () => { setChecking(true); try { await onRecheck(held.printer, held.printerName); } finally { setChecking(false); setStamp(Date.now()); } }}><Check size={14} /> {checking ? "Checking…" : "Bed cleared"}</button>}
      </>}>
      The camera sees: {held.reason}
    </NeedRow>
  );
}

// Held beds and "AMS 3 is free: print the iPhone 12 Case for #10177?", as rows in the Needs you list.
export function OfferCards({ offers, held = [], onPrint, onDismiss, onTeach, onRecheck }: { offers: Offer[]; held?: Held[]; onPrint: (offer: Offer) => void; onDismiss: (offer: Offer) => void; onTeach?: (printer:string,name:string)=>void; onRecheck?: (printer: string, name: string) => Promise<void> }) {
  return (
    <>
      {held.map((h) => <HeldRow key={h.printer} held={h} onRecheck={onRecheck} onTeach={onTeach} />)}
      {offers.map((o) => (
        <NeedRow key={o.id} tone="ok" label={`${o.printerName} is free`} title={`${o.printerName} is free`} media={<NeedIcon tone="ok"><Printer size={18} /></NeedIcon>}
          actions={<><button className="secondary" onClick={() => onDismiss(o)}>Not now</button><button className="primary" onClick={() => onPrint(o)}><Play size={14} /> Print…</button></>}>
          Print the <b>{o.pieceName}</b> for {o.orderNumber} · {o.colorway}, slot {o.slot + 1}
          {o.autoBlocked && <span className="need-note">Didn't start automatically: {o.autoBlocked}</span>}
        </NeedRow>
      ))}
    </>
  );
}

// Settings: let Spoolside start prints by itself.
export function AutoPrintSetting({ auto, vision, onChange }: { auto: boolean; vision: boolean; onChange: (on: boolean) => void }) {
  return (
    <section className="auto-print" aria-label="Automatic printing">
      <h2>Automatic printing</h2>
      <label className="check-row">
        <input type="checkbox" checked={auto} onChange={(e) => onChange(e.target.checked)} /> Print the next thing in the queue on a free printer without asking
      </label>
      <p className="plate-meta">
        Only with a Bambu TPU for AMS spool close to the order's color loaded, and only when a camera check sees an empty bed. Otherwise you get the usual prompt.
        {!vision && " Camera checks need the vision key, so nothing starts by itself until it's added."}
      </p>
    </section>
  );
}

// The same setting as a switch on the Print queue.
export function AutoPrintSwitch({ auto, vision, onChange }: { auto: boolean; vision: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="auto-switch" title="Starts the next queued piece when a printer is free, the right filament is loaded, and the camera sees an empty bed">
      <input type="checkbox" role="switch" aria-label="Auto-print next in queue" checked={auto} disabled={!vision} onChange={(e) => onChange(e.target.checked)} />
      <span className="auto-switch-track" aria-hidden="true"><span /></span>
      <span>Auto-print next{!vision && " (needs vision key)"}</span>
    </label>
  );
}
