import { useEffect, useRef } from "react";
import { gsap } from "gsap";
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
  const ref = useRef<HTMLDivElement>(null);
  const identity = floating.map(f => f.order.id).join(":");
  useEffect(() => {
    const el = ref.current!, surface = el.closest<HTMLElement>(".water-home")!;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    const boats = Array.from(el.querySelectorAll<HTMLElement>(".pool-case-force")).map(node => ({node,x:0,y:0,vx:0,vy:0}));
    const waves: {x:number;y:number;strength:number;at:number;hit:Set<HTMLElement>}[] = [];
    const wave = (event: Event) => {
      if (reduce.matches) return;
      waves.push({...((event as CustomEvent).detail),at:performance.now(),hit:new Set()});
      if (waves.length > 24) waves.shift();
    };
    let last = performance.now();
    const tick = () => {
      const now = performance.now(), dt = Math.min((now-last)/1000,.06); last=now;
      if (document.hidden || reduce.matches) return;
      const pool = surface.getBoundingClientRect(), speed = Math.min(pool.width,pool.height)*.4675;
      while (waves.length && now-waves[0].at > 3000) waves.shift();
      for (const boat of boats) {
        const rect = boat.node.getBoundingClientRect();
        for (const w of waves) {
          if (w.hit.has(boat.node)) continue;
          const age = (now-w.at)/1000;
          const dx=rect.left+rect.width/2-w.x, dy=(rect.top+rect.height/2-w.y)*2.2;
          const d=Math.hypot(dx,dy);
          if (d > age*speed+12) continue;
          w.hit.add(boat.node);
          const push=w.strength*100*Math.exp(-age*.99);
          boat.vx+=dx/Math.max(d,1)*push;boat.vy+=dy/Math.max(d,1)*push*.45;
        }
        // Damped buoyancy returns each case to its drifting lane after the wave passes.
        boat.vx+=(-boat.x*5-boat.vx*3.2)*dt;boat.vy+=(-boat.y*5-boat.vy*3.2)*dt;
        boat.x=Math.max(-80,Math.min(80,boat.x+boat.vx*dt));boat.y=Math.max(-55,Math.min(55,boat.y+boat.vy*dt));
        boat.node.style.transform=`translate(${boat.x}px, ${boat.y}px)`;
      }
    };
    const preference = () => { for (const b of boats) { b.x=b.y=b.vx=b.vy=0;b.node.style.transform=""; } waves.length=0; };
    surface.addEventListener("water-wave",wave); reduce.addEventListener("change",preference);
    gsap.ticker.add(tick);
    return () => {surface.removeEventListener("water-wave",wave);reduce.removeEventListener("change",preference);gsap.ticker.remove(tick);};
  }, [identity]);
  return (
    <div ref={ref} className="pool-cases">
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
            <span className="pool-case-force"><span className="pool-case-bob"><img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => ((e.currentTarget.closest(".pool-case") as HTMLElement).style.display = "none")} /></span></span>
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
