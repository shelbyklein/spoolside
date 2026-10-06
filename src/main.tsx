import { PrintControls, PrintLibrary } from "./PrintControls";
import { AssetLibrary } from "./AssetLibrary";
import { NotificationSettings } from "./NotificationSettings";
import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  Printer,
  Layers3,
  Disc3,
  Settings,
  ArrowUpRight,
  Plus,
  Pause,
  Play,
  X,
  ChevronRight,
  WifiOff,
  RefreshCw,
  Boxes,
  Clock3,
  Thermometer,
  Check,
  Download,
  CircleHelp,
  RotateCcw,
  ArrowUp,
  Trash2,
  ShoppingBag,
} from "lucide-react";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "./style.css";
import { Orders, initialOrders, OrderRow } from "./OrderWorkspace";
import { type Job, type Order, productionAllowed, isOpenOrder } from "./order-model";
import { useLiveWorkspace, type Machine, type Spool } from "./live-workspace";

const initialMachines: Machine[] = [
  {
    id: "1",
    name: "Mini One",
    state: "Printing",
    job: "Desk organizer",
    progress: 68,
    remaining: "42 min",
    material: "PLA · Tangerine",
  },
  {
    id: "2",
    name: "Mini Two",
    state: "Printing",
    job: "Planter trio",
    progress: 32,
    remaining: "1h 24m",
    material: "PLA · Seafoam",
  },
  {
    id: "3",
    name: "Mini Three",
    state: "Ready",
    job: "Ready for the next idea",
    progress: 0,
    remaining: "—",
    material: "PLA · Cloud white",
  },
  {
    id: "4",
    name: "Mini Four",
    state: "Offline",
    job: "Waiting for a connection",
    progress: 0,
    remaining: "—",
    material: "No filament assigned",
  },
];
const initialJobs: Job[] = [
  {
    id: "a",
    name: "Cable clips · set of 6",
    material: "Cloud white PLA",
    time: "28 min",
    printer: "Mini Three",
  },
  {
    id: "b",
    name: "Headphone stand",
    material: "Tangerine PLA",
    time: "2h 10m",
    printer: "Mini One",
  },
  {
    id: "c",
    name: "Gridfinity bin",
    material: "Seafoam PLA",
    time: "56 min",
    printer: "Mini Two",
  },
];
const initialSpools: Spool[] = [
  { id: "a", name: "Tangerine", color: "#ed8225", remaining: 640 },
  { id: "b", name: "Seafoam", color: "#62b5ae", remaining: 380 },
  { id: "c", name: "Cloud white", color: "#d9dedc", remaining: 820 },
  { id: "d", name: "Midnight", color: "#233e56", remaining: 120 },
];
function useSaved<T>(key: string, initial: T, enabled = true) {
  const [value, setValue] = useState<T>(() => {
    try {
      if (!enabled) return initial;
      const saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    if (enabled) localStorage.setItem(key, JSON.stringify(value));
  }, [key, value, enabled]);
  return [value, setValue] as const;
}
const tabs = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Printers", icon: Printer },
  { name: "Orders", icon: ShoppingBag },
  { name: "Library", icon: Boxes },
  { name: "Queue", icon: Layers3 },
  { name: "Filament", icon: Disc3 },
  { name: "Settings", icon: Settings },
];
function tabFromPath() {
  const segment = window.location.pathname.split("/")[1] || "";
  const match = tabs.find((t) => t.name.toLowerCase() === segment.toLowerCase());
  if (match) return match.name;
  return new URLSearchParams(window.location.search).get("view") === "orders" || window.matchMedia("(max-width: 760px)").matches ? "Orders" : "Overview";
}
function App() {
  const remote = window.location.hostname === "spoolside.shelbyklein.com";
  const live = useLiveWorkspace(remote);
  const opener = useRef<HTMLElement | null>(null);
  // Each tab has its own address (/orders, /library, …) so pages can be bookmarked and the back button works.
  const setTab = (name: string) => {
    const path = "/" + name.toLowerCase();
    if (window.location.pathname !== path) window.history.pushState(null, "", path);
    setTabState(name);
  };
  useEffect(() => {
    const onPop = () => setTabState(tabFromPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const [tab, setTabState] = useState(tabFromPath),
    [demoMachines, setMachines] = useSaved(
      "spoolside-machines-v1",
      initialMachines,
      !remote,
    ),
    [demoJobs, setDemoJobs] = useSaved(
      "spoolside-jobs-v1",
      initialJobs,
      !remote,
    ),
    [demoOrders, setDemoOrders] = useSaved<Order[]>(
      "spoolside-orders-v1",
      initialOrders,
      !remote,
    ),
    [demoSpools, setDemoSpools] = useSaved(
      "spoolside-spools-v1",
      initialSpools,
      !remote,
    );
  const machines = remote ? live.data.machines : demoMachines,
    jobs = remote ? live.data.jobs : demoJobs,
    orders = remote ? live.data.orders : demoOrders,
    spools = remote ? live.data.spools : demoSpools;
  const setJobs = (value: Job[]) =>
    remote ? live.update("jobs", value) : setDemoJobs(value);
  const setOrders = (value: Order[]) =>
    remote ? live.update("orders", value) : setDemoOrders(value);
  const setSpools = (value: Spool[]) =>
    remote ? live.update("spools", value) : setDemoSpools(value);
  const [focusedOrder, setFocusedOrder] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null),
    [adding, setAdding] = useState(false),
    [notice, setNotice] = useState(""),
    [filter, setFilter] = useState("All printers"),
    [online, setOnline] = useState(navigator.onLine),
    [hosted, setHosted] = useState(false),
    [install, setInstall] = useState<any>(null);
  useEffect(() => {
    fetch("/api/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setHosted(data?.host === "beelink"))
      .catch(() => {});
  }, []);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    const prompt = (e: Event) => {
      e.preventDefault();
      setInstall(e);
    };
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    window.addEventListener("beforeinstallprompt", prompt);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
      window.removeEventListener("beforeinstallprompt", prompt);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!selected) opener.current?.focus();
  }, [selected]);
  const openDetail = (id: string) => {
    opener.current = document.activeElement as HTMLElement;
    setSelected(id);
  };
  const printing = machines.filter((m) => m.state === "Printing").length,
    active =
      machines.find((m) => m.state === "Printing" || m.state === "Paused") ||
      machines[0],
    current = machines.find((m) => m.id === selected);
  const toggle = (id: string) => {
    if (remote) {
      setNotice("Live printer controls are not enabled yet.");
      return;
    }
    setMachines(
      machines.map((m) =>
        m.id === id
          ? { ...m, state: m.state === "Printing" ? "Paused" : "Printing" }
          : m,
      ),
    );
    setNotice("Demo printer state updated. No command sent to a printer.");
  };
  const removeJob = (id: string) => {
    if (jobs.find((j) => j.id === id)?.orderId) {
      setNotice(
        "Linked order jobs stay in the production record. Mark a failed print in Orders instead.",
      );
      return;
    }
    setJobs(jobs.filter((j) => j.id !== id));
    setNotice(
      remote
        ? "Job removed from the production queue."
        : "Job removed from your demo queue.",
    );
  };
  const overviewOrders = orders.filter(isOpenOrder);
  const queueJobs = jobs.filter(
    (j) =>
      !j.orderId ||
      (orders.some((o) => o.id === j.orderId && productionAllowed(o)) &&
        (j.state === "Queued" || j.state === "Printing")),
  );
  const queue = (
    <section className="panel queue">
      <div className="section-top">
        <div>
          <h2>Up next</h2>
        </div>
        <button
          className="text-button"
          onClick={() => {
            setTab("Queue");
            setAdding(true);
          }}
        >
          <Plus size={16} /> Add job
        </button>
      </div>
      {adding && (
        <form
          className="job-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (!String(f.get("name")).trim()) {
              setNotice("Enter a job name before adding it to the queue.");
              return;
            }
            setJobs([
              ...jobs,
              {
                id: crypto.randomUUID(),
                name: String(f.get("name")).trim(),
                material: String(f.get("material")),
                time: String(f.get("time")),
                printer: String(f.get("printer")),
              },
            ]);
            setAdding(false);
            setNotice(
              remote
                ? "Added to the production queue."
                : "Added to your demo queue.",
            );
          }}
        >
          <label>
            Job name
            <input
              name="name"
              required
              maxLength={80}
              placeholder="What are we making?"
            />
          </label>
          <label>
            Filament
            {spools.length ? <select name="material">{spools.map(s => <option key={s.id}>{s.name}</option>)}</select> : <input name="material" required placeholder="Material and color, e.g. Black PLA" maxLength={100} />}
          </label>
          <label>
            Printer
            <select name="printer">
              {machines.map((m) => (
                <option key={m.id}>{m.name}</option>
              ))}
            </select>
          </label>
          <label>
            Estimated time
            <input name="time" required defaultValue="30 min" />
          </label>
          <div>
            <button className="primary" type="submit">
              Add to queue
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {queueJobs.length === 0 ? (
        <div className="empty">
          <Layers3 />
          <h3>Queue empty</h3>
        </div>
      ) : (
        <div className="job-list">
          {queueJobs.map((j, i) => (
            <div className="job-row" key={j.id}>
              <span className="job-number">{i + 1}</span>
              <div className="job-copy">
                <strong>{j.name}</strong>
                <span>
                  {j.material} <b>·</b> {j.printer}
                  {j.orderId && (
                    <>
                      {" "}
                      <b>·</b> {j.units} units · {j.state}
                    </>
                  )}
                </span>
              </div>
              <span className="job-time">
                <Clock3 size={14} />
                {j.time}
              </span>
              {j.orderId && tab === "Queue" && (
                <button
                  className="text-button"
                  onClick={() => {
                    setFocusedOrder(j.orderId || null);
                    setTab("Orders");
                  }}
                >
                  View order
                </button>
              )}
              {tab === "Queue" && (
                <>
                  <button
                    className="icon-button"
                    aria-label={`Move ${j.name} up`}
                    disabled={i === 0}
                    onClick={() => {
                      const next = [...jobs];
                      const currentIndex = next.findIndex(
                        (job) => job.id === j.id,
                      );
                      const previousIndex = next.findIndex(
                        (job) => job.id === queueJobs[i - 1].id,
                      );
                      [next[previousIndex], next[currentIndex]] = [
                        next[currentIndex],
                        next[previousIndex],
                      ];
                      setJobs(next);
                    }}
                  >
                    <ArrowUp size={17} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={!!j.orderId}
                    title={
                      j.orderId
                        ? "Manage linked print jobs in Orders"
                        : undefined
                    }
                    aria-label={`Remove ${j.name}`}
                    onClick={() => removeJob(j.id)}
                  >
                    <Trash2 size={17} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {tab === "Overview" && (
        <button className="queue-link" onClick={() => setTab("Queue")}>
          View your queue <ArrowUpRight size={16} />
        </button>
      )}
    </section>
  );
  const filament = (
    <section className="panel filament">
      <div className="section-top">
        <div>
          <h2>Filament</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Manage filament"
          onClick={() => setTab("Filament")}
        >
          <ArrowUpRight size={19} />
        </button>
      </div>
      {spools.length === 0 && <div className="empty"><p>No filament recorded.</p></div>}
      {spools.map((s) => (
        <div className="spool-row" key={s.id}>
          <div
            className="spool-disc"
            style={{ "--spool": s.color } as React.CSSProperties}
          >
            <span />
          </div>
          <div className="spool-copy">
            <strong>{s.name}</strong>
            <span>Bambu PLA Basic</span>
          </div>
          {tab === "Filament" ? (
            <label className="grams">
              <input
                aria-label={`${s.name} remaining grams`}
                type="number"
                min="0"
                max="1000"
                value={s.remaining}
                onChange={(e) =>
                  setSpools(
                    spools.map((p) =>
                      p.id === s.id
                        ? {
                            ...p,
                            remaining: Math.min(
                              1000,
                              Math.max(0, Number(e.target.value)),
                            ),
                          }
                        : p,
                    ),
                  )
                }
              />{" "}
              g
            </label>
          ) : (
            <span className={s.remaining < 150 ? "low" : ""}>
              {s.remaining} g {s.remaining < 150 && <small>Running low</small>}
            </span>
          )}
        </div>
      ))}
      <div className="filament-note">
        <Disc3 size={16} />{" "}
        {spools.reduce((n, s) => n + s.remaining, 0).toLocaleString()} g of
        possibility
      </div>
    </section>
  );
  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Spoolside home">
          <img src="/icon-192.png" alt="" />
          <span>
            spoolside<span className="brand-dot">.</span>
          </span>
        </a>
        <nav aria-label="Main navigation">
          {tabs.map((t) => (
            <button
              key={t.name}
              className={tab === t.name ? "nav-item selected" : "nav-item"}
              onClick={() => {
                setTab(t.name);
                setSelected(null);
              }}
            >
              <t.icon size={20} />
              <span>{t.name}</span>
              {t.name === "Queue" && <small>{queueJobs.length}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <img
            src="/spoolside.png"
            alt="A navy filament figure relaxing on an orange spool in turquoise water"
          />
          <button
            onClick={() => {
              setTab("Settings");
              setNotice("Connection setup is explained in Settings.");
            }}
          >
            <CircleHelp size={16} /> Getting connected{" "}
            <ArrowUpRight size={14} />
          </button>
          <span className="version">Spoolside · early access</span>
        </div>
      </aside>
      <main>
        <div className="main-content">
          <div className="page-heading">
            <div>
              <h1>{tab}</h1>
            </div>
            <div className="page-actions">
              {remote && tab !== "Library" && (
                <button
                  className={`secondary icon-only${refreshing ? " spinning" : ""}`}
                  aria-label="Refresh orders"
                  title={live.data.lastSync ? "Store checked " + new Date(live.data.lastSync).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Refresh orders"}
                  disabled={refreshing}
                  onClick={async () => {
                    setRefreshing(true);
                    try { await live.sync(); } finally { setRefreshing(false); }
                  }}
                >
                  <RefreshCw size={17} />
                </button>
              )}
              {!["Settings", "Orders", "Library"].includes(tab) && (
                <button
                  className="secondary"
                  onClick={() => {
                    setTab("Queue");
                    setAdding(true);
                  }}
                >
                  <Plus size={17} /> Add to queue
                </button>
              )}
            </div>
          </div>
          {remote && live.error && (
            <div className="live-error" role="alert">
              <span>{live.error}</span>
              <button onClick={live.retry}>Retry</button>
              <button onClick={live.reload}>Reload server state</button>
            </div>
          )}
          {remote && live.data.syncError && (
            <div className="live-error" role="status">
              {live.data.syncError}. Last successful orders are retained.
            </div>
          )}
          {remote && live.loading && (
            <div className="empty">Loading…</div>
          )}
          {!online && (
            <div className="offline-note">
              {remote
                ? "You’re offline. Live data cannot refresh and production changes cannot be saved until connection returns."
                : "You’re offline. Your saved demo workspace is still available."}
            </div>
          )}
          <div className={tab === "Overview" ? "overview-split" : undefined}>
          {tab === "Overview" && (
            <section className="overview-orders" aria-label="PlayCase orders overview">
              <div className="section-top">
                <div><h2>PlayCase orders <span className="order-count">{remote && live.loading ? "—" : overviewOrders.length}</span></h2></div>
                <button className="text-button" onClick={() => {setFocusedOrder(null);setTab("Orders");}}>View orders <ArrowUpRight size={16} /></button>
              </div>
              <div className="orders-list">
                {remote && live.loading ? <div className="empty"><p>Loading orders…</p></div> : overviewOrders.length === 0 ? <div className="empty"><p>{remote && !live.data.lastSync ? "Waiting for store sync." : "No open orders."}</p></div> : overviewOrders.slice(0,5).map(order => {
                  return <OrderRow key={order.id} order={order} />;
                })}
              </div>
              {overviewOrders.length > 5 && <p className="overview-order-more">Showing 5 of {overviewOrders.length} open orders.</p>}
            </section>
          )}
          {(tab === "Overview" || tab === "Printers") && (
            <div className="fleet-column">
              <div className="fleet-heading">
                <h2>
                  Your printers <span>{machines.length}</span>
                </h2>
                <select
                  aria-label="Filter printers"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option>All printers</option>
                  <option>Printing</option>
                  <option>Ready</option>
                  <option>Offline</option>
                  <option>Paused</option>
                </select>
              </div>
              <div
                className={
                  filter === "All printers"
                    ? "fleet-layout"
                    : "fleet-layout filtered"
                }
              >
                {filter === "All printers" && active && (
                  <section className="featured">
                    <div className="feature-top">
                      <span className={`status ${active.state.toLowerCase()}`}>
                        <span />
                        {active.state}
                      </span>
                      <button
                        className="feature-details"
                        onClick={() => openDetail(active.id)}
                      >
                        View printer <ArrowUpRight size={16} />
                      </button>
                    </div>
                    <div className="feature-body">
                      <div>
                        <h3>{active.name}</h3>
                        <span className="model">Bambu Lab A1 mini</span>
                        <h4>{active.job}</h4>
                        <p>
                          {remote ? "Live LAN telemetry" : <>{active.material} <span>·</span> 0.20 mm layers</>}
                        </p>
                      </div>
                      {!remote && <div className="print-object" aria-hidden="true">
                        <div className="object-top" />
                        <div className="object-body">
                          <span />
                          <span />
                          <span />
                        </div>
                        <div className="object-base" />
                      </div>}
                    </div>
                    <div className="progress-heading">
                      <strong>
                        {active.progress}
                        <span>%</span>
                      </strong>
                      <span>
                        <Clock3 size={14} /> {active.remaining} left
                      </span>
                    </div>
                    <div className="progress-track">
                      <span style={{ width: `${active.progress}%` }} />
                    </div>
                    <div className="feature-bottom">
                      <span>
                        <Thermometer size={16} />
                        <b>
                          {remote
                            ? active.nozzle == null
                              ? "—"
                              : Math.round(active.nozzle) + "°"
                            : "220°"}
                        </b>{" "}
                        nozzle <i />{" "}
                        <b>
                          {remote
                            ? active.bed == null
                              ? "—"
                              : Math.round(active.bed) + "°"
                            : "60°"}
                        </b>{" "}
                        bed
                      </span>
                      <button
                        disabled={
                          !remote &&
                          !["Printing", "Paused"].includes(active.state)
                        }
                        onClick={() => (remote ? openDetail(active.id) : toggle(active.id))}
                      >
                        {active.state === "Paused" || (remote && active.state === "Ready") ? (
                          <Play size={16} />
                        ) : (
                          <Pause size={16} />
                        )}{" "}
                        {remote
                          ? ["Printing", "Paused", "Preparing"].includes(active.state) ? "Controls" : "Start print"
                          : active.state === "Paused"
                            ? "Resume"
                            : "Pause"}
                      </button>
                    </div>
                  </section>
                )}
                <section className="printer-list" aria-label="Printer list">
                  {machines
                    .filter(
                      (m) => filter === "All printers" || m.state === filter,
                    )
                    .map((m) => (
                      <button
                        className={`printer-row ${m.id === active.id ? "active-row" : ""}`}
                        key={m.id}
                        onClick={() => openDetail(m.id)}
                      >
                        <span className="printer-symbol">
                          <Printer size={27} />
                        </span>
                        <span className="printer-copy">
                          <strong>{m.name}</strong>
                          <span>{m.job}</span>
                          {(m.state === "Printing" || m.state === "Paused") && (
                            <span className="mini-progress">
                              <i style={{ width: `${m.progress}%` }} />
                            </span>
                          )}
                        </span>
                        <span className="printer-state">
                          <span className={`status ${m.state.toLowerCase()}`}>
                            <span />
                            {m.state}
                          </span>
                          <small>
                            {m.progress
                              ? `${m.progress}% · ${m.remaining}`
                              : "A1 mini"}
                          </small>
                        </span>
                        <ChevronRight size={17} />
                      </button>
                    ))}
                  {machines.filter(
                    (m) => filter === "All printers" || m.state === filter,
                  ).length === 0 && (
                    <div className="empty">
                      <p>No printers in this state.</p>
                    </div>
                  )}
                </section>
              </div>
            </div>
          )}
          </div>
          {tab === "Printers" && remote && <PrintLibrary notify={setNotice} />}
          {(tab === "Overview" || tab === "Queue" || tab === "Filament") && (
            <div
              className={tab === "Overview" ? "bottom-grid" : "single-section"}
            >
              {tab !== "Filament" && queue}
              {tab !== "Queue" && filament}
            </div>
          )}
          {tab === "Library" && <AssetLibrary notify={setNotice} />}
          {tab === "Orders" && (
            <Orders
              openOrderId={focusedOrder}
              live={remote}
              orders={orders}
            />
          )}
          {tab === "Settings" && (
            <section className="settings panel">
              <h2>
                {remote ? "Live connections" : "Bring your printers online"}
              </h2>
              {!remote && (
                <>
                  <ol>
                    <li>
                      Run the bridge on an always-on Mac, PC, or Raspberry Pi on
                      the printer network.
                    </li>
                    <li>
                      Pair each printer with its LAN IP, serial number, and
                      access code.
                    </li>
                    <li>Link the bridge to your private online workspace.</li>
                  </ol>
                  <div className="connection-note">
                    <WifiOff size={20} />
                    <div>
                      <strong>Live connection is coming next</strong>
                      <p>
                        No printers are paired. Don’t enter printer credentials
                        in this demo.
                      </p>
                    </div>
                  </div>
                </>
              )}
              <h2>PlayCase orders</h2>
              <p>{remote ? "playcase.gg · read-only" : "Sample orders"}</p>
              <button className="secondary" onClick={() => setTab("Orders")}>
                <ShoppingBag size={16} /> View orders
              </button>
              {remote && <NotificationSettings />}
              <h2>Install Spoolside</h2>
              <p>Safari → Share → Add to Home Screen.</p>
              {install && (
                <button
                  className="primary"
                  onClick={async () => {
                    await install.prompt();
                    setInstall(null);
                  }}
                >
                  <Download size={16} /> Install app
                </button>
              )}
              {hosted && (
                <>
                  <h2>Account</h2>
                  <form
                    method="post"
                    action="/logout"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const response = await fetch("/logout", {
                        method: "POST",
                        credentials: "same-origin",
                      }).catch(() => null);
                      if (!response?.ok) {
                        setNotice("Sign-out failed. Please try again.");
                        return;
                      }
                      await Promise.all(
                        (await navigator.serviceWorker.getRegistrations()).map(
                          (r) => r.unregister(),
                        ),
                      );
                      await Promise.all(
                        (await caches.keys()).map((k) => caches.delete(k)),
                      );
                      window.location.replace("/login");
                    }}
                  >
                    <button className="secondary" type="submit">
                      Sign out
                    </button>
                  </form>
                </>
              )}
              {!remote && (
                <>
                  <h2>Demo workspace</h2>
                  <p>
                    Queue, filament, and simulated printer changes are saved
                    only in this browser.
                  </p>
                  <button
                    className="secondary"
                    onClick={() => {
                      if (
                        window.confirm(
                          "Reset demo printers, orders, queue, and filament to their starting values?",
                        )
                      ) {
                        setMachines(initialMachines);
                        setJobs(initialJobs);
                        setSpools(initialSpools);
                        setOrders(initialOrders);
                        setNotice("Demo workspace reset.");
                      }
                    }}
                  >
                    <RotateCcw size={16} /> Reset demo data
                  </button>
                </>
              )}
            </section>
          )}
          <footer>
            <span>
              <span className="tiny-dot" />{" "}
              {online ? "Online" : "Offline"}
            </span>
          </footer>
        </div>
      </main>
      {current && (
        <div className="detail-overlay" onClick={() => setSelected(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label={`${current.name} details`}
            className="detail-panel"
            onKeyDown={(e) => {
              if (e.key === "Escape") setSelected(null);
              if (e.key === "Tab") {
                const nodes =
                  e.currentTarget.querySelectorAll<HTMLButtonElement>("button");
                const first = nodes[0],
                  last = nodes[nodes.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              autoFocus
              className="close icon-button"
              aria-label="Close printer details"
              onClick={() => setSelected(null)}
            >
              <X />
            </button>
            <Printer size={38} />
            <h2>{current.name}</h2>
            <p>Bambu Lab A1 mini</p>
            <span className={`status ${current.state.toLowerCase()}`}>
              <span />
              {current.state}
            </span>
            <h3>{current.job}</h3>
            <dl>
              <div>
                <dt>Progress</dt>
                <dd>{current.progress}%</dd>
              </div>
              <div>
                <dt>Time remaining</dt>
                <dd>{current.remaining}</dd>
              </div>
              <div>
                <dt>Filament</dt>
                <dd>{current.material}</dd>
              </div>
              <div>
                <dt>Nozzle / bed</dt>
                <dd>
                  {current.state === "Printing" || current.state === "Paused"
                    ? remote
                      ? `${current.nozzle ?? "—"}°C / ${current.bed ?? "—"}°C`
                      : "220°C / 60°C"
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>Connection</dt>
                <dd>
                  {remote
                    ? current.stale || !current.connected
                      ? "Stale / disconnected"
                      : "Live LAN"
                    : "Demo · simulated"}
                </dd>
              </div>
            </dl>
            {!remote &&
              (current.state === "Printing" || current.state === "Paused") && (
                <button className="primary" onClick={() => toggle(current.id)}>
                  {current.state === "Printing" ? (
                    <Pause size={17} />
                  ) : (
                    <Play size={17} />
                  )}{" "}
                  {current.state === "Printing"
                    ? "Pause demo print"
                    : "Resume demo print"}
                </button>
              )}
            {remote && <PrintControls machine={current} notify={setNotice} />}
            <p className="detail-note">
              {remote ? `Last report: ${current.seen ? new Date(current.seen).toLocaleTimeString() : "not received"}. ${current.error || ""}` : "These readings are examples. Live printer controls will be available after a bridge is connected."}
            </p>
            <button className="text-button" onClick={() => setSelected(null)}>
              Back to workspace
            </button>
          </section>
        </div>
      )}
      {notice && (
        <div role="status" className="toast">
          <Check size={18} />
          {notice}
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
