import { reportAnthropicUsage } from "./tokenusage.mjs";
import { DatabaseSync } from "node:sqlite";

// Store colorway names to the color looked for among loaded spools (matches the app's print dialog).
const COLORWAYS = {
  red: "#e0201b", green: "#3baa35", blue: "#2f6fd6", black: "#111111", grey: "#8a8a8a", gray: "#8a8a8a", white: "#f2f2f2",
  orange: "#f07818", purple: "#7e3fb5", pink: "#f06eaa", yellow: "#f5d000", teal: "#0f8c8c",
};
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0);
const distance = (a, b) => rgb(a).reduce((n, v, i) => n + (v - rgb(b)[i]) ** 2, 0);
export const FAR = 20000;
const MATERIAL = "bambu-tpu-ams"; // for now, only Bambu TPU for AMS spools are matched
const IDLE = ["IDLE", "FINISH", "FAILED"];
const SNOOZE = 60 * 60000;
const RECHECK = 5 * 60000; // a bed that wasn't clear (or was too dark) is looked at again this often
const RETRY = 10 * 60000;
const orderNumber = (o) => Number(String(o.number).replace(/\D/g, "")) || 0;

// Notices when a printer is free and an order needs a piece it can print (a Bambu TPU for AMS spool
// close to the order's colorway is loaded), offers it to you, and with automatic printing on, starts it
// itself, but only after the printer's last print was answered and a camera check sees an empty bed.
export class Dispatcher {
  constructor(dbFile, { printers, plans, library, orderPrints, watcher, notifications, bedCheck = null, shrink, now = Date.now }) {
    Object.assign(this, { printers, plans, library, orderPrints, watcher, notifications, bedCheck, shrink, now });
    this.db = new DatabaseSync(dbFile);
    this.db.exec("CREATE TABLE IF NOT EXISTS dispatch_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    this.offers = new Map(); // printer -> offer
    this.snoozed = new Map(); // printer -> { offerId, until }
    this.tried = new Map(); // offerId -> { at, reason }
    this.beds = new Map(); // printer -> { key, at, empty, reason }: the last camera check of the bed
    this.held = new Map(); // printer -> { printerName, reason }: free, but the bed check says no
    this.busy = false;
  }
  close() {
    this.db.close();
  }
  get auto() {
    return this.db.prepare("SELECT value FROM dispatch_settings WHERE key='auto'").get()?.value === "1";
  }
  setAuto(on) {
    if (typeof on !== "boolean") throw Error("Choose on or off");
    this.db.prepare("INSERT INTO dispatch_settings VALUES ('auto', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(on ? "1" : "0");
    this.tried.clear();
    return this.view();
  }
  // The best piece this printer could print now, or null.
  candidate(view, taken) {
    const trays = (view.trays || []).filter((t) => t.materialId === MATERIAL && t.color);
    if (!trays.length) return null;
    const work = this.plans()
      .filter(({ order }) => String(order.commercial).toLowerCase() === "processing" && !order.refundReview && !order.sourceReview && !order.assembled)
      .sort((a, b) => orderNumber(a.order) - orderNumber(b.order));
    for (const { order, plan } of work) {
      const target = COLORWAYS[String(order.items.find((i) => i.colorway)?.colorway || "").toLowerCase()];
      if (!target) continue;
      for (const group of plan) {
        const next = group.next;
        if (!next || taken.has(`${order.id}:${next.assetId}`)) continue;
        const plate = this.library.get(next.fileId)?.plates.find((p) => p.index === next.plate);
        if (!plate?.filaments.length || !plate.filaments.every((f) => /^TPU/i.test(f.type))) continue;
        const best = trays.map((t) => ({ t, off: distance(t.color, target) })).sort((a, b) => a.off - b.off)[0];
        if (best.off > FAR) continue;
        const slots = Math.max(...plate.filaments.map((f) => f.id));
        const colorway = order.items.find((i) => i.colorway)?.colorway;
        return {
          id: `${view.id}:${order.id}:${group.key}:${next.fileId}:${next.plate}`,
          printer: view.id, printerName: view.name, orderId: order.id, orderNumber: order.number, group: group.key, groupLabel: group.label,
          assetId: next.assetId, pieceName: next.name, fileId: next.fileId, fileName: next.fileName, plate: next.plate,
          colorway, slot: best.t.slot, mapping: Array.from({ length: slots }, () => best.t.slot),
        };
      }
    }
    return null;
  }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      // Pieces already printing, waiting for an answer, or offered elsewhere aren't offered again.
      const taken = this.watcher.inFlight();
      for (const tag of this.orderPrints.pending.values()) for (const a of tag.assetIds) taken.add(`${tag.orderId}:${a}`);
      for (const { serial, view } of this.printers.statuses()) {
        // Idle isn't free: a finished print is still on the bed until someone answers how it went.
        const last = this.watcher.lastFor(serial);
        const cleared = !last || (last.ended && last.outcome);
        const free = view.connected && IDLE.includes(view.rawState) && cleared && !this.printers.busy.has(serial) && !this.orderPrints.pending.has(serial);
        let offer = free ? this.candidate(view, taken) : null;
        // Before offering, look at the bed: an empty result holds until the next print; anything else is
        // checked again every few minutes.
        if (offer) {
          const bed = await this.lookAtBed(serial, last);
          if (!bed.empty) { this.held.set(serial, { printer: serial, printerName: view.name, reason: bed.reason }); offer = null; }
          else this.held.delete(serial);
        } else this.held.delete(serial);
        if (!offer) { this.offers.delete(serial); if (!free) this.snoozed.delete(serial); continue; }
        taken.add(`${offer.orderId}:${offer.assetId}`);
        const prior = this.offers.get(serial);
        const fresh = prior?.id !== offer.id;
        this.offers.set(serial, fresh ? { ...offer, at: this.now() } : prior);
        const snooze = this.snoozed.get(serial);
        if (snooze && (snooze.offerId !== offer.id || this.now() > snooze.until)) this.snoozed.delete(serial);
        if (this.auto && !this.snoozed.has(serial) && (await this.tryAuto(serial, this.offers.get(serial)))) continue;
        if (fresh && !this.snoozed.has(serial))
          this.notifications?.broadcast({ id: `offer:${offer.id}`, title: `${offer.printerName} is free`, body: `Print the ${offer.pieceName} for ${offer.orderNumber} (${offer.colorway})?`, url: "/" });
      }
    } catch (e) {
      console.error("Dispatcher:", e.message);
    } finally {
      this.busy = false;
    }
  }
  async lookAtBed(serial, last) {
    if (!this.bedCheck) return { empty: true, reason: "" };
    const key = last ? `${last.id}:${last.outcome}` : "none";
    const seen = this.beds.get(serial);
    if (seen?.key === key && (seen.empty || this.now() - seen.at < RECHECK)) return seen;
    let result;
    try {
      const { jpeg, brightness } = await this.shrink(await this.printers.cameraFrame(serial));
      result = brightness < 18 ? { empty: false, reason: "Too dark to see the bed" } : await this.bedCheck(jpeg, "routine");
    } catch {
      result = { empty: false, reason: "Couldn't see the bed" };
    }
    const seenNow = { key, at: this.now(), ...result };
    this.beds.set(serial, seenNow);
    return seenNow;
  }
  // Starts an offer by itself when it's safe; otherwise records why not and leaves it as a prompt.
  async tryAuto(serial, offer) {
    const last = this.tried.get(offer.id);
    if (last && this.now() - last.at < RETRY) return false;
    const block = (reason) => { this.tried.set(offer.id, { at: this.now(), reason }); offer.autoBlocked = reason; return false; };
    // Offers already wait for an answer; automatic starts also need one to exist at all.
    const previous = this.watcher.lastFor(serial);
    if (!previous?.outcome) return block("Answer how the last print went first");
    if (!this.bedCheck) return block("Camera checks need the vision key");
    let bed;
    try {
      const { jpeg, brightness } = await this.shrink(await this.printers.cameraFrame(serial));
      if (brightness < 18) return block("Too dark to check the bed");
      bed = await this.bedCheck(jpeg, "confirm");
    } catch {
      return block("Couldn't check the bed");
    }
    if (!bed.empty) return block(`Bed check: ${bed.reason}`);
    try {
      await this.start(offer);
    } catch (e) {
      return block(e.message);
    }
    this.offers.delete(serial);
    this.notifications?.broadcast({ id: `auto:${offer.id}`, title: `Started on ${offer.printerName}`, body: `${offer.pieceName} for ${offer.orderNumber} (${offer.colorway}). The bed looked empty.`, url: "/printers" });
    return true;
  }
  async start(offer) {
    const file = this.library.get(offer.fileId);
    if (!file) throw Error("Sliced print missing");
    const covered = new Set((file.plates.find((p) => p.index === offer.plate)?.coverage || []).map((c) => c.assetId));
    const plan = this.plans().find((p) => p.order.id === offer.orderId)?.plan || [];
    const assetIds = [...new Set(plan.flatMap((g) => g.pieces).filter((p) => covered.has(p.assetId) && p.done < p.needed).map((p) => p.assetId))];
    this.orderPrints.sent(offer.printer, { orderId: offer.orderId, orderNumber: offer.orderNumber, assetIds: assetIds.length ? assetIds : [offer.assetId] });
    const reservation = this.orderPrints.pending.get(offer.printer);
    try {
    await this.printers.startPrint(offer.printer, { localFile: this.library.file(file.id), name: file.name, plate: offer.plate, amsMapping: offer.mapping, useAms: true, bedLevelling: true });
    } catch (error) {
      if (this.orderPrints.pending.get(offer.printer) === reservation) this.orderPrints.cancel(offer.printer);
      throw error;
    }
  }
  dismiss(printer) {
    const offer = this.offers.get(printer);
    if (!offer) throw Object.assign(Error("No offer for that printer"), { status: 404 });
    this.snoozed.set(printer, { offerId: offer.id, until: this.now() + SNOOZE });
    return this.view();
  }
  view() {
    return {
      auto: this.auto,
      vision: !!this.bedCheck,
      offers: [...this.offers.entries()].filter(([p]) => !this.snoozed.has(p)).map(([, o]) => ({ ...o, autoBlocked: this.auto ? o.autoBlocked || null : null })),
      held: [...this.held.values()],
    };
  }
}

// Asks Claude whether the build plate in a camera photo is completely empty.
// `models` maps "routine" (offer checks) and "confirm" (right before an automatic start) to model ids.
export function claudeBedCheck(apiKey, models, fetchImpl = fetch) {
  return async (jpeg, kind = "confirm") => {
    const model = models[kind] || models.confirm;
    const r = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        system: "You check a Bambu Lab A1 mini's build plate through its fixed wide-angle camera before a print starts unattended. The bed slides front to back, so it can appear at different positions. Anything left on the plate (a finished part, a strand, a tool) will be hit by the nozzle. Say the bed is empty only if you can see the whole plate and nothing is on it. If part of the plate is out of view, too dark, or you're unsure, say it is not empty.",
        tools: [{ name: "report", description: "Report whether the build plate is empty.", input_schema: { type: "object", properties: { empty: { type: "boolean" }, reason: { type: "string", description: "One short sentence, e.g. 'A red case is still on the plate.'" } }, required: ["empty", "reason"] } }],
        tool_choice: { type: "tool", name: "report" },
        messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } }, { type: "text", text: "Is the build plate completely empty?" }] }],
      }),
      signal: AbortSignal.timeout(60000),
    });
    const body = await r.json().catch(() => ({}));
    reportAnthropicUsage({ usage: body.usage, requestId: r.headers?.get?.("request-id") || body.id, model: body.model || model, taskId: "bed-check" });
    if (!r.ok) throw Error(body.error?.message || `Vision API ${r.status}`);
    const input = body.content?.find((c) => c.type === "tool_use")?.input;
    if (typeof input?.empty !== "boolean") throw Error("Vision API gave no answer");
    return { empty: input.empty, reason: String(input.reason || "").slice(0, 200) };
  };
}
