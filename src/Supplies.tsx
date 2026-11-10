import { useEffect, useState } from "react";
import { ExternalLink, Package, Plus, Trash2 } from "lucide-react";
import type { Machine } from "./live-workspace";
import { FilamentManager } from "./FilamentManager";

// Supplies: everything bought to make a product. Filament keeps its restock view; parts (magnets,
// rubber bands) and packaging (boxes, bubble pouches) are priced per piece from offers added by hand.
export type SupplyOffer = { id: string; seller: string; label: string; url: string; price: number; quantity?: number; grams?: number; available: boolean | null; source: string; checked: string; stale: boolean; unitPrice: number; deliveredUnitPrice: number | null; shipping: number | null; deliverySource?: string | null };
export type Supply = { id: string; name: string; kind: "filament" | "part" | "packaging"; unit: "g" | "piece"; usage: string; url?: string; custom: boolean; offers: SupplyOffer[] };
export type SupplySettings = { zip: string; sort: string; filamentMap: Record<string, string>; packaging: { small: string | null; large: string | null; pouch: string | null }; pouchesPerOrder: number };
export type SupplyCatalog = { supplies: Supply[]; settings: SupplySettings };

export const money = (n: number, digits = 2) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, n < 1 ? 3 : 2) }).format(n);
export async function supplyApi(url: string, method = "GET", body?: unknown): Promise<SupplyCatalog> {
  const r = await fetch(url, { method, ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(b.error || "Could not save");
  return b;
}
const GROUPS = [["filament", "Filament"], ["part", "Parts"], ["packaging", "Packaging"]] as const;
const FILAMENT_TYPES = ["TPU-AMS", "TPU", "PLA", "PETG"];

export function Supplies({ notify, machines = [] }: { notify: (s: string) => void; machines?: Machine[] }) {
  const initial = new URLSearchParams(window.location.search).get("group");
  const [group, setGroup] = useState<"filament" | "part" | "packaging">(initial === "parts" ? "part" : initial === "packaging" ? "packaging" : "filament");
  const [catalog, setCatalog] = useState<SupplyCatalog | null>(null), [busy, setBusy] = useState(false);
  // Only a well-formed catalogue is shown; anything else leaves the filament view working on its own.
  const valid = (c: SupplyCatalog) => (Array.isArray(c?.supplies) && c.settings?.filamentMap ? c : null);
  const load = () => supplyApi("/api/supplies").then((c) => setCatalog(valid(c))).catch((e) => notify(e.message));
  useEffect(() => { load(); }, []);
  const save = async (url: string, method: string, body?: unknown) => {
    setBusy(true);
    try { setCatalog(valid(await supplyApi(url, method, body))); return true; } catch (e) { notify((e as Error).message); return false; } finally { setBusy(false); }
  };
  const pick = (g: typeof group) => { setGroup(g); const u = new URL(window.location.href); if (g === "filament") u.searchParams.delete("group"); else u.searchParams.set("group", g === "part" ? "parts" : "packaging"); history.replaceState(history.state, "", u); };
  return (
    <div className="supplies">
      <div className="segmented supply-groups" role="tablist" aria-label="Supply group">
        {GROUPS.map(([g, label]) => <button key={g} role="tab" aria-selected={group === g} className={group === g ? "selected" : ""} onClick={() => pick(g)}>{label}</button>)}
      </div>
      {group === "filament" && <>
        <FilamentManager notify={notify} machines={machines} />
        {catalog && <FilamentMap catalog={catalog} busy={busy} save={save} />}
      </>}
      {group !== "filament" && <PieceSupplies kind={group} catalog={catalog} busy={busy} save={save} />}
      {group === "packaging" && catalog && <PackagingRule catalog={catalog} busy={busy} save={save} />}
    </div>
  );
}

type Save = (url: string, method: string, body?: unknown) => Promise<boolean>;

function PieceSupplies({ kind, catalog, busy, save }: { kind: "part" | "packaging"; catalog: SupplyCatalog | null; busy: boolean; save: Save }) {
  const [adding, setAdding] = useState(false), [offerFor, setOfferFor] = useState("");
  const list = catalog?.supplies.filter((s) => s.kind === kind) || [];
  const noun = kind === "part" ? "part" : "packaging supply";
  return (
    <section className="piece-supplies" aria-label={kind === "part" ? "Bought parts" : "Packaging"}>
      <div className="material-toolbar"><p className="plate-meta supply-intro">{kind === "part" ? "Bought parts that go into a product, such as magnets and rubber bands. Priced per piece; add them to assemblies as bought parts." : "What each order ships in. Priced per piece; the box is chosen from what's in the order."}</p>
        <button className="secondary" disabled={busy} onClick={() => setAdding(!adding)}><Plus size={16} /> Add {noun}</button></div>
      {adding && (
        <form className="panel material-card material-form" aria-label={`Add ${noun}`} onSubmit={async (e) => { e.preventDefault(); const d = new FormData(e.currentTarget); if (await save("/api/supplies", "POST", { name: d.get("name"), kind, url: d.get("url") || "", usage: d.get("usage") || "" })) setAdding(false); }}>
          <h4>Add {noun}</h4>
          <label>Name<input required name="name" maxLength={80} placeholder={kind === "part" ? "Magnets, 3 × 2 mm" : "Box, 8 × 4 × 1″"} /></label>
          <label>Used for<input name="usage" maxLength={200} placeholder={kind === "part" ? "24 per case, 12 per faceplate top" : "Orders with a case only"} /></label>
          <label>Product link<input name="url" type="url" placeholder="https://" /></label>
          <div className="form-actions"><button className="primary" disabled={busy}>Add</button><button type="button" className="text-button" onClick={() => setAdding(false)}>Cancel</button></div>
        </form>
      )}
      {catalog && !list.length && !adding && <div className="empty"><p>No {kind === "part" ? "bought parts" : "packaging"} yet.</p></div>}
      <div className="material-cards">
        {list.map((s) => {
          const best = s.offers.find((o) => o.available !== false);
          return (
            <section className="panel material-card piece-supply" key={s.id} aria-label={s.name}>
              <div className="section-top"><div><h3>{s.name}</h3>
                <label className="material-usage">Used for<input aria-label={`Usage for ${s.name}`} defaultValue={s.usage} placeholder="Where it's used" onBlur={(e) => { if (e.target.value !== s.usage) save("/api/supplies/" + s.id, "PATCH", { usage: e.target.value }); }} /></label></div>
                <div className="supply-best">{best ? <><strong>{money(best.deliveredUnitPrice ?? best.unitPrice)}</strong><small>per piece{best.deliveredUnitPrice === null ? " before shipping" : " delivered"}</small></> : <small>No price yet</small>}</div>
              </div>
              <div className="restock-heading"><h4>Offers</h4>{s.url && <a className="text-button" href={s.url} target="_blank" rel="noreferrer">Product page</a>}<button className="text-button" onClick={() => setOfferFor(offerFor === s.id ? "" : s.id)}>Add offer</button></div>
              <div className="material-offers">
                {s.offers.map((o) => (
                  <article className="material-offer piece-offer" key={o.id}>
                    <span className="offer-thumbnail"><Package size={22} aria-hidden /></span>
                    <div className="offer-info"><strong>{o.seller}</strong><small>{o.label}</small><span className="offer-stock">{o.stale ? "Price not confirmed in 7 days" : o.available === true ? "In stock" : o.available === false ? "Unavailable" : "Stock unknown"}</span></div>
                    <div className="offer-price"><strong>{money(o.price)} for {o.quantity}</strong><small>{money(o.unitPrice)} per piece</small></div>
                    <div className="offer-delivery"><small>Checked {new Date(o.checked).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</small>
                      <button className="text-button" onClick={() => save("/api/supply-offers", "PATCH", { id: o.id, reconfirm: true })}>Confirm price / stock</button></div>
                    <div className="offer-actions"><a className="secondary offer-buy" href={o.url} target="_blank" rel="noreferrer">Buy <ExternalLink size={14} /></a>
                      <button className="icon-button" aria-label={`Remove offer ${o.label}`} onClick={() => save("/api/supply-offers/" + o.id, "DELETE")}><Trash2 size={15} /></button></div>
                  </article>
                ))}
                {!s.offers.length && <p className="plate-meta">No offers yet. Add the price you pay and how many pieces it buys.</p>}
              </div>
              {offerFor === s.id && (
                <form className="material-form" aria-label={`Add offer for ${s.name}`} onSubmit={async (e) => { e.preventDefault(); const d = new FormData(e.currentTarget); if (await save("/api/supply-offers", "POST", { supplyId: s.id, seller: d.get("seller"), label: d.get("label"), url: d.get("url"), price: Number(d.get("price")), quantity: Number(d.get("quantity")), available: d.get("available") === "on" })) setOfferFor(""); }}>
                  <h4>Add offer</h4>
                  <label>Seller<input required name="seller" maxLength={80} defaultValue="Amazon" /></label>
                  <label>Description<input required name="label" maxLength={150} placeholder="200 pcs, 3 mm × 2 mm" /></label>
                  <label>Product link<input required name="url" type="url" defaultValue={s.url || ""} /></label>
                  <label>Price (USD)<input required name="price" type="number" min={0.01} step="0.01" /></label>
                  <label>Pieces it buys<input required name="quantity" type="number" min={1} step="1" /></label>
                  <label className="check-row"><input name="available" type="checkbox" defaultChecked /> In stock</label>
                  <div className="form-actions"><button className="primary" disabled={busy}>Save offer</button><button type="button" className="text-button" onClick={() => setOfferFor("")}>Cancel</button></div>
                </form>
              )}
              {s.custom && <button className="text-button danger remove-supply" disabled={busy} onClick={() => { if (confirm(`Remove ${s.name} and its offers?`)) save("/api/supplies/" + s.id, "DELETE"); }}>Remove {noun}</button>}
            </section>
          );
        })}
      </div>
    </section>
  );
}

// Which filament supply a sliced plate's filament type is priced as (a print can override it).
function FilamentMap({ catalog, busy, save }: { catalog: SupplyCatalog; busy: boolean; save: Save }) {
  const filaments = catalog.supplies.filter((s) => s.kind === "filament"), map = catalog.settings.filamentMap;
  const types = [...new Set([...FILAMENT_TYPES, ...Object.keys(map)])];
  return (
    <section className="panel material-card costing-settings" aria-label="Filament for costing">
      <h3>Filament for costing</h3>
      <p className="plate-meta">Sliced prints name a filament type. Pick the filament each type is priced as; a print can choose differently (Library → Sliced prints).</p>
      <div className="costing-rows">
        {types.map((t) => (
          <label key={t}>{t}<select aria-label={`Filament for ${t}`} disabled={busy} value={map[t] || ""} onChange={(e) => save("/api/supplies/settings", "PATCH", { filamentMap: { ...map, [t]: e.target.value || null } })}>
            <option value="">Not set</option>{filaments.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select></label>
        ))}
      </div>
    </section>
  );
}

// The box and bubble pouches an order is costed with.
function PackagingRule({ catalog, busy, save }: { catalog: SupplyCatalog; busy: boolean; save: Save }) {
  const packs = catalog.supplies.filter((s) => s.kind === "packaging"), p = catalog.settings.packaging;
  const choose = (key: "small" | "large" | "pouch", label: string) => (
    <label>{label}<select aria-label={label} disabled={busy} value={p[key] || ""} onChange={(e) => save("/api/supplies/settings", "PATCH", { packaging: { [key]: e.target.value || null } })}>
      <option value="">Not set</option>{packs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select></label>
  );
  return (
    <section className="panel material-card costing-settings" aria-label="Packaging per order">
      <h3>Packaging per order</h3>
      <p className="plate-meta">An order with a single case and nothing else ships in the small box; anything more ships in the large box.</p>
      <div className="costing-rows">
        {choose("small", "Box for a case on its own")}
        {choose("large", "Box for everything else")}
        {choose("pouch", "Bubble pouch")}
        <label>Bubble pouches per order<input aria-label="Bubble pouches per order" type="number" min={0} max={20} defaultValue={catalog.settings.pouchesPerOrder} key={catalog.settings.pouchesPerOrder} onBlur={(e) => { const n = Number(e.target.value); if (n !== catalog.settings.pouchesPerOrder) save("/api/supplies/settings", "PATCH", { pouchesPerOrder: n }); }} /></label>
      </div>
    </section>
  );
}
