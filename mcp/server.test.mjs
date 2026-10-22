import { test } from "node:test";
import assert from "node:assert/strict";
import { findPrinter, defaultMapping } from "./server.mjs";

test("printers can be named loosely", () => {
  const list = [{ id: "0309CA460601661", name: "Membrane" }, { id: "X3", name: "AMS 3" }];
  assert.equal(findPrinter(list, "membrane").id, "0309CA460601661");
  assert.equal(findPrinter(list, "ams3").name, "AMS 3");
  assert.equal(findPrinter(list, "0309ca460601661").name, "Membrane");
  assert.throws(() => findPrinter(list, "Desk"), /Printers: Membrane, AMS 3/);
});

test("AMS slots go to the same material with the nearest color", () => {
  const trays = [{ slot: 0, type: "TPU-AMS", color: "#5898DD" }, { slot: 1, type: "TPU-AMS", color: "#E00000" }, { slot: 2, type: "PLA", color: "#ED0000" }];
  assert.deepEqual(defaultMapping({ filaments: [{ id: 1, type: "TPU-AMS", color: "#FF0000" }] }, trays), [1]);
  assert.deepEqual(defaultMapping({ filaments: [{ id: 2, type: "PLA", color: "#FF0000" }] }, trays), [-1, 2]);
});
