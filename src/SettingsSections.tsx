import { useEffect, useState } from "react";
import { Camera, Sparkles } from "lucide-react";
import type { Machine } from "./live-workspace";

type BedSettings = { visibleOnly: boolean; allow: { id: string }[]; reference: { taught: number; area: boolean } | null };

// Settings → Printers: each printer's bed check at a glance, and the way into its details to tune it.
export function PrinterSettings({ machines, onOpen }: { machines: Machine[]; onOpen: (id: string) => void }) {
  const [beds, setBeds] = useState<Record<string, BedSettings>>({});
  useEffect(() => {
    for (const m of machines) fetch(`/api/dispatch/${m.id}/bed-settings`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => d && Array.isArray(d.allow) && setBeds((b) => ({ ...b, [m.id]: d }))).catch(() => {});
  }, [machines.map((m) => m.id).join()]);
  return (
    <section className="settings-printers" aria-label="Printer settings">
      <h2>Printers</h2>
      <p>Bed checks look at each printer's plate before Spoolside starts a print by itself. Teach each one its empty bed.</p>
      <ul>
        {machines.map((m) => {
          const b = beds[m.id];
          return (
            <li key={m.id}>
              <Camera size={16} />
              <span><strong>{m.name}</strong><small>{!b ? "…" : b.reference ? `Empty bed taught ${new Date(b.reference.taught).toLocaleDateString([], { month: "short", day: "numeric" })}${b.reference.area ? " · plate outlined" : ""}` : "Empty bed not taught yet"}{b ? ` · ${b.visibleOnly ? "goes by what's visible" : "needs the whole plate"}${b.allow.length ? ` · ${b.allow.length} ${b.allow.length === 1 ? "note" : "notes"}` : ""}` : ""}</small></span>
              <button className="text-button" onClick={() => onOpen(m.id)}>Bed check →</button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Settings → Claude: whether the chat is connected to the Claude subscription.
export function ClaudeSettings() {
  const [state, setState] = useState<{ available: boolean; reason: string | null } | null>(null);
  useEffect(() => { fetch("/api/chat", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => d && typeof d.available === "boolean" && setState(d)).catch(() => {}); }, []);
  return (
    <section className="settings-claude" aria-label="Claude">
      <h2>Claude</h2>
      <p className="settings-status"><Sparkles size={16} /> {!state ? "Checking…" : state.available ? "Connected to your Claude subscription. Open Claude from the header on any page." : state.reason}</p>
    </section>
  );
}
