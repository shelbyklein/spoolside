import { test } from "node:test";
import assert from "node:assert/strict";
import { COLORWAYS, colorFamily, deltaE, matchesColorway } from "./colorway.mjs";

test("spool colours read as the colorway a person would call them", () => {
  const spools = {
    "#939393": "grey", "#8C8C90": "grey", "#85abb2": "grey", "#ED0000": "red", "#C12E1F": "red", "#800020": "red",
    "#5898DD": "blue", "#1B2A4A": "blue", "#4169E1": "blue", "#87CEEB": "blue", "#90FF1A": "green", "#00AE42": "green",
    "#1E5631": "green", "#228B22": "green", "#FFFFFF": "white", "#F7F3F0": "white", "#000000": "black", "#262626": "black",
    "#F7D959": "yellow", "#FFC000": "yellow", "#FF7A00": "orange", "#FF6A13": "orange", "#AE96D4": "purple",
    "#6A3FA0": "purple", "#5E43B7": "purple", "#FF4FA0": "pink", "#E0218A": "pink", "#00B5C0": "teal",
  };
  for (const [hex, want] of Object.entries(spools)) assert.equal(colorFamily(hex), want, hex);
  for (const [name, hex] of Object.entries(COLORWAYS)) assert.equal(colorFamily(hex), name, `reference ${name}`);
});

test("a grey spool never passes for green, however close its RGB numbers are", () => {
  assert.equal(matchesColorway("#939393", "Green"), false);
  assert.equal(matchesColorway("#90FF1A", "Green"), true);
  assert.equal(matchesColorway("#939393", "Gray"), true, "gray and grey are the same colorway");
  assert.equal(matchesColorway("#939393", "Galaxy"), false, "unknown colorways never match");
  assert.equal(matchesColorway("", "Green"), false);
  assert.ok(deltaE("#90FF1A", COLORWAYS.green) < deltaE("#939393", COLORWAYS.green));
  assert.equal(deltaE("#123456", "#123456"), 0);
});
