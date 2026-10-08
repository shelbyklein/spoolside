import { useState } from "react";
import { Search, ShoppingBag, ArrowUpRight, Truck } from "lucide-react";
import { OrderContents } from "./OrderContents";
import { type Order, initialOrders, isOpenOrder, storeStatus } from "./order-model";
export { initialOrders };

// Pirate Ship imports Processing orders from WooCommerce; it has no per-order link or API.
export const PIRATE_SHIP_URL = "https://ship.pirateship.com/ship";

export function ShipButton({ order }: { order: Order }) {
  if (order.commercial.toLowerCase() !== "processing") return null;
  return (
    <a className="ship-button" href={PIRATE_SHIP_URL} target="_blank" rel="noreferrer" aria-label={`Ship ${order.number} in Pirate Ship`}>
      <Truck size={16} /> Ship
    </a>
  );
}

export function StatusTag({ order }: { order: Order }) {
  const status = order.commercial.toLowerCase();
  return <span className={`production-stage ${["on-hold", "cancelled", "refunded", "failed"].includes(status) ? "attention" : ""}`}>{storeStatus(order)}</span>;
}

export function OrderRow({ order }: { order: Order }) {
  return (
    <article className="overview-order-row" aria-label={`Order ${order.number}`}>
      <span className="order-id">
        <strong>{order.number}</strong>
        <small>{order.placed}</small>
      </span>
      <div className="order-content-readiness"><OrderContents order={order} />{order.printReadiness && <details className={`print-readiness ${order.printReadiness.status}`}><summary>{order.printReadiness.status === "ready" ? "Files ready" : order.printReadiness.status === "missing" ? "Sliced files missing" : "Files need review"}</summary><div>{order.printReadiness.status === "ready" ? <p>Sliced files cover all {order.printReadiness.required} required parts. Check material and printer settings before printing.</p> : <ul>{order.printReadiness.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}<a href="/library/sliced">Sliced prints</a></div></details>}</div>
      <StatusTag order={order} />
      <span className="ship-slot"><ShipButton order={order} /></span>
    </article>
  );
}

const FILTERS = ["Open orders", "Processing", "On hold", "Shipped", "All orders"];

export function Orders({ live = false, openOrderId, orders }: { live?: boolean; openOrderId: string | null; orders: Order[] }) {
  const focus = orders.find((o) => o.id === openOrderId);
  const [search, setSearch] = useState(focus ? focus.number : ""),
    [filter, setFilter] = useState(focus ? "All orders" : "Open orders");
  const visible = orders.filter((o) => {
    const status = o.commercial.toLowerCase();
    const match =
      filter === "All orders" ||
      (filter === "Open orders" && isOpenOrder(o)) ||
      (filter === "Processing" && status === "processing") ||
      (filter === "On hold" && status === "on-hold") ||
      (filter === "Shipped" && ["shipped", "completed", "delivered"].includes(status));
    const text = `${o.number} ${o.items.map((i) => `${i.name} ${i.variant} ${i.phone || ""} ${i.colorway || ""}`).join(" ")}`;
    return match && text.toLowerCase().includes(search.toLowerCase());
  });
  return (
    <section className="orders-workspace">
      <div className="order-source">
        <ShoppingBag size={21} />
        <div>
          <strong>PlayCase / WooCommerce</strong>
          <p>{live ? "playcase.gg" : "playcase.gg · sample orders"}</p>
        </div>
        <a href={PIRATE_SHIP_URL} target="_blank" rel="noreferrer">
          Pirate Ship <ArrowUpRight size={15} />
        </a>
        <a href="https://playcase.gg/wp-admin/edit.php?post_type=shop_order" target="_blank" rel="noreferrer">
          Open store <ArrowUpRight size={15} />
        </a>
      </div>
      <div className="orders-toolbar">
        <label className="search-field">
          <Search size={17} />
          <input aria-label="Search orders" placeholder="Search order, phone or color" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <select aria-label="Filter orders" value={filter} onChange={(e) => setFilter(e.target.value)}>
          {FILTERS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <span>{visible.length} of {orders.length} orders</span>
      </div>
      <div className="orders-list">
        {visible.length === 0 && (
          <div className="empty">
            <Search />
            <h3>No orders found</h3>
            <button className="text-button" onClick={() => { setSearch(""); setFilter("All orders"); }}>Clear filters</button>
          </div>
        )}
        {visible.map((order) => <OrderRow key={order.id} order={order} />)}
      </div>
    </section>
  );
}
