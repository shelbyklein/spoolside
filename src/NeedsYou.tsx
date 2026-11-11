import React, { useState } from "react";
import { Pause, Play } from "lucide-react";
import type { Machine } from "./live-workspace";
import { failure, type Notify } from "./Toast";
import { confirmAction } from "./Confirm";

// Everything that needs you, in one list with one row shape: a coloured edge for how urgent, a photo or icon,
// what happened, and the actions on the right (below it, on a phone).
export type Tone = "warn" | "wait" | "alert" | "info" | "ok";
export function NeedRow({ tone, media, title, label, children, actions, id }: { tone: Tone; media: React.ReactNode; title: React.ReactNode; label: string; children?: React.ReactNode; actions?: React.ReactNode; id?: string }) {
  return (
    <article id={id} className={`need-row ${tone}`} aria-label={label}>
      <div className="need-media">{media}</div>
      <div className="need-text"><strong>{title}</strong>{children && <div className="need-sub">{children}</div>}</div>
      {actions && <div className="need-actions">{actions}</div>}
    </article>
  );
}
export const NeedIcon = ({ tone, children }: { tone: Tone; children: React.ReactNode }) => <span className={`need-icon ${tone}`}>{children}</span>;
export const NeedPhoto = ({ src, alt }: { src: string; alt: string }) => <img className="need-photo" src={src} alt={alt} loading="lazy" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />;

export function NeedsYou({ count, children, water = false }: { count: number; children: React.ReactNode; water?: boolean }) {
  if (!count) return null;
  return (
    <section className={`needs-you${water ? " on-water" : ""}`} aria-label="Needs you">
      <h2>Needs you <span className="count">{count}</span></h2>
      <div className="needs-list">{children}</div>
    </section>
  );
}

// Printers waiting at a pause they made themselves (a pause in the file, a runout, the screen): one row, since
// they usually pause together for inserts, with resume for each or all.
export const pausedByPrinter = (machines: Machine[], heldBySpoolside: Set<string>) => machines.filter((m) => m.connected && !m.stale && m.rawState === "PAUSE" && !heldBySpoolside.has(m.id));
export function PausedRow({ machines, notify, refresh }: { machines: Machine[]; notify: Notify; refresh: () => void }) {
  const [busy, setBusy] = useState(false);
  if (!machines.length) return null;
  const resume = async (list: Machine[]): Promise<void> => {
    if (list.length > 1 && !(await confirmAction({ title: `Resume ${list.map((m) => m.name).join(", ")}?`, body: "Make sure each one is ready.", confirmLabel: "Resume all" }))) return;
    setBusy(true);
    const failed: string[] = [];
    for (const m of list) {
      const r = await fetch(`/api/printers/${m.id}/resume`, { method: "POST" }).catch(() => null);
      if (!r?.ok) failed.push(m.name);
    }
    setBusy(false);
    if (failed.length) notify(`Couldn't resume ${failed.join(", ")}.`, failure(() => resume(list.filter((m) => failed.includes(m.name)))));
    else notify(`Resumed ${list.map((m) => m.name).join(", ")}.`);
    refresh();
  };
  const one = machines.length === 1 ? machines[0] : null;
  const layer = (m: Machine) => (m.layer != null && m.totalLayers ? `layer ${m.layer} of ${m.totalLayers}` : `${m.progress}%`);
  return (
    <NeedRow tone="info" label={one ? `${one.name} is paused` : `${machines.length} printers are paused`} media={<NeedIcon tone="info"><Pause size={18} /></NeedIcon>}
      title={one ? `${one.name} is paused at ${layer(one)}` : `${machines.length} printers are paused`}
      actions={<button className="primary" disabled={busy} onClick={() => resume(machines)}><Play size={14} /> {one ? "Resume" : "Resume all…"}</button>}>
      {one ? (one.pauseReason?.replace(/^Paused( at layer \d+ of \d+)?: /, "") || "Resume when it's ready.") : machines.map((m) => `${m.name} (${layer(m)})`).join(" · ")}
    </NeedRow>
  );
}
