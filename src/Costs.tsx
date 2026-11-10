import { useEffect, useState } from "react";
import { money } from "./Supplies";

// What an assembly or order costs to make, from Spoolside's cost roll-up (server/costs.mjs).
type Use = { supply: string; grams: number; perGram: number };
type PartCost = { assetId?: string; name: string; quantity: number; kind?: "printed" | "bought"; unitCost?: number; cost: number | null; grams?: number; uses?: Use[]; supply?: string; delivered?: boolean; estimated?: boolean; print?: string; missing?: string };
export type AssemblyCost = { total: number; complete: boolean; estimated: boolean; missing: string[]; parts: PartCost[] };
type OrderLine = { label: string; quantity: number; unit?: number; cost: number | null; complete: boolean; missing?: string[] };
export type OrderCost = { total: number; complete: boolean; missing: string[]; lines: OrderLine[] };

// "$1.62", or "at least $1.62" when something couldn't be priced.
export const costLabel = (total: number, complete: boolean) => (complete ? money(total) : `at least ${money(total)}`);

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(b.error || "Cost unavailable");
  return b as T;
}

// Totals for every assembly, for the cards. Reloads when `key` changes (assemblies edited).
export function useAssemblyCosts(key: string) {
  const [costs, setCosts] = useState<Record<string, { total: number; complete: boolean }>>({});
  useEffect(() => { let live = true; get<Record<string, { total: number; complete: boolean }>>("/api/costs/assemblies").then((c) => live && c && typeof c === "object" && setCosts(c)).catch(() => {}); return () => { live = false; }; }, [key]);
  return costs;
}

const detail = (p: PartCost) => {
  if (p.missing) return p.missing.replace(`${p.name}: `, "");
  if (p.kind === "bought") return `${p.quantity} × ${money(p.unitCost || 0)}${p.supply ? ` · ${p.supply}` : ""}${p.delivered ? "" : " · before shipping"}`;
  const uses = (p.uses || []).map((u) => `${u.grams.toFixed(1)} g ${u.supply} × ${money(u.perGram, 3)}/g`).join(" + ");
  return `${p.quantity > 1 ? `${p.quantity} × ` : ""}${uses}${p.estimated ? " · estimated" : ""}`;
};

export function AssemblyCostPanel({ assemblyId, version }: { assemblyId: string; version: string }) {
  const [cost, setCost] = useState<AssemblyCost | null>(null), [error, setError] = useState("");
  useEffect(() => { let live = true; setError(""); get<AssemblyCost>(`/api/assemblies/${assemblyId}/cost`).then((c) => live && setCost(Array.isArray(c.parts) ? c : null)).catch((e) => live && setError(e.message)); return () => { live = false; }; }, [assemblyId, version]);
  if (error) return <section className="group-card assembly-cost" aria-label="Cost per unit"><h3>Cost per unit</h3><p className="plate-meta">{error}</p></section>;
  if (!cost) return null;
  return (
    <section className="group-card assembly-cost" aria-label="Cost per unit">
      <div className="cost-head"><h3>Cost per unit</h3><strong className={cost.complete ? "" : "incomplete"}>{costLabel(cost.total, cost.complete)}</strong></div>
      <ul className="cost-lines">
        {cost.parts.map((p) => (
          <li key={(p.assetId || p.name) + p.quantity} className={p.missing ? "missing" : ""}>
            <span className="cost-name">{p.name}{p.quantity > 1 ? ` ×${p.quantity}` : ""}</span>
            <span className="cost-detail">{detail(p)}</span>
            <span className="cost-amount">{p.cost === null ? "—" : money(p.cost)}</span>
          </li>
        ))}
      </ul>
      <p className="plate-meta">Printed parts: their share of the sliced plate's grams (split by part volume) × the filament's best price. Bought parts: quantity × price per piece. {cost.complete ? "" : "Parts without a sliced print, filament match or price are listed, not counted."}</p>
    </section>
  );
}

// Every order's estimated cost in one request, for order lists.
export function useOrderCosts(enabled: boolean, key: string) {
  const [costs, setCosts] = useState<Record<string, { total: number; complete: boolean }>>({});
  useEffect(() => { if (!enabled) return; let live = true; get<Record<string, { total: number; complete: boolean }>>("/api/costs/orders").then((c) => live && c && typeof c === "object" && setCosts(c)).catch(() => {}); return () => { live = false; }; }, [enabled, key]);
  return costs;
}

// An order's estimated cost button, and its breakdown (loaded when opened) shown across the order row.
export function OrderCostButton({ total, complete, open, onToggle }: { total: number; complete: boolean; open: boolean; onToggle: () => void }) {
  return <div className="order-cost"><button className="text-button" aria-expanded={open} onClick={onToggle}>Est. cost {costLabel(total, complete)}</button></div>;
}
export function OrderCostBreakdown({ orderId }: { orderId: string }) {
  const [cost, setCost] = useState<OrderCost | null>(null);
  useEffect(() => { let live = true; get<OrderCost>(`/api/orders/${encodeURIComponent(orderId)}/cost`).then((c) => live && setCost(Array.isArray(c.lines) ? c : null)).catch(() => {}); return () => { live = false; }; }, [orderId]);
  if (!cost) return <p className="plate-meta order-cost-breakdown">Working out the cost…</p>;
  return (
    <ul className="cost-lines order-cost-breakdown" aria-label="Estimated cost">
      {cost.lines.map((l, i) => <li key={i} className={l.cost === null ? "missing" : ""}><span className="cost-name">{l.label}{l.quantity > 1 ? ` ×${l.quantity}` : ""}</span><span className="cost-detail">{l.complete ? (l.unit !== undefined && l.quantity > 1 ? `${l.quantity} × ${money(l.unit)}` : "") : "not fully priced"}</span><span className="cost-amount">{l.cost === null ? "—" : money(l.cost)}</span></li>)}
      {cost.missing.map((m) => <li key={m} className="missing"><span className="cost-name">{m}</span></li>)}
      <li className="cost-total"><span className="cost-name">Total</span><span /><span className="cost-amount">{costLabel(cost.total, cost.complete)}</span></li>
    </ul>
  );
}
