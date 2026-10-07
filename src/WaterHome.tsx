import { ArrowUpRight } from "lucide-react";
import { WaterBackground } from "./WaterBackground";
import type { Machine, Spool } from "./live-workspace";
import type { Order } from "./order-model";

// The phone home screen: the spool floating on the pool, with the farm at a glance on frosted cards.
// Tap a printer for its details, or a card to open that page.
export function WaterHome({ machines, orders, spools, loading, openPrinter, go }: {
  machines: Machine[];
  orders: Order[];
  spools: Spool[];
  loading: boolean;
  openPrinter: (id: string) => void;
  go: (tab: string) => void;
}) {
  const printing = machines.filter((m) => m.state === "Printing").length,
    ready = machines.filter((m) => m.state === "Ready").length,
    low = spools.filter((s) => s.remaining < 150),
    toPrint = orders.filter((o) => o.printReadiness?.status === "ready").length,
    toReview = orders.filter((o) => o.printReadiness && o.printReadiness.status !== "ready").length;
  const summary = loading
    ? "Checking the farm…"
    : [printing && `${printing} printing`, ready && `${ready} ready`, `${orders.length} open order${orders.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
  return (
    <section className="water-home" aria-label="Spoolside home">
      <WaterBackground className="home-water" />
      <div className="home-content">
        <header className="home-mark">
          <img src="/spoolside.png" alt="" />
          <h1>
            spoolside<span className="brand-dot">.</span>
          </h1>
          <p>{summary}</p>
        </header>
        <div className="home-card">
          <button className="home-card-head" onClick={() => go("Printers")}>
            <h2>Printers</h2>
            <ArrowUpRight size={16} />
          </button>
          {machines.length === 0 && <p className="home-quiet">No printers connected.</p>}
          {machines.map((m) => (
            <button key={m.id} className="home-printer" onClick={() => openPrinter(m.id)} aria-label={`${m.name}, ${m.state}`}>
              <span className={`home-dot ${m.state.toLowerCase()}`} />
              <span className="home-printer-name">{m.name}</span>
              <span className="home-printer-state">
                {m.state === "Printing" || m.state === "Paused" ? `${m.progress}% · ${m.remaining}` : m.state}
              </span>
              {(m.state === "Printing" || m.state === "Paused") && (
                <span className="home-progress">
                  <span style={{ width: `${Math.min(100, Math.max(0, m.progress))}%` }} />
                </span>
              )}
            </button>
          ))}
        </div>
        <button className="home-card home-stat" onClick={() => go("Orders")}>
          <span className="home-card-head">
            <h2>Orders</h2>
            <ArrowUpRight size={16} />
          </span>
          <strong>{loading ? "—" : orders.length}</strong>
          <span className="home-quiet">
            {loading ? "Loading orders…" : orders.length === 0 ? "Nothing open. Enjoy the pool." : [toPrint && `${toPrint} ready to print`, toReview && `${toReview} ${toReview === 1 ? "needs" : "need"} a look`].filter(Boolean).join(" · ") || "open"}
          </span>
        </button>
        <button className="home-card home-stat" onClick={() => go("Filament")}>
          <span className="home-card-head">
            <h2>Filament</h2>
            <ArrowUpRight size={16} />
          </span>
          <strong>{spools.reduce((n, s) => n + s.remaining, 0).toLocaleString()} g</strong>
          <span className="home-quiet">
            {low.length ? `Running low: ${low.map((s) => s.name).join(", ")}` : spools.length ? "All spools stocked" : "No filament recorded"}
          </span>
        </button>
      </div>
    </section>
  );
}
