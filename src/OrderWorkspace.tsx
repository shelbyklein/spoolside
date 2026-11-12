import { OrderCostButton, OrderCostBreakdown, useOrderCosts } from "./Costs";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Search, ShoppingBag, ArrowUpRight, Truck, Check, CircleAlert, Printer, ChevronDown, ChevronRight } from "lucide-react";
import { OrderContents, itemLine, swatch } from "./OrderContents";
import { type Order, type PrintGroup, initialOrders, isOpenOrder, storeStatus } from "./order-model";
import { OrderPrintButtons } from "./OrderPrint";
import { Skeleton } from "./Skeleton";
import { useSort } from "./sort";
import { usePhone } from "./usePhone";
export { initialOrders };

// Pirate Ship imports Processing orders from WooCommerce; it has no per-order link or API.
export const PIRATE_SHIP_URL = "https://ship.pirateship.com/ship";

// Shipping follows the required pieces, with no separate packing confirmation.
export const shipReady = (order: Order) =>
  order.commercial.toLowerCase() === "processing" && !!order.printPlan?.length && order.printPlan.every(g => g.done) && !order.sourceReview && !order.refundReview && order.printReadiness?.status !== "review";

export function ShipButton({ order }: { order: Order }) {
  if (order.commercial.toLowerCase() !== "processing") return null;
  if (!shipReady(order))
    return (
      <button className="ship-button pending" disabled title="Print all required items first" aria-label={`Ship ${order.number}: print all required items first`}>
        <Truck size={14} /> Ship once printed
      </button>
    );
  return (
    <a className="ship-button" href={PIRATE_SHIP_URL} target="_blank" rel="noreferrer" aria-label={`Ship ${order.number} in Pirate Ship`}>
      <Truck size={16} /> Ship
    </a>
  );
}

export function StatusTag({ order }: { order: Order }) {
  const status = order.commercial.toLowerCase();
  if (status === "processing") return null;
  return <span className={`production-stage ${["on-hold", "cancelled", "refunded", "failed"].includes(status) ? "attention" : ""}`}>{storeStatus(order)}</span>;
}

// The one line an order gets in a list: "2 of 3 printed", or why it can't be printed yet.
export function orderProgress(order: Order) {
  const status = order.commercial.toLowerCase();
  if (status === "on-hold") return "On hold";
  if (order.sourceReview || order.refundReview || order.printReadiness?.status === "review") return "Needs review";
  const plan = order.printPlan || [];
  if (plan.length) return plan.every(g => g.done) ? "All printed" : `${plan.filter(g => g.done).length} of ${plan.length} printed`;
  return order.printReadiness?.status === "missing" ? "Files missing" : "Not started";
}

function OrderSummary({ order }: { order: Order }) {
  const item = order.items[0];
  const dot = swatch(item?.colorway);
  return (
    <>
      <strong className="order-line-number">{order.number}</strong>
      <span className="order-line-item">{dot && <span className="color-dot" style={{ background: dot }} />}<span>{item ? itemLine(item) : "No line items"}</span></span>
      <span className={`order-line-progress${/hold|review/i.test(orderProgress(order)) ? " attention" : ""}`}>{orderProgress(order)}</span>
    </>
  );
}

// An Overview row: the summary, a link to the order on the Orders page, and Ship once it's ready.
export function OrderLine({ order, onOpen }: { order: Order; onOpen: (id: string) => void }) {
  return (
    <article className="order-line" aria-label={`Order ${order.number}`}>
      <a className="order-line-open" href="/orders" onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); onOpen(order.id); }}>
        <OrderSummary order={order} />
        <ChevronRight size={16} aria-hidden="true" />
      </a>
      {shipReady(order) && <ShipButton order={order} />}
    </article>
  );
}

// The header of a phone Orders row that's open: the same summary, and tapping it closes the row again.
function OrderExpanded({ order, onClose, children }: { order: Order; onClose: () => void; children: ReactNode }) {
  return (
    <div className="order-open">
      <button className="order-collapse" aria-expanded="true" aria-label={`Close order ${order.number}`} onClick={onClose}>
        <OrderSummary order={order} />
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {children}
    </div>
  );
}

// A phone Orders row that's closed: the same summary with a button that opens the full row.
function OrderCollapsed({ order, onOpen }: { order: Order; onOpen: () => void }) {
  return (
    <article className="order-line collapsed" aria-label={`Order ${order.number}`}>
      <button className="order-line-open" aria-expanded="false" aria-label={`Open order ${order.number}`} onClick={onOpen}>
        <OrderSummary order={order} />
        <ChevronDown size={16} aria-hidden="true" />
      </button>
    </article>
  );
}

export function OrderRow({ order, onPrint, onTick, printerAvailable = false, cost }: { order: Order; printerAvailable?: boolean; onChange?: (order: Order) => void; onPrint?: (order: Order, group: PrintGroup) => void; onTick?: (order: Order, assetId: string, done: number) => void; cost?: { total: number; complete: boolean } }) {
  const [costOpen, setCostOpen] = useState(false);
  return (
    <article className="overview-order-row" aria-label={`Order ${order.number}`}>
      <span className="order-id">
        <strong>{order.number}</strong>
        <small>{order.placed}</small>
        {cost && <OrderCostButton total={cost.total} complete={cost.complete} open={costOpen} onToggle={() => setCostOpen(!costOpen)} />}
      </span>
      <div className="order-content-readiness"><div className="order-product-summary"><OrderContents order={order} /><div className="order-status-pills">{order.printReadiness && <details className={`print-readiness ${order.printReadiness.status}`}><summary aria-label={order.printReadiness.status === "ready" ? "Files ready" : order.printReadiness.status === "missing" ? "Files missing" : "Files need review"} title={order.printReadiness.status === "ready" ? "Files ready" : "Check sliced files"}>Files {order.printReadiness.status === "ready" ? <Check size={13} aria-hidden="true" /> : <CircleAlert size={13} aria-hidden="true" />}</summary><div>{order.printReadiness.status === "ready" ? <p>Sliced files cover all {order.printReadiness.required} required parts. Check material and printer settings before printing.</p> : <ul>{order.printReadiness.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}<a href="/library/sliced">Sliced prints</a></div></details>}{printerAvailable && <span className="printer-available"><Printer size={13} aria-hidden="true" /> Printer available</span>}</div></div>
      <div className="order-fulfillment">{onPrint && onTick && <OrderPrintButtons order={order} onPrint={(g) => onPrint(order, g)} onTick={(a, d) => onTick(order, a, d)} />}<div className="order-ship-footer"><span className="ship-slot"><ShipButton order={order} /></span></div><StatusTag order={order} />
      </div></div>
      {cost && costOpen && <OrderCostBreakdown orderId={order.id} />}
    </article>
  );
}

const orderNumber = (o: Order) => Number(o.number.replace(/\D/g, "")) || 0;
const FILTERS = ["Open orders", "Processing", "On hold", "Shipped", "All orders"];

export function Orders({ live = false, openOrderId, orders, availableOrders = [], onOrderChange, onPrint, onTick, placeholder }: { placeholder?: 'loading' | 'unavailable'; live?: boolean; availableOrders?: string[]; openOrderId: string | null; orders: Order[]; onOrderChange?: (order: Order) => void; onPrint?: (order: Order, group: PrintGroup) => void; onTick?: (order: Order, assetId: string, done: number) => void }) {
  const focus = orders.find((o) => o.id === openOrderId);
  const phone = usePhone();
  // On a phone, rows start closed; the order opened from the Overview starts open. Several can be open at once.
  const [opened, setOpened] = useState<string[]>(() => (openOrderId ? [openOrderId] : []));
  const toggle = (id: string) => setOpened((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  const focusRef = useRef<HTMLDivElement>(null);
  useEffect(() => { focusRef.current?.scrollIntoView({ block: "start" }); }, [focus?.id, phone]);
  const costs = useOrderCosts(live, orders.map((o) => o.id).join());
  const [search, setSearch] = useState(focus ? focus.number : ""),
    [filter, setFilter] = useState(focus ? "All orders" : "Open orders");
  // Oldest first by default: the next to fulfill on top.
  const sorting = useSort<Order>("orders", "orders", [
    { id: "oldest", label: "Oldest first", compare: (a, b) => orderNumber(a) - orderNumber(b) },
    { id: "newest", label: "Newest first", compare: (a, b) => orderNumber(b) - orderNumber(a) },
  ]);
  const visible = sorting.sort(orders.filter((o) => {
    const status = o.commercial.toLowerCase();
    const match =
      filter === "All orders" ||
      (filter === "Open orders" && isOpenOrder(o)) ||
      (filter === "Processing" && status === "processing") ||
      (filter === "On hold" && status === "on-hold") ||
      (filter === "Shipped" && ["shipped", "completed", "delivered"].includes(status));
    const text = `${o.number} ${o.items.map((i) => `${i.name} ${i.variant} ${i.phone || ""} ${i.colorway || ""}`).join(" ")}`;
    return match && text.toLowerCase().includes(search.toLowerCase());
  }));
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
          <input aria-label="Search orders" placeholder="Search orders, phones, colors" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <select aria-label="Filter orders" value={filter} onChange={(e) => setFilter(e.target.value)}>
          {FILTERS.map((s) => <option key={s}>{s}</option>)}
        </select>
        {sorting.menu}
        {!placeholder && <span>{visible.length} of {orders.length} orders</span>}
      </div>
      <div className="orders-list">
        {placeholder && <Skeleton rows={4} still={placeholder === "unavailable"} tall />}
        {!placeholder && visible.length === 0 && (
          <div className="empty">
            <Search />
            <h3>No orders found</h3>
            <button className="text-button" onClick={() => { setSearch(""); setFilter("All orders"); }}>Clear filters</button>
          </div>
        )}
        {visible.map((order) => {
          if (phone && !opened.includes(order.id)) return <OrderCollapsed key={order.id} order={order} onOpen={() => toggle(order.id)} />;
          const row = <OrderRow key={order.id} order={order} cost={costs[order.id]} printerAvailable={availableOrders.includes(order.id)} onChange={onOrderChange} onPrint={onPrint} onTick={onTick} />;
          if (!phone) return row;
          return <div key={order.id} ref={order.id === focus?.id ? focusRef : undefined}><OrderExpanded order={order} onClose={() => toggle(order.id)}>{row}</OrderExpanded></div>;
        })}
      </div>
    </section>
  );
}
