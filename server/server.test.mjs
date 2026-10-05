import { test } from "node:test";
import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { createApp } from "./app.mjs";
test("login, protected API, origin rejection, cookie and logout", async () => {
  const salt = "a".repeat(32),
    passwordHash =
      salt + ":" + scryptSync("test-password", salt, 64).toString("hex");
  const { app, close } = createApp({
    username: "test",
    passwordHash,
    origin: "http://localhost",
    secure: false,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + "/api/status")).status, 401);
    assert.equal(
      (await fetch(base + "/", { redirect: "manual" })).headers.get("location"),
      "/login",
    );
    assert.equal(
      (
        await fetch(base + "/login", {
          method: "POST",
          body: new URLSearchParams({
            username: "test",
            password: "test-password",
          }),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/login", {
          method: "POST",
          headers: { Origin: "http://localhost" },
          body: new URLSearchParams({ username: "test", password: "bad" }),
        })
      ).status,
      401,
    );
    const response = await fetch(base + "/login", {
      method: "POST",
      headers: { Origin: "http://localhost" },
      body: new URLSearchParams({
        username: "test",
        password: "test-password",
      }),
      redirect: "manual",
    });
    assert.equal(response.status, 303);
    const cookie = response.headers.get("set-cookie").split(";")[0];
    assert.match(response.headers.get("set-cookie"), /HttpOnly/);
    assert.match(response.headers.get("set-cookie"), /SameSite=Strict/);
    const status = await fetch(base + "/api/status", {
      headers: { Cookie: cookie },
    });
    assert.equal(status.status, 200);
    assert.equal((await status.json()).orders.connected, false);
    assert.equal(
      (
        await fetch(base + "/logout", {
          method: "POST",
          headers: { Cookie: cookie, Origin: "http://evil.test" },
          redirect: "manual",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/logout", {
          method: "POST",
          headers: { Cookie: cookie, Origin: "http://localhost" },
          redirect: "manual",
        })
      ).status,
      303,
    );
    assert.equal(
      (await fetch(base + "/api/status", { headers: { Cookie: cookie } }))
        .status,
      401,
    );
  } finally {
    await new Promise((r) => server.close(r));
    close();
  }
});
test("missing credentials fail closed", () =>
  assert.throws(() => createApp(), /credentials/));

test("trusted proxy clients have independent failed-login limits", async () => {
  const salt = "b".repeat(32),
    hash = salt + ":" + scryptSync("correct", salt, 64).toString("hex");
  const { app, close } = createApp({
    username: "test",
    passwordHash: hash,
    origin: "http://localhost",
    secure: false,
    proxyAddress: "127.0.0.1",
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = (ip, password) =>
    fetch(base + "/login", {
      method: "POST",
      redirect: "manual",
      headers: { Origin: "http://localhost", "CF-Connecting-IP": ip },
      body: new URLSearchParams({ username: "test", password }),
    });
  try {
    for (let i = 0; i < 8; i++)
      assert.equal((await login("198.51.100.1", "bad")).status, 401);
    assert.equal((await login("198.51.100.1", "bad")).status, 429);
    assert.equal((await login("198.51.100.2", "correct")).status, 303);
  } finally {
    await new Promise((r) => server.close(r));
    close();
  }
});
