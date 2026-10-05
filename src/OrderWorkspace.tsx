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
  type Recipe,
  initialOrders,
  orderStage,
  componentsFor,
  acceptedUnits,
  partsComplete,
  buildMissingJobs,
} from "./order-model";
export { initialOrders };
type Props = {
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
    [filter, setFilter] = useState("All orders"),
    [expanded, setExpanded] = useState<string | null>(
      openOrderId || "demo-1042",
    );
  const update = (id: string, patch: Partial<Order>) =>
    setOrders(orders.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const enqueue = (order: Order, printer: string) => {
    const newJobs = buildMissingJobs(order, jobs, printer);
    setJobs([...jobs, ...newJobs]);
    notify(
      newJobs.length
        ? `${newJobs.length} component jobs added to the demo queue.`
        : "All required components already have a job.",
    );
  };
  const visible = orders.filter(
    (o) =>
      (filter === "All orders" || orderStage(o, jobs) === filter) &&
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
          <p>playcase.gg · connection pending</p>
        </div>
        <span className="sample-label">Sample orders</span>
        <a
          href="https://playcase.gg/wp-admin/edit.php?post_type=shop_order"
          target="_blank"
          rel="noreferrer"
        >
          Open store <ArrowUpRight size={15} />
        </a>
      </div>
      <p className="sample-disclaimer">
        These are illustrative orders and component recipes, not your store’s
        catalog or customer records. Changes stay in this browser and never
        update WooCommerce.
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
            "Needs mapping",
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
            cancelled = order.commercial === "Cancelled",
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
                  {order.items[0].name}
                  <small>
                    {order.items.reduce((n, i) => n + i.quantity, 0)} units ·{" "}
                    {order.items[0].variant.replace("Sample variant · ", "")}
                  </small>
                </span>
                <span
                  className={`production-stage ${stage === "Blocked" || stage === "Needs mapping" ? "attention" : ""}`}
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
                  {cancelled && (
                    <div className="order-warning">
                      <AlertCircle size={17} />
                      <span>
                        This sample order is cancelled. New jobs and fulfillment
                        are disabled. Any started parts need review.
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
                                      {r.material} · sample estimate {r.time}
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
                          ) : (
                            <p className="mapping-note">
                              Map the components before putting this item into
                              production.
                            </p>
                          )}
                          {!item.recipe.length && !cancelled && (
                            <RecipeForm
                              onSave={(recipe) => {
                                update(order.id, {
                                  items: order.items.map((i) =>
                                    i.id === item.id ? { ...i, recipe } : i,
                                  ),
                                });
                                notify(
                                  "Component mapping saved for this sample order.",
                                );
                              }}
                            />
                          )}
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
                      <div className="linked-jobs">
                        <div className="linked-heading">
                          <h3>Print jobs</h3>
                          <button className="text-button" onClick={showQueue}>
                            Open queue <ArrowUpRight size={14} />
                          </button>
                        </div>
                        {linked.length === 0 ? (
                          <p>
                            No print jobs yet. Map the parts, then queue them.
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
                                      "Demo print job updated. No printer command was sent.",
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
                      </div>
                    </section>
                    <section className="fulfillment">
                      <h3>Finish the order</h3>
                      <p>
                        Accept every printed component before assembly and
                        packing.
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
                          placeholder="Optional demo tracking reference"
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
                            "Sample order marked shipped locally. WooCommerce was not changed.",
                          );
                        }}
                      >
                        {order.shipped ? (
                          <Check size={17} />
                        ) : (
                          <PackageCheck size={17} />
                        )}{" "}
                        {order.shipped
                          ? "Shipped in demo"
                          : "Mark demo order shipped"}
                      </button>
                      {order.shipped && (
                        <button
                          className="text-button"
                          onClick={() => update(order.id, { shipped: false })}
                        >
                          Undo demo shipment
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
                      {!cancelled && !order.shipped && (
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
function RecipeForm({ onSave }: { onSave: (recipe: Recipe[]) => void }) {
  const [rows, setRows] = useState([
    { component: "", units: 1, material: "Tangerine PLA", time: "1h" },
  ]);
  const [error, setError] = useState("");
  return (
    <form
      className="recipe-form"
      onSubmit={(e) => {
        e.preventDefault();
        const names = rows.map((r) => r.component.trim());
        if (
          names.some((n) => !n) ||
          new Set(names.map((n) => n.toLowerCase())).size !== names.length
        ) {
          setError("Give each component a unique name.");
          return;
        }
        onSave(rows.map((r) => ({ ...r, component: r.component.trim() })));
      }}
    >
      <h4>Define the parts for each unit</h4>
      {rows.map((r, index) => (
        <div className="recipe-fields" key={index}>
          <label>
            Component
            <input
              aria-label={`Component ${index + 1} name`}
              required
              value={r.component}
              maxLength={60}
              placeholder="e.g. Case body"
              onChange={(e) =>
                setRows(
                  rows.map((row, i) =>
                    i === index ? { ...row, component: e.target.value } : row,
                  ),
                )
              }
            />
          </label>
          <label>
            Per unit
            <input
              aria-label={`Component ${index + 1} quantity`}
              type="number"
              min={1}
              max={20}
              required
              value={r.units}
              onChange={(e) =>
                setRows(
                  rows.map((row, i) =>
                    i === index
                      ? { ...row, units: Number(e.target.value) }
                      : row,
                  ),
                )
              }
            />
          </label>
          <label>
            Filament
            <select
              value={r.material}
              onChange={(e) =>
                setRows(
                  rows.map((row, i) =>
                    i === index ? { ...row, material: e.target.value } : row,
                  ),
                )
              }
            >
              {[
                "Tangerine PLA",
                "Seafoam PLA",
                "Cloud white PLA",
                "Midnight PLA",
              ].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label>
            Estimate
            <input
              required
              maxLength={30}
              value={r.time}
              onChange={(e) =>
                setRows(
                  rows.map((row, i) =>
                    i === index ? { ...row, time: e.target.value } : row,
                  ),
                )
              }
            />
          </label>
        </div>
      ))}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="recipe-actions">
        <button
          type="button"
          className="text-button"
          disabled={rows.length >= 8}
          onClick={() =>
            setRows([
              ...rows,
              {
                component: "",
                units: 1,
                material: "Cloud white PLA",
                time: "30 min",
              },
            ])
          }
        >
          Add component
        </button>
        <button className="secondary" type="submit">
          Save component mapping
        </button>
      </div>
    </form>
  );
}
