import express from "express";
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
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://playcase.gg; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
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
  const APP_PAGE = /^\/(overview|printers|orders|library|queue|filament|settings)(\/[0-9a-f-]{36})?\/?$/;
  const safeNext = (value) => (typeof value === "string" && APP_PAGE.test(value) ? value : "");
  const loginPage = (error = false, next = "") =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#102d44"><title>Sign in · Spoolside</title><link rel="stylesheet" href="/auth.css"><link rel="icon" type="image/png" href="/icon-192.png"><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest"></head><body><main><img src="/auth-icon.png" alt="Spoolside artwork"><h1>Spoolside</h1>${error ? '<p role="alert" class="error">Incorrect PIN, or too many attempts.</p>' : ""}<form action="/login" method="post">${next ? `<input type="hidden" name="next" value="${next}">` : ""}<label>PIN<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="current-password" required></label><button type="submit">Sign in</button></form></main></body></html>`;
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
      /^[0-9]{6}$/.test(String(req.body.pin || ""));
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
  app.get("/api/workspace", (_req, res) =>
    workspace
      ? res.json({
          ...workspace.snapshot(),
          machines: printers?.snapshot() || [],
        })
      : res.status(503).json({ error: "Live connections unavailable" }),
  );
  app.put("/api/workspace", (req, res) => {
    if (!workspace)
      return res.status(503).json({ error: "Live connections unavailable" });
    try {
      res.json({
        ...workspace.update(req.body),
        machines: printers?.snapshot() || [],
      });
    } catch (e) {
      res.status(e.status || 400).json({ error: e.message });
    }
  });
  app.post("/api/sync", async (_req, res) => {
    if (!workspace) return res.sendStatus(503);
    await workspace.sync();
    res.json({ ...workspace.snapshot(), machines: printers?.snapshot() || [] });
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
  app.get("/api/assemblies", (_req,res)=>assets ? res.json(assets.assemblies()) : res.status(503).json({error:"Library unavailable"}));
  app.post("/api/assemblies", (req,res)=>{try{if(!assets)return res.sendStatus(503);res.json(assets.saveAssembly(req.body));}catch(e){fail(res,e);}});
  app.put("/api/assemblies/:id",(req,res)=>{try{if(!assets?.assemblies().some(a=>a.id===req.params.id))return res.status(404).json({error:"Assembly not found"});res.json(assets.saveAssembly(req.body,req.params.id));}catch(e){fail(res,e);}});
  app.delete("/api/assemblies/:id",(req,res)=>{assets?.deleteAssembly(req.params.id);res.json({ok:true});});
  app.post("/api/assets/phone-bases",(req,res)=>{try{if(!assets)return res.sendStatus(503);res.json(assets.addPhoneBase(req.body,req.body.designId));}catch(e){fail(res,e);}});
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
  app.patch("/api/library/:id", (req, res) => {
    try { res.json(library.rename(req.params.id, req.body?.name)); } catch (e) { fail(res, e); }
  });
  app.delete("/api/library/:id", (req, res) => {
    try { library.remove(req.params.id); res.json({ ok: true }); } catch (e) { fail(res, e); }
  });
  app.post("/api/printers/:id/print", async (req, res) => {
    try {
      const { fileId, plate, amsMapping, useAms, bedLevelling, bedClear } = req.body || {};
      if (bedClear !== true) throw Error("Confirm the build plate is clear");
      const file = library?.get(String(fileId));
      if (!file) throw Error("Choose a file from the library");
      const plateInfo = file.plates.find((p) => p.index === plate);
      if (!plateInfo) throw Error("Choose a sliced plate");
      const slots = plateInfo.filaments.length ? Math.max(...plateInfo.filaments.map((f) => f.id)) : 0;
      if (useAms && (!Array.isArray(amsMapping) || amsMapping.length !== slots || !amsMapping.every((m) => Number.isInteger(m) && m >= -1 && m <= 3)))
        throw Error("Choose an AMS slot for each filament");
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
