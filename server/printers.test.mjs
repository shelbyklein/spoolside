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

test("a paused print says why: a pause in the file, or the printer's own code", async () => {
  const { pauseReason, errorCode, printerView } = await import("./printers.mjs");
  assert.equal(errorCode(50364435), "0300-8013");
  assert.equal(errorCode(0), null);
  assert.match(pauseReason({ print_error: 50364435, layer_num: 76, total_layer_num: 77 }), /^Paused at layer 76 of 77: a pause in the file/);
  assert.match(pauseReason({ print_error: 0x07008011, hms: [{}] }), /Paused by the printer \(code 0700-8011\)\. The printer shows an alert/);
  const now = Date.now();
  const v = printerView({ serial: "S", name: "AMS 3" }, { connected: true, seen: now, data: { gcode_state: "PAUSE", print_error: 50364435 } }, now);
  assert.match(v.pauseReason, /a pause in the file/);
  assert.equal(printerView({ serial: "S", name: "AMS 3" }, { connected: true, seen: now, data: { gcode_state: "RUNNING" } }, now).pauseReason, null);
});
