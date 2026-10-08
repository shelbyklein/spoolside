import { orderReadiness, orderPrintPlan } from "./readiness.mjs";
import express from "express";
import { printQueue, reservedPieces } from "./printqueue.mjs";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { isIP } from "node:net";
export function createApp({
  dist = path.resolve("dist"),
  database = ":memory:",
  pinHash,
  origin = "https://spoolside.shelbyklein.com",
  secure = true,
  proxyAddress,
  workspace,
  notifications,
  printers,
  library,
  assets,
  materials,
  watcher,
  orderPrints,
  dispatcher,
} = {}) {
  if (
    !pinHash ||
    !/^([a-f0-9]{32}):([a-f0-9]{128})$/.test(pinHash)
  )
    throw new Error("Valid server-side PIN credentials are required.");
  const db = new DatabaseSync(database);
  db.exec(
    "CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL)",
  );
  const app = express();
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false, limit: "4kb" }));
  app.use(express.json({ limit: "2mb" }));

  const cookieName = secure ? "__Host-spoolside" : "spoolside";
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "DENY",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://playcase.gg https://store.bblcdn.com https://proto-pasta.com https://recreus.com https://3d.nice-cdn.com; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    next();
  });
  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  app.get("/auth-display.woff2", (_req, res) => {
    const file = fs
      .readdirSync(path.join(dist, "assets"))
      .find(
        (f) =>
          f.startsWith("manrope-latin-700-normal-") && f.endsWith(".woff2"),
      );
    if (!file) return res.sendStatus(404);
    res.sendFile(path.join(dist, "assets", file));
  });
  app.get("/auth.css", (_req, res) =>
    res
      .type("css")
      .send(fs.readFileSync(new URL("./auth.css", import.meta.url), "utf8")),
  );
  app.get("/auth-icon.png", (_req, res) =>
    res.sendFile(path.join(dist, "icon-192.png")),
  );
  for (const file of ["icon-192.png", "icon-512.png", "apple-touch-icon.png", "manifest.webmanifest"]) {
    app.get("/" + file, (_req,res) => res.sendFile(path.join(dist,file)));
  }
  // Only app pages are allowed as post-login destinations (no open redirects).
  const APP_PAGE = /^\/(?:library\/sliced\/?$)|^\/(?:library\/assemblies(?:\/[0-9a-f-]{36})?\/?$)|^\/(overview|printers|orders|library|queue|filament|settings)(\/[0-9a-f-]{36})?\/?$/;
  const safeNext = (value) => (typeof value === "string" && APP_PAGE.test(value) ? value : "");
  const loginPage = (error = false, next = "") =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#102d44"><title>Sign in · Spoolside</title><link rel="stylesheet" href="/auth.css"><link rel="icon" type="image/png" href="/icon-192.png"><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest"></head><body><main><img src="/auth-icon.png" alt="Spoolside artwork"><h1>Spoolside</h1>${error ? '<p role="alert" class="error">Incorrect PIN, or too many attempts.</p>' : ""}<form action="/login" method="post">${next ? `<input type="hidden" name="next" value="${next}">` : ""}<label>PIN<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{8}" minlength="8" maxlength="8" autocomplete="current-password" required></label><button type="submit">Sign in</button></form></main></body></html>`;
  app.get("/login", (req, res) => res.type("html").send(loginPage(false, safeNext(req.query.next))));
  app.use((req, res, next) => {
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
      req.headers.origin !== origin
    )
      return res.status(403).json({ error: "Request origin rejected" });
    next();
  });
  app.post("/login", (req, res) => {
    const now = Date.now(),
      peer = (req.socket.remoteAddress || "").replace(/^::ffff:/, ""),
      forwarded = req.get("CF-Connecting-IP"),
      ip =
        proxyAddress && peer === proxyAddress && isIP(forwarded || "")
          ? forwarded
          : peer || "local";
    db.prepare("DELETE FROM login_attempts WHERE until<=?").run(now);
    const prior = db.prepare("SELECT count,until FROM login_attempts WHERE ip=?").get(ip);
    const failures = db.prepare("SELECT COALESCE(SUM(count),0) count FROM login_attempts").get().count;
    if (failures >= 100 || (prior && prior.until > now && prior.count >= 8))
      return res.status(429).type("html").send(loginPage(true, safeNext(req.body?.next)));
    const [salt, expected] = pinHash.split(":");
    const candidate = scryptSync(
      String(req.body.pin || "").slice(0, 256),
      salt,
      64,
    );
    const valid =
      timingSafeEqual(candidate, Buffer.from(expected, "hex")) &&
      /^[0-9]{8}$/.test(String(req.body.pin || ""));
    if (!valid) {
      db.prepare("INSERT INTO login_attempts VALUES(?,?,?) ON CONFLICT(ip) DO UPDATE SET count=excluded.count,until=excluded.until").run(ip, prior && prior.until > now ? prior.count + 1 : 1, now + 15 * 60 * 1000);
      return res.status(401).type("html").send(loginPage(true, safeNext(req.body?.next)));
    }
    db.prepare("DELETE FROM login_attempts WHERE ip=?").run(ip);
    db.prepare("DELETE FROM sessions WHERE expires < ?").run(now);
    const token = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO sessions VALUES (?,?)").run(
      createHash("sha256").update(token).digest("hex"),
      now + 7 * 24 * 60 * 60 * 1000,
    );
    res.cookie(cookieName, token, {
      httpOnly: true,
      secure,
      sameSite: "strict",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.redirect(303, safeNext(req.body?.next) || "/");
  });
  app.use((req, res, next) => {
    const raw = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
    const session =
      raw &&
      db
        .prepare("SELECT expires FROM sessions WHERE token=?")
        .get(createHash("sha256").update(raw).digest("hex"));
    if (!session || session.expires < Date.now()) {
      if (req.path.startsWith("/api/") || req.method !== "GET")
        return res.status(401).json({ error: "Sign in required" });
      return res.redirect(303, APP_PAGE.test(req.path) ? `/login?next=${encodeURIComponent(req.path)}` : "/login");
    }
    req.sessionToken = raw;
    next();
  });
  app.post("/logout", (req, res) => {
    db.prepare("DELETE FROM sessions WHERE token=?").run(
      createHash("sha256").update(req.sessionToken).digest("hex"),
    );
    res.clearCookie(cookieName, {
      httpOnly: true,
      secure,
      sameSite: "strict",
      path: "/",
    });
    res.redirect(303, "/login");
  });
  app.get("/api/status", (_req, res) =>
    res.json({
      mode: workspace ? "live" : "demo",
      host: "beelink",
      orders: {
        source: "https://playcase.gg",
        connected: !!workspace?.state.lastSync,
        lastSync: workspace?.state.lastSync || null,
        error: workspace?.state.syncError || null,
      },
      printers: {
        connected: printers?.snapshot().filter((p) => p.connected).length || 0,
        total: printers?.configs.length || 0,
      },
    }),
  );
  const withReadiness = snapshot => {
    const models=assets?.list() || [], assemblies=assets?.assemblies() || [], sliced=library?.list() || [];
    const printed = orderPrints?.all() || {};
    const orders = snapshot.orders.map(o=>({...o,printReadiness:orderReadiness(o,models,assemblies,sliced),printPlan:orderPrintPlan(o,models,assemblies,sliced,printed[o.id])}));
    const queue = printQueue(orders, reservedPieces(watcher, orderPrints));
    for (const order of orders) for (const group of order.printPlan) {
      const row = queue.find(r => r.orderId === order.id && r.group?.key === group.key);
      if (row?.blocked === "Printing / awaiting result") group.activity = row.blocked;
    }
    return {...snapshot, orders, printQueue: queue};
  };
  app.get("/api/workspace", (_req, res) =>
    workspace
      ? res.json({
          ...withReadiness(workspace.snapshot()),
          machines: printers?.snapshot() || [],
        })
      : res.status(503).json({ error: "Live connections unavailable" }),
  );
  app.put("/api/workspace", (req, res) => {
    if (!workspace)
      return res.status(503).json({ error: "Live connections unavailable" });
    try {
      res.json({
        ...withReadiness(workspace.update(req.body)),
        machines: printers?.snapshot() || [],
      });
    } catch (e) {
      res.status(e.status || 400).json({ error: e.message });
    }
  });
  app.post("/api/sync", async (_req, res) => {
    if (!workspace) return res.sendStatus(503);
    await workspace.sync();
    res.json({ ...withReadiness(workspace.snapshot()), machines: printers?.snapshot() || [] });
  });
  app.get("/api/notifications", (req,res) => res.json({enabled:!!notifications?.enabled, publicKey:notifications?.vapid?.publicKey || null, device: notifications?.device(String(req.query.device || "")) || null}));
  app.post("/api/notifications", (req,res) => {
    try {if(!notifications?.enabled) return res.status(503).json({error:"Notifications unavailable"}); res.json(notifications.register(req.body.subscription, req.body.preferences));}
    catch {res.status(400).json({error:"Invalid notification subscription or preferences"});}
  });
  app.delete("/api/notifications/:id", (req,res) => {notifications?.remove(req.params.id);res.json({ok:true});});
  const testTimes = new Map();
  app.post("/api/notifications/:id/test", async (req,res) => {
    if(!notifications?.enabled) return res.status(503).json({error:"Notifications unavailable"});
    if(Date.now()-(testTimes.get(req.params.id)||0)<30000) return res.status(429).json({error:"Wait 30 seconds before another test"});
    testTimes.set(req.params.id,Date.now());
    try {await notifications.test(req.params.id);res.json({ok:true});}
    catch(e){res.status(400).json({error:e.message});}
  });
  const fail = (res, e) => res.status(e.status || 400).json({ error: e.message });
  app.get("/api/designfiles",(_req,res)=>res.json(assets?.designs() || []));
  app.post("/api/designfiles",express.raw({type:"application/octet-stream",limit:"150mb"}),(req,res)=>{try{if(!assets)return res.sendStatus(503);res.json(assets.addDesign(JSON.parse(decodeURIComponent(String(req.get("x-design")||"{}"))),req.body));}catch(e){fail(res,e);}});
  app.get("/api/designfiles/:id/download",(req,res)=>{try{const file=assets.designFile(req.params.id);res.download(file.path,file.meta.name);}catch(e){fail(res,e);}});
  app.put("/api/assets/:id/design",(req,res)=>{try{res.json(assets.linkDesign(req.params.id,req.body.designId));}catch(e){fail(res,e);}});
  app.get("/api/categories", (_req, res) => res.json(assets?.categories() || []));
  app.post("/api/categories", (req, res) => { try { res.json(assets.saveCategory(req.body || {})); } catch (e) { fail(res, e); } });
  app.put("/api/categories/:id", (req, res) => { try { res.json(assets.saveCategory(req.body || {}, req.params.id)); } catch (e) { fail(res, e); } });
  app.delete("/api/categories/:id", (req, res) => { try { assets.deleteCategory(req.params.id); res.json({ ok: true }); } catch (e) { fail(res, e); } });
  app.get("/api/assemblies", (_req,res)=>assets ? res.json(assets.assemblies()) : res.status(503).json({error:"Library unavailable"}));
  app.post("/api/assemblies", (req,res)=>{try{if(!assets)return res.sendStatus(503);res.json(assets.saveAssembly(req.body));}catch(e){fail(res,e);}});
  app.put("/api/assemblies/:id",(req,res)=>{try{if(!assets?.assemblies().some(a=>a.id===req.params.id))return res.status(404).json({error:"Assembly not found"});res.json(assets.saveAssembly(req.body,req.params.id));}catch(e){fail(res,e);}});
  app.put("/api/assembly-order",(req,res)=>{try{res.json(assets.orderAssemblies(req.body?.ids));}catch(e){fail(res,e);}});
  app.get("/api/assemblies/:id/thumb",(req,res)=>{try{const f=assets.assemblyThumbFile(req.params.id);if(!fs.existsSync(f))return res.status(404).json({error:"No preview yet"});res.set("Cache-Control","private, max-age=31536000, immutable").type("png").sendFile(f);}catch(e){fail(res,e);}});
  app.put("/api/assemblies/:id/thumb",express.raw({type:"image/png",limit:"1500kb"}),(req,res)=>{try{res.json(assets.setAssemblyThumb(req.params.id,req.get("x-thumb-key"),req.body));}catch(e){fail(res,e);}});
  app.delete("/api/assemblies/:id",(req,res)=>{assets?.deleteAssembly(req.params.id);res.json({ok:true});});
  app.post("/api/assets/phones", express.raw({ type: "application/octet-stream", limit: "60mb" }), (req, res) => {
    try { if (!assets) return res.sendStatus(503); res.json(assets.addPhone(JSON.parse(decodeURIComponent(String(req.get("x-asset") || "{}"))), req.body)); } catch (e) { fail(res, e); }
  });
  app.get("/api/assets/:id/usdz", (req, res) => {
    try {
      const a = assets?.get(req.params.id);
      if (a?.type !== "Phone") return res.status(404).json({ error: "No phone model" });
      res.set("Cache-Control", "private, max-age=86400").type("model/vnd.usdz+zip");
      if (req.query.download) res.attachment(`${a.name}.usdz`);
      res.sendFile(assets.phoneFile(a.id));
    } catch (e) { fail(res, e); }
  });
  app.get("/api/assets", (_req, res) => res.json(assets?.list() || []));
  app.get("/api/assets/:id/stl", (req, res) => {
    try {
      const asset = assets?.get(req.params.id);
      if (!asset || !asset.hasStl) return res.status(404).json({ error: "Unknown asset" });
      res.type("model/stl").sendFile(assets.file(asset.id));
    } catch (e) {
      fail(res, e);
    }
  });
  app.get("/api/assets/:id/thumb", (req, res) => {
    try {
      const asset = assets?.get(req.params.id);
      if (!asset?.thumb) return res.status(404).json({ error: "No thumbnail yet" });
      res.set("Cache-Control", "private, max-age=31536000, immutable").type("png").sendFile(assets.assetThumbFile(asset.id, asset.hash));
    } catch (e) { fail(res, e); }
  });
  app.put("/api/assets/:id/thumb", express.raw({ type: "image/png", limit: "1mb" }), (req, res) => {
    try { res.json(assets.setAssetThumb(req.params.id, req.body)); } catch (e) { fail(res, e); }
  });
  app.post("/api/assets", express.raw({ type: "application/octet-stream", limit: "50mb" }), (req, res) => {
    if (!assets) return res.status(503).json({ error: "Asset library unavailable" });
    try {
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw Error("Choose an STL file");
      res.json(assets.add(JSON.parse(decodeURIComponent(String(req.get("x-asset") || "{}"))), req.body));
    } catch (e) {
      fail(res, e);
    }
  });
  app.patch("/api/assets/:id", (req, res) => {
    try { res.json(assets.update(req.params.id, req.body || {})); } catch (e) { fail(res, e); }
  });
  app.delete("/api/assets/:id", (req, res) => {
    try { assets.remove(req.params.id); res.json({ ok: true }); } catch (e) { fail(res, e); }
  });
  app.get("/api/materials", (_req,res)=>res.json(materials?.list() || {materials:[],settings:{zip:"30360",sort:"fastest"}}));
  app.post("/api/materials/refresh", async (_req,res)=>{try{if(!materials)throw Error("Materials unavailable");res.json(await materials.refresh());}catch(e){fail(res,e);}});
  app.patch("/api/materials/settings", (req,res)=>{try{res.json(materials.saveSettings(req.body));}catch(e){fail(res,e);}});
  app.patch("/api/materials/:id", (req,res)=>{try{res.json(materials.saveUsage(req.params.id,req.body?.usage));}catch(e){fail(res,e);}});
  app.post("/api/material-offers", (req,res)=>{try{res.json(materials.addOffer(req.body));}catch(e){fail(res,e);}});
  app.patch("/api/material-offers", (req,res)=>{try{res.json(req.body?.reconfirm===true?materials.confirmOffer(req.body.id):materials.quote(req.body?.id,req.body));}catch(e){fail(res,e);}});
  app.delete("/api/material-offers/:id", (req,res)=>{try{res.json(materials.removeOffer(req.params.id));}catch(e){fail(res,e);}});
  app.get("/api/library", (_req, res) => res.json(library?.list() || []));
  app.post(
    "/api/library",
    express.raw({ type: "application/octet-stream", limit: "95mb" }),
    (req, res) => {
      if (!library) return res.status(503).json({ error: "Print library unavailable" });
      try {
        if (!Buffer.isBuffer(req.body) || !req.body.length) throw Error("Choose a sliced .3mf file");
        res.json(library.add(decodeURIComponent(String(req.get("x-file-name") || "")), req.body));
      } catch (e) {
        fail(res, e);
      }
    },
  );
  app.get("/api/library/:id/preview.png", (req, res) => {
    try {
      const png = library?.preview(req.params.id);
      if (!png) return res.sendStatus(404);
      res.set("Cache-Control", "private, max-age=31536000, immutable").type("png").send(png);
    } catch {
      res.sendStatus(404);
    }
  });
  app.patch("/api/library/:id", (req, res) => {
    try { res.json(req.body?.assetIds !== undefined ? library.setCoverage(req.params.id, req.body.plate, req.body.assetIds, assets) : req.body?.quantities !== undefined ? library.details(req.params.id, req.body.name, req.body.quantities) : library.rename(req.params.id, req.body?.name)); } catch (e) { fail(res, e); }
  });
  app.delete("/api/library/:id", (req, res) => {
    try { library.remove(req.params.id); res.json({ ok: true }); } catch (e) { fail(res, e); }
  });
  app.get("/api/watches", (req, res) => {
    res.set("Cache-Control", "no-store").json(watcher ? watcher.list() : { vision: false, watches: [] });
  });
  app.get("/api/watches/:id/:file", (req, res) => {
    try {
      if (!watcher) return res.sendStatus(404);
      const file = watcher.frameFile(req.params.id, req.params.file);
      if (!fs.existsSync(file)) return res.sendStatus(404);
      res.set("Cache-Control", "private, max-age=86400").sendFile(file);
    } catch {
      res.sendStatus(404);
    }
  });
  app.post("/api/watches/:id/note", (req, res) => {
    try {
      if (!watcher) return res.sendStatus(404);
      res.json(watcher.note(req.params.id, req.body?.note));
    } catch (e) { fail(res, e); }
  });
  app.post("/api/watches/:id/outcome", (req, res) => {
    try {
      if (!watcher) return res.sendStatus(404);
      res.json(watcher.outcome(req.params.id, req.body?.success, req.body?.note));
      // An answer means the bed was looked at: check right away whether that printer can take the next piece.
      dispatcher?.tick();
    } catch (e) {
      fail(res, e);
    }
  });
  app.post("/api/watches/:id/false-alarm", async (req, res) => {
    try {
      if (!watcher) return res.sendStatus(404);
      res.json(await watcher.falseAlarm(req.params.id));
    } catch (e) {
      fail(res, e);
    }
  });
  // The live feed: the newest camera frame, shrunk for the web. Cards poll it while they're on screen.
  const feedFrames = new Map();
  app.get("/api/printers/:id/feed.jpg", async (req, res) => {
    try {
      if (!printers) return res.sendStatus(503);
      const frame = await printers.liveFrame(req.params.id);
      let small = feedFrames.get(req.params.id);
      if (small?.at !== frame.at) {
        const { default: sharp } = await import("sharp");
        small = { at: frame.at, jpeg: await sharp(frame.jpeg).resize({ width: 800, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer() };
        feedFrames.set(req.params.id, small);
      }
      res.set({ "Cache-Control": "no-store", "X-Frame-At": String(frame.at) }).type("jpeg").send(small.jpeg);
    } catch (e) {
      fail(res, e);
    }
  });
  app.get("/api/printers/:id/camera.jpg", async (req, res) => {
    try {
      if (!printers) return res.sendStatus(503);
      const jpg = await printers.cameraFrame(req.params.id);
      res.set("Cache-Control", "no-store").type("jpeg").send(jpg);
    } catch (e) {
      fail(res, e);
    }
  });
  // Checks a start request against the file's sliced plates.
  const checkStart = (plates, { plate, amsMapping, useAms, bedClear }) => {
    if (bedClear !== true) throw Error("Confirm the build plate is clear");
    const plateInfo = plates.find((p) => p.index === plate);
    if (!plateInfo) throw Error("Choose a sliced plate");
    const slots = plateInfo.filaments.length ? Math.max(...plateInfo.filaments.map((f) => f.id)) : 0;
    if (useAms && (!Array.isArray(amsMapping) || amsMapping.length !== slots || !amsMapping.every((m) => Number.isInteger(m) && m >= -1 && m <= 3)))
      throw Error("Choose an AMS slot for each filament");
  };
  app.get("/api/printers/:id/last-print", async (req, res) => {
    try {
      if (!printers) return res.json(null);
      const last = await printers.lastPrint(req.params.id);
      res.set("Cache-Control", "no-store").json(last && { name: last.name, plates: last.plates });
    } catch (e) {
      fail(res, e);
    }
  });
  app.post("/api/printers/:id/reprint", async (req, res) => {
    try {
      const { plate, amsMapping, useAms, bedLevelling } = req.body || {};
      const last = await printers.lastPrint(req.params.id);
      if (!last) throw Object.assign(Error("The last print isn't on the printer anymore"), { status: 404 });
      checkStart(last.plates, req.body || {});
      await printers.reprint(req.params.id, { plate, amsMapping, useAms: !!useAms, bedLevelling: bedLevelling !== false });
      res.json({ ok: true, machines: printers.snapshot() });
    } catch (e) {
      fail(res, e);
    }
  });
  app.post("/api/printers/:id/print", async (req, res) => {
    try {
      const { fileId, plate, amsMapping, useAms, bedLevelling } = req.body || {};
      const file = library?.get(String(fileId));
      if (!file) throw Error("Choose a file from the library");
      checkStart(file.plates, req.body || {});
      await printers.startPrint(req.params.id, {
        localFile: library.file(file.id),
        name: file.name,
        plate,
        amsMapping,
        useAms: !!useAms,
        bedLevelling: bedLevelling !== false,
      });
      res.json({ ok: true, machines: printers.snapshot() });
    } catch (e) {
      fail(res, e);
    }
  });
  // An order's Print button: sends the next plate still needed for one of its groups (a case or a faceplate).
  const planFor = (orderId) => {
    const order = workspace?.snapshot().orders.find((o) => o.id === orderId);
    if (!order) throw Object.assign(Error("Unknown order"), { status: 404 });
    return { order, plan: orderPrintPlan(order, assets?.list() || [], assets?.assemblies() || [], library?.list() || [], orderPrints?.all()[order.id]) };
  };
  app.post("/api/orders/:id/print", async (req, res) => {
    try {
      if (!orderPrints || !printers) return res.sendStatus(503);
      const { group, printer, plate, amsMapping, useAms, bedLevelling } = req.body || {};
      const { order, plan } = planFor(req.params.id);
      if (!["processing"].includes(String(order.commercial).toLowerCase())) throw Error("Only processing orders can be printed");
      if (order.assembled || order.refundReview || order.sourceReview) throw Error("Review this order before printing");
      const next = plan.find((g) => g.key === group)?.next;
      if (!next) throw Error("Nothing left to print for that");
      // The request names the plate it showed you, so a plan that moved on can't start the wrong one.
      if (plate !== `${next.fileId}:${next.plate}`) throw Object.assign(Error("This order changed. Refresh and try again."), { status: 409 });
      const file = library.get(next.fileId);
      if (!file) throw Error("That sliced print is no longer in the library");
      checkStart(file.plates, { ...req.body, plate: next.plate });
      // Everything this plate makes that the order still needs gets credited when it comes out fine.
      const covered = new Set((file.plates.find((p) => p.index === next.plate)?.coverage || []).map((c) => c.assetId));
      const assetIds = [...new Set(plan.flatMap((g) => g.pieces).filter((p) => covered.has(p.assetId) && p.done < p.needed).map((p) => p.assetId))];
      const ids = assetIds.length ? assetIds : [next.assetId];
      const taken = reservedPieces(watcher, orderPrints);
      if (ids.some(id => taken.has(`${order.id}:${id}`)) || orderPrints.pending.has(String(printer)))
        throw Object.assign(Error("This piece is already printing or awaiting a result."), { status: 409 });
      orderPrints.sent(String(printer), { orderId: order.id, orderNumber: order.number, assetIds: ids });
      const reservation = orderPrints.pending.get(String(printer));
      try {
      await printers.startPrint(String(printer), { localFile: library.file(file.id), name: file.name, plate: next.plate, amsMapping, useAms: !!useAms, bedLevelling: bedLevelling !== false });
      } catch (error) {
        if (orderPrints.pending.get(String(printer)) === reservation) orderPrints.cancel(String(printer));
        throw error;
      }
      res.json({ ok: true, machines: printers.snapshot() });
    } catch (e) {
      fail(res, e);
    }
  });
  // Free printers offered the next order piece, and the automatic printing toggle.
  app.get("/api/dispatch", (_req, res) => res.set("Cache-Control", "no-store").json(dispatcher ? dispatcher.view() : { auto: false, vision: false, offers: [] }));
  app.post("/api/dispatch/auto", (req, res) => {
    try {
      if (!dispatcher) return res.sendStatus(503);
      res.json(dispatcher.setAuto(req.body?.on));
    } catch (e) {
      fail(res, e);
    }
  });
  app.post("/api/dispatch/:printer/dismiss", (req, res) => {
    try {
      if (!dispatcher) return res.sendStatus(503);
      res.json(dispatcher.dismiss(req.params.printer));
    } catch (e) {
      fail(res, e);
    }
  });
  // Tick a piece as printed (or not) by hand.
  app.post("/api/orders/:id/pieces", (req, res) => {
    try {
      if (!orderPrints) return res.sendStatus(503);
      const { plan } = planFor(req.params.id);
      const piece = plan.flatMap((g) => g.pieces).find((p) => p.assetId === req.body?.assetId);
      if (!piece) throw Error("That piece isn't part of this order");
      const total = plan.flatMap((g) => g.pieces).filter((p) => p.assetId === piece.assetId).reduce((n, p) => n + p.needed, 0);
      orderPrints.set(req.params.id, piece.assetId, Math.min(total, Math.max(0, Number(req.body?.done) | 0)));
      res.json({ printPlan: planFor(req.params.id).plan });
    } catch (e) {
      fail(res, e);
    }
  });
  app.post("/api/printers/:id/:action", async (req, res) => {
    try {
      await printers.control(req.params.id, req.params.action);
      res.json({ ok: true, machines: printers.snapshot() });
    } catch (e) {
      fail(res, e);
    }
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Endpoint not found" }),
  );
  app.use(
    express.static(dist, {
      index: "index.html",
      dotfiles: "deny",
      setHeaders: (res) => res.setHeader("Cache-Control", "no-store"),
    }),
  );
  // App pages (/orders, /library/<id>, …) all load the single-page app.
  app.get(APP_PAGE, (_req, res) =>
    res.set("Cache-Control", "no-store").sendFile(path.join(dist, "index.html")),
  );
  app.use((_req, res) => res.status(404).send("Not found"));
  return { app, close: () => db.close() };
}
