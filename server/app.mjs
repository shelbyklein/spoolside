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
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
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
  const loginPage = (error = false) =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#102d44"><title>Sign in · Spoolside</title><link rel="stylesheet" href="/auth.css"></head><body><main><img src="/auth-icon.png" alt="Spoolside artwork"><h1>Your workshop awaits.</h1><p>Enter your six-digit PIN to open Spoolside.</p>${error ? '<p role="alert" class="error">Sign-in failed. Check your PIN, or wait a few minutes before trying again.</p>' : ""}<form action="/login" method="post"><label>PIN<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="current-password" required aria-describedby="pin-help"></label><p id="pin-help">Your six-digit workshop PIN.</p><button type="submit">Sign in</button></form><footer>Spoolside · Shelby’s workshop</footer></main></body></html>`;
  app.get("/login", (_req, res) => res.type("html").send(loginPage()));
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
      return res.status(429).type("html").send(loginPage(true));
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
      return res.status(401).type("html").send(loginPage(true));
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
    res.redirect(303, "/");
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
      return res.redirect(303, "/login");
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
  app.use((_req, res) => res.status(404).send("Not found"));
  return { app, close: () => db.close() };
}
