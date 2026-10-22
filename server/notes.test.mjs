import { test } from "node:test";
import assert from "node:assert/strict";
import { Notes } from "./notes.mjs";

test("home notes: add, edit, finish; optional order number", () => {
  let t = 1000;
  const notes = new Notes(":memory:", () => t++);
  try {
    assert.throws(() => notes.add({ text: "  " }), /what needs doing/);
    assert.throws(() => notes.add({ text: "x", order: "abc" }), /digits/);
    let list = notes.add({ text: "  Send Jane a replacement d-pad membrane  ", order: "10199" });
    assert.deepEqual(list.map((n) => [n.text, n.order]), [["Send Jane a replacement d-pad membrane", "#10199"]]);
    list = notes.add({ text: "Refund shipping for the late order", order: "#10190" });
    assert.equal(list[1].order, "#10190");
    list = notes.update(list[0].id, { text: "Send Jane a replacement d-pad and A/B membranes", order: "" });
    assert.deepEqual([list[0].text, list[0].order], ["Send Jane a replacement d-pad and A/B membranes", null]);
    assert.equal(notes.remove(list[0].id).length, 1);
    assert.throws(() => notes.update("missing", { text: "x" }), /gone/);
  } finally {
    notes.close();
  }
});
