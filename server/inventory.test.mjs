import { test } from "node:test";
import assert from "node:assert/strict";
import { Inventory } from "./inventory.mjs";

test("inventory lists case models and faceplate types with hand-entered counts by color", () => {
  const inv = new Inventory(":memory:", () => 1000);
  try {
    const assets = [{ id: "c16", name: "iPhone 16 Pro Max Case", type: "Case" }, { id: "c9", name: "iPhone 9 Phone Case", type: "Case" }, { id: "top", name: "DS – Top", type: "Faceplate" }];
    const assemblies = [{ id: "ds", name: "DS", type: "Faceplate" }, { id: "x", name: "Sleeve kit", type: "Sleeve" }];
    let v = inv.view({ assets, assemblies, orderColors: ["red", "Teal"] });
    assert.deepEqual(v.items.map((i) => [i.kind, i.name]), [["case", "iPhone 9"], ["case", "iPhone 16 Pro Max"], ["faceplate", "DS"]]);
    assert.deepEqual(v.colors, ["Black", "Grey", "Red", "Green", "Blue", "Teal"]);
    inv.set("case", "c16", "gray", 4);
    inv.set("faceplate", "ds", "Red", 2);
    inv.set("faceplate", "ds", "Red", 3);
    v = inv.view({ assets, assemblies });
    assert.deepEqual(v.items.find((i) => i.id === "c16").counts, { Grey: 4 });
    assert.deepEqual(v.items.find((i) => i.id === "ds").counts, { Red: 3 });
    assert.throws(() => inv.set("case", "c16", "Red", -1), /0 to 100000/);
    assert.throws(() => inv.set("spool", "c16", "Red", 1), /case or faceplate/);
    inv.addColor("purple");
    assert.ok(inv.view({ assets, assemblies }).colors.includes("Purple"));
    inv.hide("faceplate", "ds", true);
    v = inv.view({ assets, assemblies });
    assert.equal(v.items.find((i) => i.id === "ds").hidden, true);
    assert.deepEqual(v.items.find((i) => i.id === "ds").counts, { Red: 3 }, "hiding keeps the counts");
    assert.equal(v.items.find((i) => i.id === "c16").hidden, false);
    inv.hide("faceplate", "ds", false);
    assert.equal(inv.view({ assets, assemblies }).items.find((i) => i.id === "ds").hidden, false);
    assert.throws(() => inv.hide("faceplate", "ds", "yes"), /hide or show/);
    inv.set("case", "c16", "Grey", 0);
    assert.deepEqual(inv.view({ assets, assemblies }).items.find((i) => i.id === "c16").counts, {});
  } finally {
    inv.close();
  }
});
