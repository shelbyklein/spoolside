import { FloatingSpool } from "./FloatingSpool";
import { ShoppingBag } from "lucide-react";
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
const LANES = [6, 30, 70]; // % down the pool: above the spool, behind it, below it
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

// The phone home screen: the spool floating on the pool, with printers and orders at a glance as pills.
// Tap a printer for its details, or a card to open that page.
export function WaterHome({ attention, machines, orders, loading, bedsToClear = [], openPrinter, openOrder, go }: {
  bedsToClear?: string[];
  machines: Machine[];
  orders: Order[];
  loading: boolean;
  attention?: React.ReactNode;
  openPrinter: (id: string) => void;
  openOrder: (id: string) => void;
  go: (tab: string) => void;
}) {
  const toPrint = orders.filter((o) => o.printReadiness?.status === "ready").length;
  return (
    <section className="water-home" aria-label="Spoolside home">
      <WaterBackground className="home-water" />
      <div className="home-content">
        <header className="home-mark">
          <FloatingCases orders={orders} openOrder={openOrder} />
          <FloatingSpool />
        </header>
        {attention}
        <div className="home-pills">
          {machines.map((m) => {
            const needsClear = bedsToClear.includes(m.id);
            const active = m.state === "Printing" || m.state === "Paused";
            return (
              <button
                key={m.id}
                className={`home-pill ${m.state.toLowerCase()}`}
                onClick={() => openPrinter(m.id)}
                aria-label={`${m.name}, ${m.state}${needsClear ? ", bed needs clearing" : ""}`}
                title={needsClear ? "Bed needs clearing" : undefined}
                style={active ? ({ "--fill": `${Math.min(100, Math.max(0, m.progress))}%` } as React.CSSProperties) : undefined}
              >
                <span className={`home-dot ${needsClear ? "bed-needs-clear" : m.state.toLowerCase()}`} />
                <span className="home-pill-name">{m.name}</span>
                <span className="home-pill-state">{active ? `${m.progress}%` : m.state}</span>
              </button>
            );
          })}
          <button className="home-pill orders" onClick={() => go("Orders")} aria-label={`Orders, ${loading ? "loading" : `${orders.length} open`}`}>
            <ShoppingBag size={14} />
            <span className="home-pill-name">{loading ? "—" : orders.length} {orders.length === 1 ? "order" : "orders"}</span>
            {!loading && toPrint > 0 && <span className="home-pill-state">{toPrint} ready</span>}
          </button>
        </div>
      </div>
    </section>
  );
}
