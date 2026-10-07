// Imports one .usdz reference per iPhone / Samsung model from the Dropbox Phones folder.
// Usage: node scripts/import-phones.mjs [--dry-run]. Re-running updates files and keeps names/status.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.env.PHONES_ROOT || path.join(os.homedir(), "Dropbox (Personal)/Work/Playcase/Product/Phones");
// SPOOLSIDE_SITE lets this run on the Beelink against the local server, skipping the tunnel.
const site = process.env.SPOOLSIDE_SITE || "https://spoolside.shelbyklein.com";
const origin = "https://spoolside.shelbyklein.com";
// One file per model: no two-phone "Combined" scenes or extra colours; global SIM where offered.
export const PHONES = [
  ["iPhone 11", "iPhone/11 (2019)/iphone-11.usdz"],
  ["iPhone 11 Pro", "iPhone/11 (2019)/Pro/iphone-11-pro.usdz"],
  ["iPhone 12 / 12 mini", "iPhone/12 (2020)/iphone_12_mini_v_iphone_12_black_5G_ios14.usdz"],
  ["iPhone 13", "iPhone/13 (2021)/iphone_13_midnight_5G_ios15.usdz"],
  ["iPhone 13 mini", "iPhone/13 (2021)/mini/iphone_13_mini_midnight_5G_ios15.usdz"],
  ["iPhone 13 Pro", "iPhone/13 (2021)/Pro/iphone_13_pro_graphite_5G_ios15.usdz"],
  ["iPhone 13 Pro Max", "iPhone/13 (2021)/Pro/Max/iphone_13_pro_max_graphite_5G_ios15.usdz"],
  ["iPhone 14", "iPhone/14 (2022)/iphone_14_midnight_5G.usdz"],
  ["iPhone 14 Plus", "iPhone/14 (2022)/Plus/iphone_14_plus_midnight_5G.usdz"],
  ["iPhone 14 Pro", "iPhone/14 (2022)/Pro/iphone_14_pro_space_black_5G.usdz"],
  ["iPhone 14 Pro Max", "iPhone/14 (2022)/Pro/Max/iphone_14_pro_max_space_black_5G.usdz"],
  ["iPhone 15", "iPhone/15 (2023)/iphone_15_black_5G.usdz"],
  ["iPhone 15 Plus", "iPhone/15 (2023)/Plus/iphone_15_plus_black_5G.usdz"],
  ["iPhone 15 Pro", "iPhone/15 (2023)/Pro/iphone_15_pro_black_titanium_5G.usdz"],
  ["iPhone 15 Pro Max", "iPhone/15 (2023)/Pro/Max/iphone_15_pro_max_black_titanium_5G.usdz"],
  ["iPhone 16", "iPhone/16 (2024)/SIM (Global)/iphone-16-black-sim.usdz"],
  ["iPhone 16 Plus", "iPhone/16 (2024)/SIM (Global)/Plus/iphone-16-plus-black-sim.usdz"],
  ["iPhone 16 Pro", "iPhone/16 (2024)/SIM (Global)/Pro/iphone-16-pro-sim-black-titanium.usdz"],
  ["iPhone 16 Pro Max", "iPhone/16 (2024)/SIM (Global)/Pro/Max/iphone-16-pro-max-sim-black-titanium.usdz"],
  ["iPhone 16e", "iPhone/iPhone16e/iphone16_e_black.usdz"],
  ["iPhone 17", "iPhone/17 (2025)/SIM (Global)/iphone-17-p-sim.usdz"],
  ["iPhone 17 Pro", "iPhone/17 (2025)/Pro/iphone-17-pro-p-sim.usdz"],
  ["iPhone Air", "iPhone/17 (2025)/Air/iphone-air-e-sim.usdz"],
  ["iPhone 18 Pro", "iPhone/2026 iPhones/18 (2026)/Pro/iphone-18-pro-p-sim.usdz"],
  ["iPhone Duo", "iPhone/2026 iPhones/Duo/1st Generation (2026)/iPhone_Duo_e-sim_Star-White_Variant.usdz"],
  ["iPhone SE (2nd gen)", "iPhone/SE/2nd Generation (2020)/iphone_se_black_ios13.usdz"],
  ["iPhone SE (3rd gen)", "iPhone/SE/3rd Generation (2022)/iphone_se_3rdgen_midnight.usdz"],
  ["Samsung S21 Ultra", "Samsung/s21/Samsung_Galaxy_S21_Ultra.usdz"],
];

if (import.meta.url === `file://${process.argv[1]}`) {
  const missing = PHONES.filter(([, rel]) => !fs.existsSync(path.join(ROOT, rel)));
  if (missing.length) throw Error("Missing files: " + missing.map(([, r]) => r).join(", "));
  if (process.argv.includes("--dry-run")) { PHONES.forEach(([n, r]) => console.log(n.padEnd(22), r)); process.exit(0); }
  const pin = process.env.SPOOLSIDE_PIN || fs.readFileSync(path.join(os.homedir(), ".config/spoolside/pin.txt"), "utf8").match(/\d{6,8}/)[0];
  const login = await fetch(site + "/login", { method: "POST", headers: { Origin: origin }, body: new URLSearchParams({ pin }), redirect: "manual" });
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw Error("Login failed");
  let ok = 0;
  for (const [name, rel] of PHONES) {
    const meta = { name, generation: 3, status: "Up to date", fit: { phone: name }, note: "Reference model", source: "Phones/" + rel };
    // Large uploads go through the tunnel; retry a dropped connection a few times.
    let r = null;
    for (let attempt = 1; attempt <= 4 && !r; attempt++) {
      try {
        r = await fetch(site + "/api/assets/phones", { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/octet-stream", "X-Asset": encodeURIComponent(JSON.stringify(meta)) }, body: fs.readFileSync(path.join(ROOT, rel)) });
      } catch (e) {
        console.error(`retry ${attempt} for ${name}: ${e.cause?.code || e.message}`);
        await new Promise((done) => setTimeout(done, 2000 * attempt));
      }
    }
    if (r?.ok) ok++; else console.error(r?.status === 409 ? "skip (deleted)" : "FAILED", name, r ? (await r.json().catch(() => ({}))).error : "no connection");
  }
  console.log(`Imported ${ok} of ${PHONES.length} phones.`);
}
