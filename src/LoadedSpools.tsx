import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Machine } from "./live-workspace";
import { usePhone } from "./usePhone";

type Spool = { key: string; label: string; type: string; name: string; color: string; remain?: number | null; feeding: boolean; empty: boolean };
const short = (type: string) => type.replace(/-AMS$/i, "");

// What's loaded: the AMS slots, plus the external spool when there's no AMS or it's the one feeding.
export function loadedSpools(m: Machine): Spool[] {
  // An offline printer reports nothing, so there's nothing to show.
  if (!m.connected || m.stale) return [];
  const spools: Spool[] = (m.trays || []).map((t) => ({
    key: `slot-${t.slot}`,
    label: `Slot ${t.slot + 1}`,
    type: t.type,
    name: t.name || t.type,
    color: t.color,
    remain: t.remain,
    feeding: m.feeding === t.slot,
    empty: !t.type,
  }));
  if (!m.hasAms || m.feeding === 254)
    spools.push({ key: "external", label: "External", type: m.external?.type || "", name: m.external?.name || m.external?.type || "", color: m.external?.color || "", feeding: m.feeding === 254, empty: !m.external?.type });
  return spools;
}

const Dot = ({ color }: { color: string }) => <span className={`color-dot${color ? "" : " unset"}`} style={color ? { background: color } : undefined} />;

// Compact chips for a printer card.
export function SpoolChips({ machine }: { machine: Machine }) {
  const spools = loadedSpools(machine);
  if (!spools.length) return null;
  return (
    <span className="spool-chips" aria-label="Loaded spools">
      {spools.map((s) => (
        <span key={s.key} className={`spool-chip${s.feeding ? " feeding" : ""}${s.empty ? " empty" : ""}`} title={s.empty ? `${s.label}: ${s.key === "external" ? "not set in the printer" : "empty"}` : `${s.label}: ${s.name}${s.remain != null ? ` · ${s.remain}% left` : ""}${s.feeding ? " · feeding" : ""}`}>
          <Dot color={s.color} />
          {s.empty ? (s.key === "external" ? "Not set" : "Empty") : short(s.type)}
        </span>
      ))}
    </span>
  );
}

// One line per spool for the printer details.
export function SpoolList({ machine }: { machine: Machine }) {
  const spools = loadedSpools(machine);
  if (!spools.length) return <>{machine.connected && !machine.stale ? "No spool information" : "Printer offline"}</>;
  return (
    <ul className="spool-list">
      {spools.map((s) => (
        <li key={s.key}>
          <Dot color={s.color} />
          <span className="spool-list-name">
            {s.empty ? (s.key === "external" ? "Not set in the printer" : "Empty") : s.name}
            <small>{s.label}{s.feeding ? " · feeding" : ""}</small>
          </span>
          {s.remain != null && <span className="spool-remain">{s.remain}%</span>}
        </li>
      ))}
    </ul>
  );
}

const grams = (n: number) => `≈ ${n.toLocaleString()} g`;
const LOW = 15; // percent left at which a spool counts as running low

// Filament page: every spool loaded in a printer, kept current by the AMS (RFID spools report what's left).
export function LoadedInPrinters({ machines }: { machines: Machine[] }) {
  const phone = usePhone();
  // Each printer's spools fold to one line; collapsed by default on a phone, open on a wider screen.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const printers = machines.map((m) => ({ m, spools: loadedSpools(m) })).filter((p) => p.spools.length || !p.m.connected);
  if (!printers.length) return null;
  return (
    <section className="panel loaded-printers" aria-label="Spools in your printers">
      <div className="section-top">
        <h2>In your printers</h2>
        <small>Updated live from each printer. Bambu RFID spools report what's left.</small>
      </div>
      <div className="loaded-grid">
        {printers.map(({ m, spools }) => {
          const offline = !m.connected || m.stale;
          const open = (toggled[m.id] ?? !phone) && !offline;
          const loaded = spools.filter((s) => !s.empty), feeding = spools.filter((s) => s.feeding).length;
          const materials = [...new Set(loaded.map((s) => short(s.type)))];
          return (
          <div key={m.id} className="loaded-printer">
            {offline ? (
              <><h3>{m.name}</h3><p className="plate-meta">Offline</p></>
            ) : (
              <>
              <h3><button type="button" className="loaded-summary" aria-expanded={open} aria-controls={`spools-${m.id}`} onClick={() => setToggled({ ...toggled, [m.id]: !open })}>
                <ChevronDown size={16} aria-hidden="true" />
                <span className="loaded-summary-name">{m.name}</span>
                <span className="loaded-dots" aria-hidden="true">{spools.map((s) => <Dot key={s.key} color={s.color} />)}</span>
                <small>{loaded.length} {loaded.length === 1 ? "spool" : "spools"}{materials.length ? ` · ${materials.join(", ")}` : ""}{feeding ? ` · ${feeding} feeding` : ""}</small>
              </button></h3>
              {open && <ul className="spool-list" id={`spools-${m.id}`}>
                {spools.map((s) => {
                  const tray = m.trays?.find((t) => `slot-${t.slot}` === s.key);
                  const low = s.remain != null && s.remain < LOW;
                  return (
                    <li key={s.key} className={low ? "low" : undefined}>
                      <Dot color={s.color} />
                      <span className="spool-list-name">
                        {s.empty ? (s.key === "external" ? "Not set in the printer" : "Empty") : s.name}
                        <small>
                          {s.label}
                          {s.feeding ? " · feeding" : ""}
                          {low ? " · running low" : ""}
                        </small>
                      </span>
                      {tray?.grams != null ? <span className="spool-remain">{grams(tray.grams)}</span> : s.remain != null ? <span className="spool-remain">{s.remain}%</span> : null}
                    </li>
                  );
                })}
              </ul>}
              </>
            )}
          </div>
          );
        })}
      </div>
    </section>
  );
}

// Filament page, per material: how much of it is loaded right now.
export function LoadedMaterial({ machines, materialId }: { machines: Machine[]; materialId: string }) {
  const spools = machines.flatMap((m) => (m.connected && !m.stale ? (m.trays || []).filter((t) => t.materialId === materialId) : []));
  if (!spools.length) return <p className="loaded-material">None loaded in a printer.</p>;
  const total = spools.reduce((n, t) => n + (t.grams || 0), 0);
  return (
    <p className="loaded-material">
      <span className="loaded-dots">{spools.map((t, i) => <Dot key={i} color={t.color} />)}</span>
      Loaded now: {spools.length} {spools.length === 1 ? "spool" : "spools"}
      {total > 0 && ` · ${grams(total)}`}
    </p>
  );
}

// The printer details' spools: one tile per slot, the one feeding outlined.
export function SpoolTiles({ machine }: { machine: Machine }) {
  const spools = loadedSpools(machine);
  if (!spools.length) return <p className="plate-meta">{machine.connected && !machine.stale ? "No spool information" : "Printer offline"}</p>;
  return (
    <ul className="spool-tiles" aria-label="Loaded spools">
      {spools.map((s) => (
        <li key={s.key} className={`${s.feeding ? "feeding" : ""}${s.empty ? " empty" : ""}`}>
          <b><Dot color={s.color} /> {s.empty ? "Empty" : short(s.type)}</b>
          <small>{s.label}{s.feeding ? " · feeding" : s.remain != null && !s.empty ? ` · ${s.remain}%` : ""}</small>
        </li>
      ))}
    </ul>
  );
}
