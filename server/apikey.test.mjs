import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { scryptSync } from "node:crypto";
import { createApp } from "./app.mjs";

test("API keys sign in /api/ requests without a cookie or origin, and can be revoked", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spoolside-key-"));
  const database = path.join(dir, "db.sqlite");
  const run = (...args) => execFileSync("node", [new URL("./apikey.mjs", import.meta.url).pathname, ...args], { env: { ...process.env, SPOOLSIDE_DB: database } }).toString().trim();
  const salt = "c".repeat(32);
  const calls = [];
  const printers = { snapshot: () => [], control: async (id, action) => calls.push([action, id]) };
  const { app, close } = createApp({ database, pinHash: salt + ":" + scryptSync("12345678", salt, 64).toString("hex"), origin: "http://localhost", secure: false, printers });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const key = run("create", "claude-mcp");
    assert.match(key, /^sps_[0-9a-f]{64}$/);
    assert.match(run("list"), /claude-mcp\tcreated .*\tlast used never/);
    const auth = { Authorization: `Bearer ${key}` };
    assert.equal((await fetch(base + "/api/repeats")).status, 401, "no key, no cookie: signed out");
    assert.equal((await fetch(base + "/api/repeats", { headers: auth })).status, 200);
    // Actions work without a browser Origin header.
    assert.equal((await fetch(base + "/api/printers/P1/pause", { method: "POST", headers: auth })).status, 200);
    assert.deepEqual(calls, [["pause", "P1"]]);
    assert.equal((await fetch(base + "/api/repeats", { headers: { Authorization: "Bearer sps_wrong" } })).status, 401);
    assert.equal((await fetch(base + "/", { headers: auth })).status, 401, "keys only open the API, not the app pages");
    assert.match(run("list"), /last used 20/);
    assert.equal(run("revoke", "claude-mcp"), "Revoked claude-mcp");
    assert.equal((await fetch(base + "/api/repeats", { headers: auth })).status, 401);
  } finally {
    server.close();
    close?.();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
