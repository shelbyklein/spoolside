// Imports Gen 3 PlayCase STLs from the Dropbox print-file folders into Spoolside.
// Usage: node scripts/import-assets.mjs [--dry-run] [--site https://spoolside.shelbyklein.com]
// Re-running updates existing assets (matched by source path) and keeps their status and notes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.join(os.homedir(), "Dropbox (Personal)/Work/Playcase/Product/Print Files");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const site = args.includes("--site") ? args[args.indexOf("--site") + 1] : "https://spoolside.shelbyklein.com";

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.toLowerCase().endsWith(".stl") ? [path.join(dir, e.name)] : [],
  );

const STYLES = { Handheld: "Handheld", DS: "DS", SNES: "Classic", "3DS": "3DS", N64: "N64", MAME: "MAME", Keyboard: "Keyboard" };
const SOLD = ["Handheld", "DS", "Classic"];

// Returns asset metadata for one file, or null to skip it.
export function classify(rel) {
  const parts = rel.split("/");
  const file = parts.at(-1).replace(/\.stl$/i, "");
  const [top] = parts;
  if (top === "Faceplate Sleeves") {
    const match=file.match(/^(handheld|classic|ds|3ds|n64|genesis)( plus)? sleeve$/i);
    const style=match ? ({handheld:"Handheld",classic:"Classic",ds:"DS","3ds":"3DS",n64:"N64",genesis:"Genesis"}[match[1].toLowerCase()]) : "Unclassified";
    return {type:"Sleeve",name:match ? `${style}${match[2] ? " Plus" : ""} Sleeve` : file,fit:{style,size:match ? (match[2] ? "Plus" : "Standard") : "",piece:"Sleeve"},status:"Needs check",note:match ? "Sleeve imported; verify fit." : "Identify sleeve model and fit."};
  }
  if (top === "Cases") {
    if (/chamfer/i.test(file)) return null; // stray faceplate piece in Cases/15
    const phone = file.replace(/\s+(Phone\s+)?Case(\s+Rounded)?$/i, "").replace(/^s26$/i, "Samsung S26");
    const asset = { type: "Case", name: `${phone} Case${/rounded/i.test(file) ? " (Rounded)" : ""}`, fit: { phone }, status: "Current" };
    if (rel === "Cases/16/iPhone 16 Pro Case.stl")
      Object.assign(asset, { name: "iPhone 16 Pro Case (older)", status: "Retired", note: "Replaced by iPhone 16 Pro Phone Case, which the current-orders project uses." });
    if (/rounded/i.test(file)) Object.assign(asset, { status: "Needs check", note: "Rounded variant. Which S26 case ships?" });
    return asset;
  }
  if (top === "Faceplates") {
    const style = STYLES[parts[1]];
    const size = parts.includes("Plus") || /\bPlus\b/.test(file) ? "Plus" : "Standard";
    const piece = file.match(/ - (Top|Bottom)$/)?.[1] || file;
    const ridges = parts.includes("Ridges");
    const asset = {
      type: "Faceplate",
      name: ["Top", "Bottom"].includes(piece) ? `${style}${size === "Plus" ? " Plus" : ""} – ${piece}${ridges ? " (Ridges)" : ""}` : `${style} – ${file}`,
      fit: { style, size, piece },
      status: "Current",
    };
    if (style === "MAME") Object.assign(asset, { status: "Experimental" });
    else if (!SOLD.includes(style)) Object.assign(asset, { status: "Experimental", note: "Not sold in the store yet." });
    if (style === "Classic" && piece === "Top" && size === "Standard")
      Object.assign(asset, ridges ? { note: "Ridges version ships." } : { status: "Retired", note: "Replaced by the Ridges top." });
    if (SOLD.includes(style) && piece === "Top" && !ridges)
      asset.note ||= "Needs a Ridges version.";
    return asset;
  }
  if (top === "Parts") {
    if (parts.includes("Orca") || file === "dpad") return null;
    const asset = { type: "Part", name: file, fit: { piece: file }, status: "Current" };
    const rules = {
      "Faceplate Trigger Touch Points 5.2": { name: "Faceplate Trigger Touch Points", note: "5.2 mm version (current)." },
      "Faceplate Trigger Touch Points 5.6": { status: "Retired", note: "5.6 mm version; 5.2 is current." },
      "start select membrane": { name: "Start/Select Membrane" },
      "start select membrane v2": { name: "Start/Select Membrane (v2)", status: "Retired", note: "Older than the plain start select membrane." },
      "AB - outie + p5mm": { name: "AB Buttons", fit: { style: "Handheld", piece: "AB buttons" } },
      "abxy outie": { name: "ABXY Buttons", fit: { style: "Classic", piece: "ABXY buttons" } },
      "Triggers 2026": { name: "Paddle", fit: { piece: "Paddle" } },
      "AB Button membrane": { name: "AB Button Membrane", fit: { style: "Handheld", piece: "AB membrane" } },
      "dpad membrane soft": { name: "D-pad Membrane (Soft)" },
      "DS Trigger": { name: "DS Faceplate Bridge", fit: { style: "DS", piece: "Faceplate bridge" } },
    };
    return { ...asset, ...(rules[file] || {}) };
  }
  return null;
}

async function main() {
  const folders = args.includes("--sleeves-only") ? ["Faceplate Sleeves"] : ["Cases", "Faceplates", "Faceplate Sleeves", "Parts/2026"];
  const files = folders.flatMap((d) => walk(path.join(ROOT, d)));
  const plan = files.map((f) => ({ file: f, rel: path.relative(ROOT, f), meta: classify(path.relative(ROOT, f)) }));
  for (const p of plan) console.log(p.meta ? `${p.meta.status.padEnd(12)} ${p.meta.type.padEnd(9)} ${p.meta.name}` : `skip         ${p.rel}`);
  if (dryRun) return;
  const pin = fs.readFileSync(path.join(os.homedir(), ".config/spoolside/pin.txt"), "utf8").match(/\d{6}/)[0];
  const login = await fetch(site + "/login", { method: "POST", headers: { Origin: site }, body: new URLSearchParams({ pin }), redirect: "manual" });
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw Error("Login failed");
  let ok = 0;
  for (const p of plan.filter((p) => p.meta)) {
    const r = await fetch(site + "/api/assets", {
      method: "POST",
      headers: { Cookie: cookie, Origin: site, "Content-Type": "application/octet-stream", "X-Asset": encodeURIComponent(JSON.stringify({ ...p.meta, generation: 3, source: p.rel })) },
      body: fs.readFileSync(p.file),
    });
    if (r.ok) ok++;
    else if (r.status === 409) console.log("skip (deleted in Spoolside)", p.rel);
    else console.error("FAILED", p.rel, (await r.json().catch(() => ({}))).error);
  }
  console.log(`Imported ${ok} of ${plan.filter((p) => p.meta).length} assets.`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
