import { test } from "node:test";
import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { createApp } from "./app.mjs";
test("login, protected API, origin rejection, cookie and logout", async () => {
  const salt = "a".repeat(32),
    pinHash =
      salt + ":" + scryptSync("123456", salt, 64).toString("hex");
  const { app, close } = createApp({
        pinHash,
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
                        pin: "123456",
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
          body: new URLSearchParams({ pin: "bad" }),
        })
      ).status,
      401,
    );
    const response = await fetch(base + "/login", {
      method: "POST",
      headers: { Origin: "http://localhost" },
      body: new URLSearchParams({
                pin: "123456",
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
    hash = salt + ":" + scryptSync("123456", salt, 64).toString("hex");
  const { app, close } = createApp({
        pinHash: hash,
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
      body: new URLSearchParams({ pin: password }),
    });
  try {
    for (let i = 0; i < 8; i++)
      assert.equal((await login("198.51.100.1", "bad")).status, 401);
    assert.equal((await login("198.51.100.1", "bad")).status, 429);
    assert.equal((await login("198.51.100.2", "123456")).status, 303);
  } finally {
    await new Promise((r) => server.close(r));
    close();
  }
});
test('six digit PIN format and failed-attempt lockout persist across app restart',async()=>{
 const fs=await import('node:fs');const os=await import('node:os');const path=await import('node:path');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'spoolside-pin-'));const database=path.join(directory,'test.sqlite');
 const salt='c'.repeat(32);const config={database,pinHash:salt+':'+scryptSync('012345',salt,64).toString('hex'),origin:'http://localhost',secure:false};
 let instance=createApp(config),server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const send=pin=>fetch(`http://127.0.0.1:${server.address().port}/login`,{method:'POST',headers:{Origin:'http://localhost'},body:new URLSearchParams({pin}),redirect:'manual'});
 try {
  for(const pin of ['12345','1234567','abcdef',' 012345','01234x','123.45','000000','999999'])assert.equal((await send(pin)).status,401);
  await new Promise(r=>server.close(r));instance.close();instance=createApp(config);server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  assert.equal((await send('012345')).status,429);
 }finally{await new Promise(r=>server.close(r));instance.close();fs.rmSync(directory,{recursive:true});}
});
test('Home Screen icons and manifest are available before login without exposing APIs',async()=>{
 const salt='d'.repeat(32);const {app,close}=createApp({pinHash:salt+':'+scryptSync('123456',salt,64).toString('hex'),secure:false});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const login=await(await fetch(base+'/login')).text();assert.match(login,/apple-touch-icon.*180x180.*apple-touch-icon.png/);assert.match(login,/manifest.webmanifest/);
  for(const file of ['icon-192.png','icon-512.png','apple-touch-icon.png','manifest.webmanifest']){const r=await fetch(base+'/'+file,{redirect:'manual'});assert.equal(r.status,200);assert.equal(r.headers.get('location'),null);}
  assert.equal((await fetch(base+'/api/workspace')).status,401);
 }finally{await new Promise(r=>server.close(r));close();}
});
