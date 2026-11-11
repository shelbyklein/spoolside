import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { COLORWAYS, colorwayName, deltaE, matchesColorway } from "./colorway.mjs";
const MATERIAL = "bambu-tpu-ams"; // for now, only Bambu TPU for AMS spools are matched
const IDLE = ["IDLE", "FINISH", "FAILED"];
const SNOOZE = 60 * 60000;
const RECHECK = 5 * 60000; // a bed that wasn't clear (or was too dark) is looked at again this often
const RETRY = 10 * 60000;
const CONFIRMED_FOR = 30 * 60000; // how long teaching the empty bed counts as you saying it's clear
const orderNumber = (o) => Number(String(o.number).replace(/\D/g, "")) || 0;

// Notices when a printer is free and an order needs a piece it can print (a Bambu TPU for AMS spool
// close to the order's colorway is loaded), offers it to you, and with automatic printing on, starts it
// itself, but only after the printer's last print was answered and a camera check sees an empty bed.
export class Dispatcher {
  constructor(dbFile, { printers, plans, library, orderPrints, watcher, notifications, bedCheck = null, shrink, now = Date.now }) {
    Object.assign(this, { printers, plans, library, orderPrints, watcher, notifications, bedCheck, shrink, now });
    this.db = new DatabaseSync(dbFile);
    this.db.exec("CREATE TABLE IF NOT EXISTS dispatch_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    this.db.exec("CREATE TABLE IF NOT EXISTS bed_references (printer TEXT PRIMARY KEY, jpeg BLOB NOT NULL, note TEXT NOT NULL, confirmed INTEGER NOT NULL)");
    // The part of the photo where the plate sits, as fractions of the frame: bed checks look only there.
    if (!this.db.prepare("PRAGMA table_info(bed_references)").all().some((c) => c.name === "area")) this.db.exec("ALTER TABLE bed_references ADD COLUMN area TEXT");
    // How each printer's bed check judges: by the visible plate or the whole plate, and what's fine on it.
    this.db.exec("CREATE TABLE IF NOT EXISTS bed_settings (printer TEXT PRIMARY KEY, visible_only INTEGER NOT NULL DEFAULT 1, allow TEXT NOT NULL DEFAULT '[]')");
    this.referenceCaptures = new Map();
    this.referenceRevisions = new Map();
    this.prompted = new Map();
    this.offers = new Map(); // printer -> offer
    this.snoozed = new Map(); // printer -> { offerId, until }
    this.tried = new Map(); // offerId -> { at, reason }
    this.beds = new Map(); // printer -> { key, at, empty, reason }: the last camera check of the bed
    this.held = new Map(); // printer -> { printerName, reason }: free, but the bed check says no
    this.confirmedClear = new Map(); // printer -> { job, at }: you taught its empty bed; clear until the next print, for half an hour
    this.warnings = new Map(); // printer -> { id, printer, printerName, job, reason, at, jpeg }: you started a print the camera doubted
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
  candidate(view, taken, orderId) {
    const trays = (view.trays || []).filter((t) => t.materialId === MATERIAL && t.color);
    if (!trays.length) return null;
    const work = this.plans()
      .filter(({ order }) => (!orderId || order.id === orderId) && String(order.commercial).toLowerCase() === "processing" && !order.refundReview && !order.sourceReview && !order.assembled)
      .sort((a, b) => orderNumber(a.order) - orderNumber(b.order));
    for (const { order, plan } of work) {
      const colorway = order.items.find((i) => i.colorway)?.colorway;
      const target = COLORWAYS[colorwayName(colorway)];
      if (!target) continue;
      // Only spools that read as the order's colorway (a grey spool is never "close enough" to green).
      const matching = trays.filter((t) => matchesColorway(t.color, colorway));
      if (!matching.length) continue;
      for (const group of plan) {
        const next = group.next;
        if (!next || taken.has(`${order.id}:${next.assetId}`)) continue;
        const plate = this.library.get(next.fileId)?.plates.find((p) => p.index === next.plate);
        if (!plate?.filaments.length || !plate.filaments.every((f) => /^TPU/i.test(f.type))) continue;
        const best = matching.map((t) => ({ t, off: deltaE(t.color, target) })).sort((a, b) => a.off - b.off)[0];
        const slots = Math.max(...plate.filaments.map((f) => f.id));
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
        // A finished printer is free once the camera sees an empty bed; a review isn't needed.
        const last = this.watcher.lastFor(serial);
        const cleared = !last || !!last.ended;
        // A printer repeating its own print isn't offered order pieces.
        const free = view.connected && IDLE.includes(view.rawState) && cleared && !this.printers.busy.has(serial) && !this.orderPrints.pending.has(serial) && !this.repeating?.(serial);
        let offer = free ? this.candidate(view, taken) : null;
        // Before offering, look at the bed: an empty result holds until the next print; anything else is
        // checked again every few minutes.
        if (offer) {
          const bed = await this.lookAtBed(serial, last);
          if (!bed.empty) { this.held.set(serial, { printer: serial, printerName: view.name, reason: bed.reason }); offer = null; }
          else this.held.delete(serial);
        } else this.held.delete(serial);
        if (!offer) { this.prompted.delete(serial); this.offers.delete(serial); if (!free) this.snoozed.delete(serial); continue; }
        taken.add(`${offer.orderId}:${offer.assetId}`);
        const prior = this.offers.get(serial);
        const fresh = prior?.id !== offer.id;
        this.offers.set(serial, fresh ? { ...offer, at: this.now() } : prior);
        const snooze = this.snoozed.get(serial);
        if (snooze && (snooze.offerId !== offer.id || this.now() > snooze.until)) this.snoozed.delete(serial);
        if (this.auto && !this.snoozed.has(serial) && (await this.tryAuto(serial, this.offers.get(serial)))) continue;
        const hour = Number(new Intl.DateTimeFormat("en-US", {timeZone:"America/New_York",hour:"numeric",hourCycle:"h23"}).format(this.now()));
        if (hour >= 9 && hour < 23 && this.prompted.get(serial) !== offer.id && !this.snoozed.has(serial)) {
          this.notifications?.broadcast({ id: `offer:${offer.id}`, kind:"printOpportunity", title: `${offer.printerName} is free`, body: `Print the ${offer.pieceName} for ${offer.orderNumber} (${offer.colorway})?`, url: "/" });
          this.prompted.set(serial, offer.id);
        }
      }
    } catch (e) {
      console.error("Dispatcher:", e.message);
    } finally {
      this.busy = false;
    }
  }
  reference(serial) {
    const r = this.db.prepare("SELECT jpeg,note,area FROM bed_references WHERE printer=?").get(serial);
    return r ? {jpeg:Buffer.from(r.jpeg),note:r.note,area:r.area ? JSON.parse(r.area) : null} : null;
  }
  bedSettings(serial) {
    const r = this.db.prepare("SELECT visible_only, allow FROM bed_settings WHERE printer=?").get(String(serial));
    const ref = this.db.prepare("SELECT note, confirmed, area FROM bed_references WHERE printer=?").get(String(serial));
    return { visibleOnly: r ? !!r.visible_only : true, allow: r ? JSON.parse(r.allow) : [], reference: ref ? { note: ref.note, taught: ref.confirmed, area: !!ref.area } : null };
  }
  // Everything a bed check needs about this printer: its empty-bed photo (if taught) and its settings.
  context(serial) {
    const { visibleOnly, allow } = this.bedSettings(serial);
    return { ...(this.reference(serial) || {}), visibleOnly, allow: allow.map((a) => a.text) };
  }
  saveBedSettings(serial, { visibleOnly, allow }) {
    const cur = this.bedSettings(serial);
    const next = { visibleOnly: visibleOnly ?? cur.visibleOnly, allow: allow ?? cur.allow };
    this.db.prepare("INSERT INTO bed_settings VALUES (?,?,?) ON CONFLICT(printer) DO UPDATE SET visible_only=excluded.visible_only, allow=excluded.allow").run(String(serial), next.visibleOnly ? 1 : 0, JSON.stringify(next.allow));
    // Judged differently now: look again soon, and let a held auto-print try again.
    this.beds.delete(String(serial));
    this.referenceRevisions.set(String(serial), (this.referenceRevisions.get(String(serial)) || 0) + 1);
    const offer = this.offers.get(String(serial));
    if (offer) this.tried.delete(offer.id);
    return this.bedSettings(serial);
  }
  setVisibleOnly(serial, on) {
    if (typeof on !== "boolean") throw Error("Choose on or off");
    return this.saveBedSettings(serial, { visibleOnly: on });
  }
  // "This is fine on this printer": a note every later check of its bed is told to accept.
  allowOnBed(serial, text) {
    const clean = typeof text === "string" ? text.replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, 300) : "";
    if (!clean) throw Error("Say what's fine on this printer's bed");
    const { allow } = this.bedSettings(serial);
    if (allow.length >= 20) throw Error("This printer has 20 notes already. Remove one first.");
    this.held.delete(String(serial));
    return this.saveBedSettings(serial, { allow: [...allow, { id: randomUUID(), text: clean, at: this.now() }] });
  }
  removeAllowance(serial, id) {
    const { allow } = this.bedSettings(serial);
    if (!allow.some((a) => a.id === id)) throw Object.assign(Error("That note is already gone"), { status: 404 });
    return this.saveBedSettings(serial, { allow: allow.filter((a) => a.id !== id) });
  }
  // Your own start goes straight through: the photo from just before it is judged afterwards, and if the camera
  // thought something was on the bed you're told, with the photo, while there's still time to stop it.
  async frameBeforeStart(serial) {
    if (!this.bedCheck) return null;
    try { return await this.shrink(await this.printers.cameraFrame(serial)); } catch { return null; }
  }
  async warnAfterStart(serial, frame, job) {
    if (!this.bedCheck || !frame) return;
    serial = String(serial);
    let bed;
    try {
      bed = frame.brightness < 18 ? { empty: false, reason: "It was too dark to see the bed." } : await this.bedCheck(frame.jpeg, "confirm", this.context(serial));
    } catch {
      return;
    }
    if (bed.empty) return this.warnings.delete(serial);
    const name = this.printers.statuses().find((p) => p.serial === serial)?.view.name || "The printer";
    const warning = { id: randomUUID(), printer: serial, printerName: name, job: job || "", reason: bed.reason, at: this.now(), jpeg: frame.jpeg };
    this.warnings.set(serial, warning);
    this.notifications?.broadcast({ id: `bedwarn:${warning.id}`, title: `Check ${name}'s bed`, body: `You started ${job || "a print"}, but the camera thought: ${bed.reason}`, url: "/printers" });
  }
  warning(serial) {
    const w = this.warnings.get(String(serial));
    if (!w) throw Object.assign(Error("No bed warning for that printer"), { status: 404 });
    return w;
  }
  dismissWarning(serial) {
    this.warnings.delete(String(serial));
    return this.view();
  }
  idleForReference(serial) {
    const status = this.printers.statuses().find(p=>p.serial===serial);
    if (!status?.view.connected || status.view.stale || !IDLE.includes(status.view.rawState) || this.printers.busy.has(serial) || this.orderPrints.pending.has(serial)) throw Error("The printer must be idle and connected to teach its empty bed");
    return this.watcher.lastFor(serial)?.id || "none";
  }
  async captureReference(serial) {
    const job = this.idleForReference(serial);
    const {jpeg,brightness} = await this.shrink(await this.printers.cameraFrame(serial));
    if (brightness < 18) throw Error("The photo is too dark. Light the bed and try again.");
    if (this.idleForReference(serial) !== job) throw Error("The printer changed while taking the photo. Try again.");
    const capture={id:randomUUID(),jpeg,job,at:this.now()};
    this.referenceCaptures.set(serial,capture);
    // The plate area already marked, so the box starts where it was.
    return {id:capture.id,at:capture.at,area:this.reference(serial)?.area||null};
  }
  referencePhoto(serial,id) {
    const c=this.referenceCaptures.get(serial);
    if (!c || c.id!==id || this.now()-c.at>5*60000) throw Error("This photo expired. Take a fresh photo.");
    return c;
  }
  // `area` marks where the plate is ({left,top,right,bottom} as fractions); undefined keeps the current one, null clears it.
  teachReference(serial,id,clear,note,area) {
    if (clear !== true) throw Error("Confirm that the photographed bed is completely clear");
    if (area != null) area = plateArea(area);
    const capture=this.referencePhoto(serial,id);
    if (this.idleForReference(serial)!==capture.job) throw Error("The printer changed since this photo. Take another photo.");
    const text=typeof note === "string" ? note.trim().slice(0,300) : "";
    this.db.prepare("INSERT INTO bed_references (printer,jpeg,note,confirmed) VALUES (?,?,?,?) ON CONFLICT(printer) DO UPDATE SET jpeg=excluded.jpeg,note=excluded.note,confirmed=excluded.confirmed").run(serial,capture.jpeg,text,this.now());
    if (area !== undefined) this.db.prepare("UPDATE bed_references SET area=? WHERE printer=?").run(area ? JSON.stringify(area) : null, serial);
    this.referenceCaptures.delete(serial);
    this.beds.delete(serial);
    // Teaching is you confirming this bed is clear right now: the hold goes, and it counts as clear until the next print.
    this.confirmedClear.set(serial, { job: capture.job, at: this.now() });
    this.held.delete(serial);
    this.referenceRevisions.set(serial,(this.referenceRevisions.get(serial)||0)+1);
    const offer=this.offers.get(serial);if(offer)this.tried.delete(offer.id);
    return {ok:true};
  }
  // You taught this printer's empty bed since its last print, within the half hour, so you've already said it's clear.
  confirmedByYou(serial, last) {
    const c = this.confirmedClear.get(serial);
    return !!c && c.job === (last?.id || "none") && this.now() - c.at < CONFIRMED_FOR;
  }
  // One careful look right now, for a print started by hand.
  async checkBedNow(serial) {
    try {
      const { jpeg, brightness } = await this.shrink(await this.printers.cameraFrame(serial));
      if (brightness < 18) return { empty: false, reason: "It's too dark to see the bed." };
      return await this.bedCheck(jpeg, "confirm", this.context(serial));
    } catch {
      return { empty: false, reason: "The camera couldn't get a photo of the bed." };
    }
  }
  async lookAtBed(serial, last) {
    if (!this.bedCheck) return { empty: true, reason: "" };
    const revision=this.referenceRevisions.get(serial)||0;
    const key = last ? `${last.id}:${last.outcome}` : "none";
    if (this.confirmedByYou(serial, last)) return { key, at: this.now(), empty: true, reason: "You confirmed the bed is clear." };
    const seen = this.beds.get(serial);
    if (seen?.key === key && (seen.empty || this.now() - seen.at < RECHECK)) return seen;
    let result;
    try {
      const { jpeg, brightness } = await this.shrink(await this.printers.cameraFrame(serial));
      result = brightness < 18 ? { empty: false, reason: "Too dark to see the bed" } : await this.bedCheck(jpeg, "routine", this.context(serial));
    } catch {
      result = { empty: false, reason: "Couldn't see the bed" };
    }
    if(revision !== (this.referenceRevisions.get(serial)||0)) return this.lookAtBed(serial,last);
    const seenNow = { key, at: this.now(), ...result };
    this.beds.set(serial, seenNow);
    return seenNow;
  }
  // Starts an offer by itself when it's safe; otherwise records why not and leaves it as a prompt.
  async tryAuto(serial, offer) {
    const last = this.tried.get(offer.id);
    if (last && this.now() - last.at < RETRY) return false;
    const block = (reason) => { this.tried.set(offer.id, { at: this.now(), reason }); offer.autoBlocked = reason; return false; };
    if (!this.bedCheck) return block("Camera checks need the vision key");
    let bed;
    if (this.confirmedByYou(serial, this.watcher.lastFor(serial))) bed = { empty: true, reason: "You confirmed the bed is clear." };
    else try {
      const { jpeg, brightness } = await this.shrink(await this.printers.cameraFrame(serial));
      if (brightness < 18) return block("Too dark to check the bed");
      bed = await this.bedCheck(jpeg, "confirm", this.context(serial));
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
  // "Bed cleared": forget the last look at this printer's bed and look again now, instead of in a few minutes.
  // Waits for the answer, so the app can say straight away whether it's offered (or started) or still held.
  async recheck(serial) {
    serial = String(serial);
    if (!this.printers.statuses().some((p) => p.serial === serial)) throw Object.assign(Error("Unknown printer"), { status: 404 });
    this.beds.delete(serial);
    for (const id of this.tried.keys()) if (id.startsWith(serial + ":")) this.tried.delete(id);
    while (this.busy) await new Promise((r) => setTimeout(r, 200));
    await this.tick();
    return this.view();
  }
  dismiss(printer) {
    const offer = this.offers.get(printer);
    if (!offer) throw Object.assign(Error("No offer for that printer"), { status: 404 });
    this.snoozed.set(printer, { offerId: offer.id, until: this.now() + SNOOZE });
    return this.view();
  }
  // Read-only availability for every order, rather than just the oldest offered piece.
  availableOrders() {
    if (!this.bedCheck) return [];
    const taken = this.watcher.inFlight();
    for (const tag of this.orderPrints.pending.values()) for (const a of tag.assetIds) taken.add(`${tag.orderId}:${a}`);
    const available = [];
    for (const {serial, view} of this.printers.statuses()) {
      const last = this.watcher.lastFor(serial);
      if (!view.connected || view.stale || !IDLE.includes(view.rawState) || (last && !last.ended) || this.printers.busy.has(serial) || this.orderPrints.pending.has(serial) || this.repeating?.(serial)) continue;
      const bed = this.beds.get(serial), key = last ? `${last.id}:${last.outcome}` : "none";
      if (this.bedCheck && (!bed?.empty || bed.key !== key)) continue;
      for (const {order} of this.plans()) {
        if (this.candidate(view, taken, order.id)) available.push({orderId:order.id,printer:serial,printerName:view.name});
      }
    }
    return available;
  }
  view() {
    return {
      auto: this.auto,
      vision: !!this.bedCheck,
      offers: [...this.offers.entries()].filter(([p]) => !this.snoozed.has(p)).map(([, o]) => ({ ...o, autoBlocked: this.auto ? o.autoBlocked || null : null })),
      held: [...this.held.values()],
      // A warning lasts until you answer it, or for an hour.
      warnings: [...this.warnings.values()].filter((w) => this.now() - w.at < 60 * 60000).map(({ jpeg, ...w }) => w),
      available: this.availableOrders(),
    };
  }
}

const BED_BASE = "You check a Bambu Lab A1 mini's build plate through its fixed wide-angle camera before a print starts. The bed slides front to back, so it can appear at different positions. Anything left on the plate (a finished part, a strand, a tool) will be hit by the nozzle. Count anything sitting on the plate, including thin flat prints like small discs or membranes, strands, blobs and tools. Do not count the plate's own surface: scratches, scuffs, wear marks, faint outlines or residue lines left by earlier prints, glints and small dust specks are normal on a used plate and don't block a print. When given a user-confirmed empty-bed reference from this exact printer, compare fixed printer fixtures and surroundings to it. Those unchanged fixtures are not leftover print parts. The reference does not prove the current bed is clear: judge the current photo independently, accounting for the bed position. Do not ignore new objects or parts.";
// Strict: the whole plate must be seen. Visible (the default): judge what can be seen, since the bed often rests
// partly out of frame or under the lamp's glare.
export function bedSystem(visibleOnly = true) {
  return BED_BASE + (visibleOnly
    ? " Judge the part of the plate you can see. Part of the plate being out of frame, cut off at the edge of the photo, or washed out by glare is normal for this camera and is not by itself a reason to say it isn't empty: say empty when nothing is on the visible plate and nothing runs in from the edge of the frame. Say not empty if something is on the plate, if the photo is too dark to see the plate at all, or if you're unsure about something you can see."
    : " Say the bed is empty only if you can see the whole plate and nothing is on it. If part of the plate is out of view, too dark, or you're unsure, say it is not empty.");
}

// Asks Claude whether the build plate in a camera photo is completely empty.
// `models` maps "routine" (offer checks) and "confirm" (right before an automatic start) to model ids.
export function claudeBedCheck(apiKey, models, fetchImpl = fetch) {
  return async (jpeg, kind = "confirm", reference = null) => {
    const model = models[kind] || models.confirm;
    // Settings travel with the reference; a printer with no empty-bed photo still has them.
    const visibleOnly = reference?.visibleOnly !== false, allow = reference?.allow || [];
    if (!reference?.jpeg) reference = null;
    // With a plate area set, both photos show just the plate.
    const area = reference?.area;
    if (area) {
      jpeg = await cropArea(jpeg, area);
      reference = { ...reference, jpeg: await cropArea(reference.jpeg, area) };
    }
    const r = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: bedSystem(visibleOnly),
        tools: [{ name: "report", description: "Report whether the build plate is empty.", input_schema: { type: "object", properties: { empty: { type: "boolean" }, reason: { type: "string", description: "One short sentence, e.g. 'A red case is still on the plate.'" } }, required: ["empty", "reason"] } }],
        // Newer models refuse a forced tool, so the tool is offered and the prompt asks for it.
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: [...(reference ? [{type:"text",text:"Reference photo: the user confirmed this printer's bed was empty. Their note: " + reference.note}, {type:"image",source:{type:"base64",media_type:"image/jpeg",data:reference.jpeg.toString("base64")}}] : []), ...(allow.length ? [{ type: "text", text: "The owner's notes for this printer: these are fine and are not a reason to say the bed isn't empty, unless something new is on the plate as well.\n" + allow.map((a) => "- " + a).join("\n") }] : []), {type:"text",text:"Current camera photo — judge this photo, not the reference:" + (area ? " Both photos are cropped to where the plate sits when the printer is idle." + (area.quad ? " Everything outside the plate's outline is blanked out in flat grey: ignore the grey." : "") + (visibleOnly ? "" : " If the plate isn't fully inside this crop, say it is not empty.") : "")}, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } }, { type: "text", text: "Is the build plate completely empty? Answer by calling the report tool." }] }],
      }),
      signal: AbortSignal.timeout(60000),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(body.error?.message || `Vision API ${r.status}`);
    const input = body.content?.find((c) => c.type === "tool_use")?.input;
    if (typeof input?.empty !== "boolean") throw Error("Vision API gave no answer");
    return { empty: input.empty, reason: String(input.reason || "").slice(0, 200) };
  };
}

// Crops a camera photo to an area given as fractions of the frame ({ left, top, right, bottom }),
// with a little room around it so a part right at the plate's edge isn't cut off.
// Where the plate is in the photo, checked and tidied: either a box ({left, top, right, bottom}) or its four
// corners as seen at the camera's angle ({quad: [[x, y] × 4]}), as fractions of the frame. Corners are put in
// order around their middle, whatever order they were tapped in, and the box around them is kept too.
export function plateArea(area) {
  const ok = (n) => typeof n === "number" && n >= 0 && n <= 1;
  if (Array.isArray(area?.quad)) {
    if (area.quad.length !== 4 || !area.quad.every((p) => Array.isArray(p) && p.length === 2 && p.every(ok))) throw Error("Mark the plate's four corners");
    const cx = area.quad.reduce((n, p) => n + p[0], 0) / 4, cy = area.quad.reduce((n, p) => n + p[1], 0) / 4;
    const quad = [...area.quad].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx)).map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]);
    // Shoelace area: a sliver or a tiny shape isn't a plate.
    const size = Math.abs(quad.reduce((n, [x, y], i) => n + x * quad[(i + 1) % 4][1] - quad[(i + 1) % 4][0] * y, 0)) / 2;
    const xs = quad.map((p) => p[0]), ys = quad.map((p) => p[1]);
    const box = { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
    if (size < 0.01 || box.right - box.left < 0.05 || box.bottom - box.top < 0.05) throw Error("Mark the plate with a larger shape");
    return { ...box, quad };
  }
  const { left, top, right, bottom } = area || {};
  if (![left, top, right, bottom].every(ok) || right - left < 0.05 || bottom - top < 0.05) throw Error("Mark the plate with a larger box");
  return { left, top, right, bottom };
}

export async function cropArea(jpeg, area, pad = 0.03) {
  const left = Math.max(0, area.left - pad), top = Math.max(0, area.top - pad), right = Math.min(1, area.right + pad), bottom = Math.min(1, area.bottom + pad);
  const { default: sharp } = await import("sharp");
  const { width, height } = await sharp(jpeg).metadata();
  const x = Math.max(0, Math.floor(left * width)), y = Math.max(0, Math.floor(top * height));
  const w = Math.min(width - x, Math.ceil((right - left) * width)), h = Math.min(height - y, Math.ceil((bottom - top) * height));
  const cropped = sharp(jpeg).extract({ left: x, top: y, width: w, height: h });
  if (!area.quad) return cropped.jpeg({ quality: 80 }).toBuffer();
  // Blank everything outside the plate's outline, grown a little from its middle so a part right at the edge
  // still shows.
  const cx = area.quad.reduce((n, p) => n + p[0], 0) / 4, cy = area.quad.reduce((n, p) => n + p[1], 0) / 4;
  const points = area.quad.map(([px, py]) => [(cx + (px - cx) * (1 + pad * 2)) * width - x, (cy + (py - cy) * (1 + pad * 2)) * height - y]);
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><polygon points="${points.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" ")}" fill="#fff"/></svg>`);
  const plate = await cropped.ensureAlpha().composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  return sharp(plate).flatten({ background: "#808080" }).jpeg({ quality: 80 }).toBuffer();
}
