import { useState } from "react";
import {
  Search,
  ShoppingBag,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  PackageCheck,
  Layers3,
  AlertCircle,
  Check,
} from "lucide-react";
import {
  type Job,
  type Order,
  initialOrders,
  orderStage,
  componentsFor,
  acceptedUnits,
  partsComplete,
  productionAllowed,
  buildMissingJobs,
} from "./order-model";
export { initialOrders };
type Props = {
  live?: boolean;
  openOrderId: string | null;
  orders: Order[];
  setOrders: (orders: Order[]) => void;
  jobs: Job[];
  setJobs: (jobs: Job[]) => void;
  printers: string[];
  notify: (message: string) => void;
  showQueue: () => void;
};
export function Orders({
  live = false,
  openOrderId,
  orders,
  setOrders,
  jobs,
  setJobs,
  printers,
  notify,
  showQueue,
}: Props) {
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState(live && !openOrderId ? "Active orders" : "All orders"),
    [expanded, setExpanded] = useState<string | null>(
      openOrderId ||
        (window.matchMedia("(max-width: 760px)").matches ? null : "demo-1042"),
    );
  const update = (id: string, patch: Partial<Order>) =>
    setOrders(orders.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const enqueue = (order: Order, printer: string) => {
    const newJobs = buildMissingJobs(order, jobs, printer);
    setJobs([...jobs, ...newJobs]);
    notify(
      newJobs.length
        ? `${newJobs.length} component jobs added to the production queue.`
        : "All required components already have a job.",
    );
  };
  const visible = orders.filter(
    (o) =>
      (filter === "All orders" ||
        (filter === "Active orders"
          ? productionAllowed(o)
          : orderStage(o, jobs) === filter)) &&
      `${o.number} ${o.items.map((i) => `${i.name} ${i.variant}`).join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <section className="orders-workspace">
      <div className="order-source">
        <ShoppingBag size={21} />
        <div>
          <strong>PlayCase / WooCommerce</strong>
          <p>
            {live
              ? "playcase.gg · read-only import"
              : "playcase.gg · connection pending"}
          </p>
        </div>
        <span className="sample-label">
          {live ? "Live orders" : "Sample orders"}
        </span>
        <a
          href="https://playcase.gg/wp-admin/edit.php?post_type=shop_order"
          target="_blank"
          rel="noreferrer"
        >
          Open store <ArrowUpRight size={15} />
        </a>
      </div>
      <p className="sample-disclaimer">
        {live
          ? "Production changes save to the Beelink and do not update WooCommerce. Store order status remains the source of truth."
          : "These are illustrative orders and component recipes, not your store’s catalog or customer records. Changes stay in this browser and never update WooCommerce."}
      </p>
      <div className="orders-toolbar">
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label="Search orders"
            placeholder="Search order or variant"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          aria-label="Filter orders"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          {[
            "All orders",
            ...(live ? ["Active orders", "On hold", "Fulfilled in store"] : []),
            "Fulfillment",
            "To queue",
            "Queued",
            "Printing",
            "Blocked",
            "Assembly",
            "Ready to ship",
            "Shipped",
            "Cancelled",
          ].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <span>
          {visible.length} of {orders.length} orders
        </span>
      </div>
      <div className="orders-list">
        {visible.length === 0 && (
          <div className="empty">
            <Search />
            <h3>No orders found</h3>
            <p>Try another search or choose All orders.</p>
            <button
              className="text-button"
              onClick={() => {
                setSearch("");
                setFilter("All orders");
              }}
            >
              Clear filters
            </button>
          </div>
        )}
        {visible.map((order) => {
          const stage = orderStage(order, jobs),
            open = expanded === order.id,
            complete = partsComplete(order, jobs),
            cancelled = !productionAllowed(order),
            linked = jobs.filter((j) => j.orderId === order.id),
            parts = componentsFor(order);
          return (
            <article key={order.id} className="order-entry">
              <button
                className="order-summary"
                aria-expanded={open}
                aria-controls={`order-${order.id}`}
                onClick={() => setExpanded(open ? null : order.id)}
              >
                <span className="order-id">
                  <strong>{order.number}</strong>
                  <small>{order.placed}</small>
                </span>
                <span className="order-product">
                  {order.items[0]?.name || "No line items"}
                  <small>
                    {order.items.reduce((n, i) => n + i.quantity, 0)} units ·{" "}
                    {(order.items[0]?.variant || "").replace(
                      "Sample variant · ",
                      "",
                    )}
                  </small>
                </span>
                <span
                  className={`production-stage ${stage === "Blocked" ? "attention" : ""}`}
                >
                  {stage}
                </span>
                {open ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
              </button>
              {open && (
                <div id={`order-${order.id}`} className="order-detail">
                  <div className="order-commercial">
                    <span>
                      WooCommerce status: <strong>{order.commercial}</strong>
                    </span>
                    <span>Production status is tracked separately.</span>
                  </div>
                  {order.sourceReview && (
                    <div className="order-warning">
                      <AlertCircle size={17} />
                      <span>Store items changed. Review quantities, variants and existing print records before continuing.</span>
                      <button className="text-button" onClick={() => { if (window.confirm("Have you reviewed changed store items and existing print records?")) update(order.id, {sourceReview: false}); }}>Confirm review</button>
                    </div>
                  )}
                  {cancelled && (
                    <div className="order-warning">
                      <AlertCircle size={17} />
                      <span>
                        {live
                          ? "Production is on hold. Review payment, cancellation or refund status in WooCommerce before continuing. Existing prints need review."
                          : "This sample order is cancelled. New jobs and fulfillment are disabled. Any started parts need review."}
                      </span>
                    </div>
                  )}
                  <div className="order-detail-grid">
                    <section>
                      <h3>What we’re making</h3>
                      {order.items.map((item) => (
                        <div className="order-item" key={item.id}>
                          <div className="line-item-title">
                            <strong>{item.name}</strong>
                            <span>× {item.quantity}</span>
                          </div>
                          <p>{item.variant}</p>
                          {item.recipe.length > 0 ? (
                            <div className="recipe-list">
                              {item.recipe.map((r) => (
                                <div key={r.component}>
                                  <span>
                                    {r.component}
                                    <small>
                                      {r.material} ·{" "}
                                      {live ? "estimate" : "sample estimate"}{" "}
                                      {r.time}
                                    </small>
                                  </span>
                                  <span>
                                    {acceptedUnits(
                                      order,
                                      jobs,
                                      item.id,
                                      r.component,
                                    )}{" "}
                                    / {r.units * item.quantity} accepted
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                      {parts.length > 0 && !cancelled && !complete && (
                        <form
                          className="assign-print"
                          onSubmit={(e) => {
                            e.preventDefault();
                            enqueue(
                              order,
                              String(
                                new FormData(e.currentTarget).get("printer"),
                              ),
                            );
                          }}
                        >
                          <label>
                            Assign new jobs to
                            <select name="printer">
                              {printers.map((p) => (
                                <option key={p}>{p}</option>
                              ))}
                            </select>
                          </label>
                          <button className="primary" type="submit">
                            <Layers3 size={16} /> Queue missing parts
                          </button>
                        </form>
                      )}
                      {(parts.length > 0 || linked.length > 0) && <div className="linked-jobs">
                        <div className="linked-heading">
                          <h3>Print jobs</h3>
                          <button className="text-button" onClick={showQueue}>
                            Open queue <ArrowUpRight size={14} />
                          </button>
                        </div>
                        {linked.length === 0 ? (
                          <p>
                            No print jobs yet. Queue existing components when needed.
                          </p>
                        ) : (
                          linked.map((job) => (
                            <div className="linked-job" key={job.id}>
                              <div>
                                <strong>{job.component}</strong>
                                <span>
                                  {job.units || 1} units · {job.printer}
                                </span>
                              </div>
                              <label>
                                Job status
                                <select
                                  aria-label={`${order.number} ${job.component} job ${job.id} status`}
                                  value={job.state || "Queued"}
                                  disabled={cancelled || order.shipped}
                                  onChange={(e) => {
                                    setJobs(
                                      jobs.map((j) =>
                                        j.id === job.id
                                          ? {
                                              ...j,
                                              state: e.target
                                                .value as Job["state"],
                                            }
                                          : j,
                                      ),
                                    );
                                    if (e.target.value !== "Accepted")
                                      update(order.id, {
                                        assembled: false,
                                        packed: false,
                                        shipped: false,
                                      });
                                    notify(
                                      "Production print record updated. No printer command was sent.",
                                    );
                                  }}
                                >
                                  {[
                                    "Queued",
                                    "Printing",
                                    "Accepted",
                                    "Failed",
                                  ].map((s) => (
                                    <option key={s}>{s}</option>
                                  ))}
                                </select>
                              </label>
                            </div>
                          ))
                        )}
                      </div>}
                    </section>
                    <section className="fulfillment">
                      <h3>Fulfillment</h3>
                      <p>
                        Confirm the items are ready, then complete the quality check and packing. Existing print records must be accepted when present.
                      </p>
                      <label className="check-row">
                        <input
                          type="checkbox"
                          checked={order.assembled && complete}
                          disabled={!complete || cancelled || order.shipped}
                          onChange={(e) =>
                            update(order.id, {
                              assembled: e.target.checked,
                              packed: false,
                            })
                          }
                        />
                        <span>Assembly and quality check complete</span>
                      </label>
                      <label className="check-row">
                        <input
                          type="checkbox"
                          checked={order.packed && complete}
                          disabled={
                            !complete ||
                            !order.assembled ||
                            cancelled ||
                            order.shipped
                          }
                          onChange={(e) =>
                            update(order.id, { packed: e.target.checked })
                          }
                        />
                        <span>Packed and ready for shipping</span>
                      </label>
                      <label className="tracking-field">
                        Tracking reference
                        <input
                          placeholder={
                            live
                              ? "Optional tracking reference"
                              : "Optional demo tracking reference"
                          }
                          value={order.tracking}
                          disabled={cancelled || order.shipped}
                          onChange={(e) =>
                            update(order.id, { tracking: e.target.value })
                          }
                        />
                      </label>
                      <button
                        className="primary"
                        disabled={
                          !complete ||
                          !order.assembled ||
                          !order.packed ||
                          cancelled ||
                          order.shipped
                        }
                        onClick={() => {
                          update(order.id, { shipped: true });
                          notify(
                            "Production shipment recorded. WooCommerce was not changed.",
                          );
                        }}
                      >
                        {order.shipped ? (
                          <Check size={17} />
                        ) : (
                          <PackageCheck size={17} />
                        )}{" "}
                        {order.shipped
                          ? live
                            ? "Shipment recorded"
                            : "Shipped in demo"
                          : live
                            ? "Record shipment"
                            : "Mark demo order shipped"}
                      </button>
                      {order.shipped && (
                        <button
                          className="text-button"
                          onClick={() => update(order.id, { shipped: false })}
                        >
                          {live ? "Undo shipment record" : "Undo demo shipment"}
                        </button>
                      )}
                      <p className="fulfillment-note">
                        No shipping label is purchased or store status changed.
                      </p>
                      <label className="tracking-field">
                        Production notes
                        <textarea
                          placeholder="A note for your workshop"
                          maxLength={1000}
                          value={order.note}
                          onChange={(e) =>
                            update(order.id, { note: e.target.value })
                          }
                        />
                      </label>
                      {!live && !cancelled && !order.shipped && (
                        <button
                          className="text-button danger-text"
                          onClick={() => {
                            update(order.id, {
                              commercial: "Cancelled",
                              assembled: false,
                              packed: false,
                            });
                            notify(
                              "Cancellation simulated. Existing print jobs are retained for review.",
                            );
                          }}
                        >
                          Simulate order cancellation
                        </button>
                      )}
                    </section>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
