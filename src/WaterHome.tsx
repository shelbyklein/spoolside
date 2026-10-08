import { ArrowUpRight } from "lucide-react";
import { WaterBackground } from "./WaterBackground";
import type { Machine } from "./live-workspace";
import type { Order } from "./order-model";

// Each open order floats as a little PlayCase: its faceplate photo, else the case photo.
const caseImage = (o: Order) => {
  for (const i of o.items) {
    const image = i.parts?.find((p) => p.image)?.image || i.image;
    if (image) return { image, label: [i.phone, i.colorway].filter(Boolean).join(", ") };
  }
  return null;
};
// Stable per-order randomness, so a case keeps its lane and pace across refreshes.
const seeded = (id: string) => {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (n: number) => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ n) >>> 0) / 4294967296;
};
const LANES = [6, 30, 70]; // % down the pool: above the spool, behind it, below the wordmark
function FloatingCases({ orders, openOrder }: { orders: Order[]; openOrder: (id: string) => void }) {
  const floating = orders.flatMap((o) => { const c = caseImage(o); return c ? [{ order: o, ...c }] : []; }).slice(0, 10);
  return (
    <div className="pool-cases">
      {floating.map(({ order, image, label }, n) => {
        const r = seeded(order.id), duration = 46 + r(1) * 30;
        return (
          <button
            key={order.id}
            className="pool-case"
            aria-label={`Order ${order.number}${label ? ", " + label : ""}`}
            onClick={() => openOrder(order.id)}
            style={{
              "--lane": `${LANES[n % LANES.length] + r(2) * 8}%`,
              "--size": `${58 + r(3) * 18}px`,
              "--drift": `${duration}s`,
              "--start": `${-duration * ((n * 0.37 + r(4) * 0.2) % 1)}s`,
              "--bob": `${3.2 + r(5) * 2}s`,
              "--tilt": `${(r(6) - 0.5) * 24}deg`,
              "--dir": r(7) < 0.5 ? "normal" : "reverse",
            } as React.CSSProperties}
          >
            <span><img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => ((e.currentTarget.closest(".pool-case") as HTMLElement).style.display = "none")} /></span>
          </button>
        );
      })}
    </div>
  );
}

// The phone home screen: the spool floating on the pool, with printers and orders at a glance on frosted cards.
// Tap a printer for its details, or a card to open that page.
export function WaterHome({ machines, orders, loading, openPrinter, openOrder, go }: {
  machines: Machine[];
  orders: Order[];
  loading: boolean;
  openPrinter: (id: string) => void;
  openOrder: (id: string) => void;
  go: (tab: string) => void;
}) {
  const printing = machines.filter((m) => m.state === "Printing").length,
    ready = machines.filter((m) => m.state === "Ready").length,
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
          <FloatingCases orders={orders} openOrder={openOrder} />
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
      </div>
    </section>
  );
}
