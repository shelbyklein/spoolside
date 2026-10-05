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
  username,
  passwordHash,
  origin = "https://spoolside.shelbyklein.com",
  secure = true,
  proxyAddress,
  workspace,
  printers,
} = {}) {
  if (
    !username ||
    !passwordHash ||
    !/^([a-f0-9]{32}):([a-f0-9]{128})$/.test(passwordHash)
  )
    throw new Error("Valid server-side login credentials are required.");
  const db = new DatabaseSync(database);
  db.exec(
    "CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL)",
  );
  const app = express();
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false, limit: "4kb" }));
  app.use(express.json({ limit: "2mb" }));
  const attempts = new Map();
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
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#102d44"><title>Sign in · Spoolside</title><link rel="stylesheet" href="/auth.css"></head><body><main><img src="/auth-icon.png" alt="Spoolside artwork"><h1>Your workshop awaits.</h1><p>Sign in to Spoolside.</p>${error ? '<p role="alert" class="error">Sign-in failed. Check your details, or wait a few minutes before trying again.</p>' : ""}<form action="/login" method="post"><label>Username<input name="username" autocomplete="username" required maxlength="80"></label><label>Password<input name="password" type="password" autocomplete="current-password" required maxlength="256"></label><button type="submit">Sign in</button></form><footer>Spoolside · Shelby’s workshop</footer></main></body></html>`;
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
    const prior = attempts.get(ip);
    if (prior && prior.until > now && prior.count >= 8)
      return res.status(429).type("html").send(loginPage(true));
    const [salt, expected] = passwordHash.split(":");
    const candidate = scryptSync(
      String(req.body.password || "").slice(0, 256),
      salt,
      64,
    );
    const valid =
      timingSafeEqual(candidate, Buffer.from(expected, "hex")) &&
      req.body.username === username;
    if (!valid) {
      attempts.set(ip, {
        count: prior && prior.until > now ? prior.count + 1 : 1,
        until: now + 10 * 60 * 1000,
      });
      return res.status(401).type("html").send(loginPage(true));
    }
    attempts.delete(ip);
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
