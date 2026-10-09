import { useAppUpdates, RefreshAppButton } from "./AppUpdates";
import { FloatingSpool } from "./FloatingSpool";
import { OrderQueue } from "./OrderQueue";
import { FilamentManager, materialName } from "./FilamentManager";
import { PrintControls, PrintLibrary } from "./PrintControls";
import { AssetLibrary } from "./AssetLibrary";
import { WaterBackground } from "./WaterBackground";
import { WaterHome } from "./WaterHome";
import { PrinterCards } from "./PrinterCards";
import { OrderPrintDialog, OfferCards, AutoPrintSetting, useDispatch, type Offer } from "./OrderPrint";
import type { PrintGroup } from "./order-model";
import { SpoolList } from "./LoadedSpools";
import { useWatches, WatchAttention, WatchStatus, RecentPrints } from "./PrintWatch";
import { AppErrorBoundary } from "./recovery";
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
  WifiOff,
  RefreshCw,
  Boxes,
  Clock3,
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
  return new URLSearchParams(window.location.search).get("view") === "orders" ? "Orders" : "Overview";
}
function App() {
  const appUpdates = useAppUpdates();
  const remote = window.location.hostname === "spoolside.shelbyklein.com";
  const live = useLiveWorkspace(remote);
  const watch = useWatches(remote);
  const dispatch = useDispatch(remote);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => document.documentElement.classList.add("ready"), []);
  useEffect(() => {
    // Safari can ignore viewport zoom limits; prevent its page-level pinch gesture.
    const stopZoom = (event: Event) => { if (matchMedia("(max-width: 760px)").matches) event.preventDefault(); };
    document.addEventListener("gesturestart", stopZoom, { passive: false });
    document.addEventListener("gesturechange", stopZoom, { passive: false });
    return () => {
      document.removeEventListener("gesturestart", stopZoom);
      document.removeEventListener("gesturechange", stopZoom);
    };
  }, []);
  // The water only runs where the full sidebar shows; phones get the plain tab bar.
  const [wideScreen, setWideScreen] = useState(() => matchMedia("(min-width: 761px)").matches);
  useEffect(() => {
    const mq = matchMedia("(min-width: 761px)");
    const on = () => setWideScreen(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
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
  const updateOrder = (next: Order) => setOrders(orders.map((o) => (o.id === next.id ? next : o)));
  // Order print buttons (live only): a dialog to send the next piece, and ticking pieces by hand.
  const [printing, setPrinting] = useState<{ orderId: string; group: PrintGroup; printer?: string } | null>(null);
  const printOffer = (o: Offer) => {
    const group = orders.find((x) => x.id === o.orderId)?.printPlan?.find((g) => g.key === o.group);
    if (group?.next) setPrinting({ orderId: o.orderId, group, printer: o.printer });
    else setNotice("That order changed. Refresh and try again.");
  };
  const dismissOffer = (o: Offer) => dispatch.dismiss(o.printer).catch((e) => setNotice(e.message));
  const offers = remote ? <OfferCards offers={dispatch.offers} held={dispatch.held} onPrint={printOffer} onDismiss={dismissOffer} /> : null;
  const printOrder = remote ? (order: Order, group: PrintGroup) => setPrinting({ orderId: order.id, group }) : undefined;
  const tickPiece = remote
    ? async (order: Order, assetId: string, done: number) => {
        const r = await fetch(`/api/orders/${order.id}/pieces`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assetId, done }) });
        if (!r.ok) setNotice((await r.json().catch(() => ({}))).error || "Couldn't save");
        live.retry();
      }
    : undefined;
  const printingOrder = printing && orders.find((o) => o.id === printing.orderId);
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
  const current = machines.find((m) => m.id === selected);
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
  // The overview lists the oldest open orders first: the next ones to fulfill.
  const orderNumber = (o: Order) => Number(o.number.replace(/\D/g, "")) || 0;
  const nextOrders = [...overviewOrders].sort((a, b) => orderNumber(a) - orderNumber(b)).slice(0, 10);
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
            setAdding(!remote);
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
            <span>{s.materialId ? materialName(s.materialId) : "Unassigned material"}</span>
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
        {spools.reduce((n, s) => n + s.remaining, 0).toLocaleString()} g remaining
      </div>
    </section>
  );
  return (
    <div className="app">
      {appUpdates.available && <div className="app-update" role="status"><span>A new Spoolside version is ready.</span><RefreshAppButton checking={appUpdates.checking} refresh={appUpdates.refresh} /></div>}
      <aside className="sidebar">
        {wideScreen && <WaterBackground />}
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
              {t.name === "Queue" && <small>{remote ? (live.data.printQueue || []).length : queueJobs.length}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <FloatingSpool />
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
        {!wideScreen && tab === "Overview" ? (
          <WaterHome bedsToClear={(dispatch.held || []).map(h => h.printer)} attention={<>{remote && <NotificationSettings compact />}<OfferCards water offers={dispatch.offers} onPrint={printOffer} onDismiss={dismissOffer} /><WatchAttention water watches={watch.watches} refresh={() => { watch.refresh(); live.retry(); dispatch.refresh(); }} notify={setNotice} /></>} machines={machines} orders={overviewOrders} loading={remote && live.loading} openPrinter={setSelected} openOrder={(id) => { setFocusedOrder(id); setTab("Orders"); }} go={(t) => { setSelected(null); setFocusedOrder(null); setTab(t); }} />
        ) : (
        <div className="main-content">
          <div className="page-heading">
            <div>
              <h1>{tab}</h1>
            </div>
            <div className="page-actions">
              {/* Pages put their own header controls here (Library's section tabs). */}
              <div id="page-heading-slot" className="page-heading-slot" />
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
              {!["Settings", "Orders", "Library"].includes(tab) && !(remote && tab === "Queue") && (
                <button
                  className="secondary"
                  onClick={() => {
                    setTab("Queue");
                    setAdding(!remote);
                  }}
                >
                  <Plus size={17} /> {remote ? "Print queue" : "Add to queue"}
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
                {remote && live.loading ? <div className="empty"><p>Loading orders…</p></div> : overviewOrders.length === 0 ? <div className="empty"><p>{remote && !live.data.lastSync ? "Waiting for store sync." : "No open orders."}</p></div> : nextOrders.map(order => {
                  return <OrderRow key={order.id} order={order} onChange={updateOrder} onPrint={printOrder} onTick={tickPiece} />;
                })}
              </div>
              {overviewOrders.length > 10 && <p className="overview-order-more">Showing the 10 oldest of {overviewOrders.length} open orders.</p>}
            </section>
          )}
          {(tab === "Overview" || tab === "Printers") && (
            <div className="fleet-column">
              {remote && <NotificationSettings compact />}
              {offers}
              {remote && <WatchAttention watches={watch.watches} refresh={() => { watch.refresh(); live.retry(); dispatch.refresh(); }} notify={setNotice} />}
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
              <PrinterCards
                machines={machines.filter((m) => filter === "All printers" || m.state === filter)}
                live={remote}
                onOpen={openDetail}
              />
            </div>
          )}
          </div>
          {tab === "Printers" && remote && <PrintLibrary notify={setNotice} />}
          {(tab === "Overview" || tab === "Queue" || tab === "Filament") && (
            <div
              className={tab === "Overview" && !remote ? "bottom-grid" : "single-section"}
            >
              {tab !== "Filament" && (remote ? <OrderQueue entries={live.data.printQueue || []} orders={orders} abbreviated={tab === "Overview"} onPrint={printOrder!} onOpen={() => setTab("Queue")} /> : queue)}
              {tab === "Filament" && remote ? <FilamentManager notify={setNotice} machines={machines}/> : tab !== "Queue" && !remote && filament}
            </div>
          )}
          {tab === "Library" && <AssetLibrary notify={setNotice} />}
          {tab === "Orders" && (
            <Orders
              openOrderId={focusedOrder}
              live={remote}
              orders={orders}
              onOrderChange={updateOrder}
              onPrint={printOrder}
              onTick={tickPiece}
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
              {remote && <AutoPrintSetting auto={dispatch.auto} vision={dispatch.vision} onChange={(on) => dispatch.setAuto(on).then(() => setNotice(on ? "Automatic printing is on." : "Automatic printing is off.")).catch((e) => setNotice(e.message))} />}
              <h2>App updates</h2>
              <p>Checks for updates when you reopen the app. Refresh here to get the latest version now.</p>
              <RefreshAppButton checking={appUpdates.checking} refresh={appUpdates.refresh} />
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
        )}
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
                <dd>{remote ? <SpoolList machine={current} /> : current.material}</dd>
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
            {remote && <WatchStatus watch={watch.watches.find((w) => w.printer === current.id && !w.ended)} vision={watch.vision} />}
            {remote && <RecentPrints printer={current.id} recent={watch.recent || []} refresh={() => { watch.refresh(); live.retry(); dispatch.refresh(); }} notify={setNotice} />}
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
      {printing && printingOrder && printing.group.next && (
        <OrderPrintDialog order={printingOrder} group={printing.group} printer={printing.printer} machines={machines} notify={setNotice} onClose={() => setPrinting(null)} onSent={() => { live.retry(); dispatch.refresh(); }} />
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
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
