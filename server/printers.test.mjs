import { test } from "node:test";
import assert from "node:assert/strict";
import { connectionError, printerView } from "./printers.mjs";

test("connection failures are explained in words that say what to do", () => {
  const reset = Object.assign(Error("read ECONNRESET"), { code: "ECONNRESET" });
  assert.match(connectionError(reset, "AMS 2"), /^AMS 2 is refusing connections: too many apps connected\. Close OrcaSlicer's Device tab or Bambu Handy/);
  assert.match(connectionError(Object.assign(Error("Connection refused: Not authorized"), { code: 5 }), "AMS 2"), /rejected the access code/);
  assert.match(connectionError(Error("Printer certificate changed"), "AMS 2"), /certificate changed/);
  assert.match(connectionError(Object.assign(Error("connect EHOSTUNREACH 10.0.0.72:8883"), { code: "EHOSTUNREACH" }), "AMS 2"), /^Can't reach AMS 2 on the network/);
  assert.match(connectionError(Error("weird"), "AMS 2"), /connection failed/);
  // The reason travels with the printer's status.
  const view = printerView({ serial: "S", name: "AMS 2" }, { connected: false, seen: null, data: {}, error: connectionError(reset, "AMS 2") });
  assert.equal(view.state, "Offline");
  assert.match(view.error, /too many apps connected/);
});
