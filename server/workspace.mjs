import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
export function variantDetails(metadata = []) {
  const values = new Map();
  for (const m of metadata) {
    if (String(m.key).startsWith("_") || typeof m.value === "object") continue;
    const key = String(m.display_key || m.key);
    const value = String(m.display_value || m.value || "").replace(/<[^>]*>/g, "");
    const prior = values.get(key);
    // PlayCase sends raw form fields followed by readable fulfillment fields.
    const technical = /<[^>]*>|\$\d|^#[0-9a-f]{6}$/i;
    if (!prior || (technical.test(prior) && !technical.test(value))) values.set(key, value);
  }
  if (values.has("Phone model")) values.delete("Phone");
  return [...values].map(([key, value]) => `${key}: ${value}`).join(" · ");
}
export function normalizeOrder(raw, prior) {
  const priorItems = new Map((prior?.items || []).map((i) => [i.id, i]));
  const sourceChanged = !!prior && JSON.stringify((raw.line_items || []).map(i => [String(i.id), i.quantity, i.product_id, i.variation_id, i.sku || "", variantDetails(i.meta_data) || i.sku || "No variant details"])) !== JSON.stringify(prior.items.map(i => [i.id, i.quantity, i.productId, i.variationId, i.sku, i.variant]));
  const sourceReview = !!prior?.sourceReview || sourceChanged;
  return {
    sourceReview,
    id: `wc-${raw.id}`,
    number: `#${raw.number || raw.id}`,
    placed: raw.date_created
      ? new Date(raw.date_created + "Z").toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        })
      : "Date unavailable",
    commercial: raw.status,
    refundReview: (raw.refunds || []).length > 0,
    refundVersion: createHash("sha256").update(JSON.stringify((raw.refunds || []).map(r => [r.id, r.total]).sort((a,b) => Number(a[0])-Number(b[0])))).digest("hex"),
    items: (raw.line_items || []).map((i) => ({
      id: String(i.id),
      name: String(i.name || "Unnamed item"),
      variant: variantDetails(i.meta_data) || i.sku || "No variant details",
      quantity: i.quantity,
      productId: i.product_id,
      variationId: i.variation_id,
      sku: i.sku || "",
      recipe: priorItems.get(String(i.id))?.recipe || [],
    })),
    assembled:
      raw.status === "processing" && !sourceReview &&
      !(raw.refunds || []).length &&
      (prior?.assembled || false),
    packed:
      raw.status === "processing" && !sourceReview &&
      !(raw.refunds || []).length &&
      (prior?.packed || false),
    tracking: prior?.tracking || "",
    shipped:
      raw.status === "processing" && !sourceReview &&
      !(raw.refunds || []).length &&
      (prior?.shipped || false),
    note: prior?.note || "",
  };
}
export const productionAllowed = (o) =>
  ["processing"].includes(o.commercial) && !o.refundReview && !o.sourceReview;
export class Workspace {
  constructor(file, { woo, fetcher = fetch } = {}) {
    this.db = new DatabaseSync(file);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);",
    );
    const row = this.db.prepare("SELECT body FROM workspace WHERE id=1").get();
    this.state = row
      ? JSON.parse(row.body)
      : {
          revision: 0,
          orders: [],
          jobs: [],
          spools: [],
          lastSync: null,
          syncError: null,
        };
    this.woo = woo;
    this.fetcher = fetcher;
    this.syncing = false;
  }
  persist() {
    this.db
      .prepare(
        "INSERT INTO workspace VALUES (1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(JSON.stringify(this.state));
  }
  async sync() {
    if (this.syncing) return;
    this.syncing = true;
    try {
      if (!this.woo) throw Error("WooCommerce connection is not configured");
      let all = [],
        page = 1,
        totalPages = 1;
      do {
        const url = new URL("/wp-json/wc/v3/orders", this.woo.url);
        url.search = new URLSearchParams({
          per_page: "100",
          page: String(page),
          orderby: "id",
          order: "desc",
          _fields: "id,number,date_created,status,line_items,refunds",
        }).toString();
        const response = await this.fetcher(url, {
          headers: {
            Authorization:
              "Basic " +
              Buffer.from(this.woo.key + ":" + this.woo.secret).toString(
                "base64",
              ),
          },
          signal: AbortSignal.timeout(20000),
        });
        if (!response.ok)
          throw Error(`WooCommerce returned HTTP ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data))
          throw Error("WooCommerce returned an invalid order list");
        all.push(...data);
        totalPages = Number(response.headers.get("x-wp-totalpages") || 1);
        if (totalPages > 100)
          throw Error("Order pagination exceeded safety limit");
        page++;
      } while (page <= totalPages);
      const previous = new Map(this.state.orders.map((o) => [o.id, o]));
      const before = this.state;
      this.state = {
        ...this.state,
        revision: this.state.revision + 1,
        orders: all.map((raw) =>
          normalizeOrder(raw, previous.get(`wc-${raw.id}`)),
        ),
        lastSync: new Date().toISOString(),
        syncError: null,
      };
      try {
        this.db.exec("BEGIN IMMEDIATE");
        this.persist();
        this.onSync?.(before.orders, this.state, !before.lastSync);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        this.state = before;
        throw error;
      }
    } catch (e) {
      this.state.syncError =
        e.message.startsWith("WooCommerce") ||
        e.message.startsWith("Order pagination")
          ? e.message
          : "Store sync failed; retained last successful snapshot";
      this.persist();
    } finally {
      this.syncing = false;
    }
  }
  snapshot() {
    return structuredClone(this.state);
  }
  update(body) {
    if (body.revision !== this.state.revision) {
      const e = Error("Workspace changed. Reload before saving.");
      e.status = 409;
      throw e;
    }
    if (
      !Array.isArray(body.orders) ||
      !Array.isArray(body.jobs) ||
      !Array.isArray(body.spools) ||
      body.jobs.length > 10000
    ) {
      throw Error("Invalid workspace payload");
    }
    const incoming = new Map(body.orders.map((o) => [o.id, o]));
    if (
      incoming.size !== this.state.orders.length ||
      body.orders.length !== incoming.size
    )
      throw Error("Source orders cannot be added or removed");
    const orders = this.state.orders.map((source) => {
      const o = incoming.get(source.id);
      if (
        !o ||
        !Array.isArray(o.items) ||
        o.items.length !== source.items.length
      )
        throw Error("Source items cannot change");
      const items = source.items.map((item) => {
        const candidate = o.items.find((i) => i.id === item.id);
        if (
          !candidate ||
          !Array.isArray(candidate.recipe) ||
          candidate.recipe.length > 8
        )
          throw Error("Invalid fulfillment components");
        const recipe = candidate.recipe.map((r) => {
          if (
            typeof r.component !== "string" ||
            !r.component.trim() ||
            r.component.length > 60 ||
            !Number.isInteger(r.units) ||
            r.units < 1 ||
            r.units > 20 ||
            typeof r.material !== "string" ||
            r.material.length > 100 ||
            typeof r.time !== "string" ||
            r.time.length > 30
          )
            throw Error("Invalid component recipe");
          return {
            component: r.component.trim(),
            units: r.units,
            material: r.material,
            time: r.time,
          };
        });
        if (
          new Set(recipe.map((r) => r.component.toLowerCase())).size !==
          recipe.length
        )
          throw Error("Duplicate component names");
        return { ...item, recipe };
      });
      for (const key of ["note", "tracking"])
        if (
          typeof o[key] !== "string" ||
          o[key].length > (key === "note" ? 1000 : 200)
        )
          throw Error("Invalid production text");
      return {
        ...source,
        items,
        sourceReview: source.sourceReview && o.sourceReview !== false,
        note: o.note,
        tracking: o.tracking,
        assembled: !!o.assembled,
        packed: !!o.packed,
        shipped: !!o.shipped,
      };
    });
    const seen = new Set();
    const jobs = body.jobs.map((j) => {
      if (
        typeof j.id !== "string" ||
        seen.has(j.id) ||
        typeof j.name !== "string" ||
        j.name.length > 150 ||
        typeof j.printer !== "string" ||
        j.printer.length > 80 ||
        typeof j.material !== "string" ||
        j.material.length > 100 ||
        typeof j.time !== "string" ||
        j.time.length > 30
      )
        throw Error("Invalid print job");
      seen.add(j.id);
      const clean = {
        id: j.id,
        name: j.name,
        printer: j.printer,
        material: j.material,
        time: j.time,
      };
      const old = this.state.jobs.find((p) => p.id === j.id);
      if (old?.orderId && (j.orderId !== old.orderId || j.itemId !== old.itemId || j.component !== old.component)) throw Error("Linked print history cannot be relinked");
      if (j.orderId && old?.orderId && JSON.stringify(j) === JSON.stringify(old)) return structuredClone(old);
      if (j.orderId) {
        const order = orders.find((o) => o.id === j.orderId),
          item = order?.items.find((i) => i.id === j.itemId),
          recipe = item?.recipe.find((r) => r.component === j.component);
        if (
          !recipe ||
          !Number.isInteger(j.units) ||
          j.units < 1 ||
          j.units > recipe.units * item.quantity ||
          !["Queued", "Printing", "Accepted", "Failed"].includes(j.state)
        )
          throw Error("Invalid order job");

        if (
          !productionAllowed(order) &&
          (!old ||
            JSON.stringify(old) !==
              JSON.stringify({
                ...clean,
                orderId: j.orderId,
                itemId: j.itemId,
                component: j.component,
                units: j.units,
                state: j.state,
              }))
        )
          throw Error(
            "Order is on hold; existing print records must be reviewed",
          );
        return {
          ...clean,
          orderId: j.orderId,
          itemId: j.itemId,
          component: j.component,
          units: j.units,
          state: j.state,
        };
      }
      return clean;
    });
    for (const old of this.state.jobs.filter((j) => j.orderId))
      if (!jobs.some((j) => j.id === old.id))
        throw Error("Linked print history cannot be removed");
    for (const order of orders) {
      for (const item of order.items)
        for (const r of item.recipe) {
          const n = jobs
            .filter(
              (j) =>
                j.orderId === order.id &&
                j.itemId === item.id &&
                j.component === r.component &&
                j.state !== "Failed",
            )
            .reduce((n, j) => n + j.units, 0);
          const previousCoverage = this.state.jobs.filter(j => j.orderId === order.id && j.itemId === item.id && j.component === r.component && j.state !== "Failed").reduce((n,j) => n + j.units, 0);
          if (n > Math.max(r.units * item.quantity, previousCoverage))
            throw Error("Required parts already have a job");
        }
      const complete =
        order.items.length > 0 &&
        order.items.every(
          (i) =>
            i.recipe.every(
              (r) =>
                jobs
                  .filter(
                    (j) =>
                      j.orderId === order.id &&
                      j.itemId === i.id &&
                      j.component === r.component &&
                      j.state === "Accepted",
                  )
                  .reduce((n, j) => n + j.units, 0) >=
                r.units * i.quantity,
            ),
        );
      if (
        (order.assembled || order.packed || order.shipped) &&
        (!complete || !productionAllowed(order))
      )
        throw Error("Order is not ready for fulfillment");
      if (
        (order.packed && !order.assembled) ||
        (order.shipped && !order.packed)
      )
        throw Error("Assembly and packing checks are required");
    }
    const spools = body.spools.map((s) => {
      if (
        typeof s.id !== "string" ||
        typeof s.name !== "string" ||
        s.name.length > 80 ||
        typeof s.color !== "string" ||
        !/^#[0-9a-fA-F]{6}$/.test(s.color) ||
        !Number.isFinite(s.remaining) ||
        s.remaining < 0 ||
        s.remaining > 1000
      )
        throw Error("Invalid filament record");
      return { id: s.id, name: s.name, color: s.color, remaining: s.remaining };
    });
    if (spools.length > 200) throw Error("Too many filament records");
    this.state = {
      ...this.state,
      revision: this.state.revision + 1,
      orders,
      jobs,
      spools,
    };
    this.persist();
    return this.snapshot();
  }
  backup(file) {
    this.db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  }
  close() {
    this.db.close();
  }
}
