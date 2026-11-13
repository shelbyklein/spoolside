// What a product costs to make: printed parts priced by the filament they use, bought parts by the
// piece, and an order's packaging. Missing prints, mappings or prices are listed, never counted as $0.
import { caseAssets, lineSize, optionStyle, faceplateAssemblies } from "./readiness.mjs";

const round = (n) => Math.round(n * 10000) / 10000;

// Volume of a closed STL mesh in mm³ (binary or ASCII), from the signed volumes of its triangles.
export function stlVolume(buf) {
  let v = 0;
  const tri = (a, b, c) => { v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6; };
  if (buf.length > 84) {
    const n = buf.readUInt32LE(80);
    if (84 + n * 50 === buf.length) {
      const p = (o) => [buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)];
      for (let i = 0; i < n; i++) { const o = 84 + i * 50 + 12; tri(p(o), p(o + 12), p(o + 24)); }
      return Math.abs(v);
    }
  }
  const pts = [...buf.toString("utf8").matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].map((m) => m.slice(1).map(Number));
  for (let i = 0; i + 2 < pts.length; i += 3) tri(pts[i], pts[i + 1], pts[i + 2]);
  return Math.abs(v);
}

// assets/assemblies/files as returned by their lists; supplies: { settings, best(id) } where best gives
// { price, unit, name, delivered, stale } per gram or piece (or null); volumeOf(assetId) gives mm³ or null.
export function costing({ assets, assemblies, files, supplies, volumeOf }) {
  const asset = (id) => assets.find((a) => a.id === id);
  const settings = supplies.settings;

  // The sliced plate an asset is printed from: PlayCase prints only, most specific plate first, then newest.
  function plateFor(assetId) {
    const found = [];
    for (const f of files.filter((f) => f.scope !== "personal"))
      for (const p of f.plates) if ((p.coverage || []).some((c) => c.assetId === assetId)) found.push({ file: f, plate: p });
    found.sort((a, b) => a.plate.coverage.length - b.plate.coverage.length || String(b.file.updated || b.file.created).localeCompare(String(a.file.updated || a.file.created)));
    return found[0] || null;
  }

  // One printed piece of an asset: its share of the plate's grams of each filament, priced per gram.
  function printedPiece(a) {
    const hit = plateFor(a.id);
    if (!hit) return { missing: `${a.name}: no sliced print linked` };
    const { file, plate } = hit, covered = plate.coverage.map((c) => c.assetId), n = covered.length;
    const each = Math.max(1, Math.round((plate.quantity || n) / n)); // pieces of each covered asset on the plate
    const vols = covered.map((id) => volumeOf(id));
    let estimated = vols.some((v) => !v);
    const weights = vols.map((v) => (estimated ? 1 : v) * each);
    const share = weights[covered.indexOf(a.id)] / weights.reduce((s, w) => s + w, 0) / each;
    const fils = plate.filaments?.length ? plate.filaments : [{ id: 1, type: "", grams: plate.grams }];
    if (fils.length > 1 && fils.some((f) => !f.grams)) estimated = true;
    let cost = 0, grams = 0;
    const uses = [];
    for (const f of fils) {
      const g = (f.grams || plate.grams / fils.length) * share;
      const supplyId = file.filamentSupplies?.[f.id] ?? settings.filamentMap?.[f.type];
      if (!supplyId) return { missing: `${a.name}: filament ${f.type || "?"} on "${file.name}" isn't matched to a supply` };
      const price = supplies.best(supplyId);
      if (!price) return { missing: `${a.name}: no price for ${supplies.name?.(supplyId) || supplyId}` };
      cost += g * price.price; grams += g;
      uses.push({ supply: price.name, grams: round(g), perGram: price.price });
    }
    return { cost, grams, uses, estimated, print: file.name };
  }

  function partLine(component) {
    const a = asset(component.assetId), q = component.quantity || 1;
    if (!a) return { name: "Missing part", quantity: q, cost: null, missing: "A part in this assembly no longer exists" };
    if (a.type === "Phone" || a.type === "Cut template") return null;
    if (a.type === "Purchased") {
      const price = supplies.best(a.supplyId);
      if (!price) return { assetId: a.id, name: a.name, quantity: q, kind: "bought", cost: null, missing: `${a.name}: no price for its supply` };
      return { assetId: a.id, name: a.name, quantity: q, kind: "bought", unitCost: round(price.price), cost: round(price.price * q), supply: price.name, delivered: price.delivered };
    }
    const piece = printedPiece(a);
    if (piece.missing) return { assetId: a.id, name: a.name, quantity: q, kind: "printed", cost: null, missing: piece.missing };
    return { assetId: a.id, name: a.name, quantity: q, kind: "printed", unitCost: round(piece.cost), cost: round(piece.cost * q), grams: round(piece.grams * q), uses: piece.uses, estimated: piece.estimated, print: piece.print };
  }

  const summarize = (parts, extra = {}) => {
    const priced = parts.filter((p) => p.cost !== null);
    return { total: round(priced.reduce((s, p) => s + p.cost, 0)), complete: priced.length === parts.length, estimated: parts.some((p) => p.estimated), missing: parts.filter((p) => p.missing).map((p) => p.missing), parts, ...extra };
  };

  // Cost of one unit of an assembly. Removed parts don't count.
  function assemblyCost(assembly) {
    return summarize(assembly.components.map(partLine).filter(Boolean), { id: assembly.id, name: assembly.name });
  }

  // An order: each line's case (its case assembly when one exists, else the case print) and faceplate
  // assemblies, times quantity, plus packaging chosen from what's in the order: one box, and a bubble
  // pouch for every case and every faceplate.
  function orderCost(order) {
    const lines = [], missing = [];
    let units = 0, pieces = 0; // pieces: cases and faceplates, each packed in its own bubble pouch
    for (const item of order.items || []) {
      const qty = Math.max(1, Number(item.quantity) || 1);
      units += qty;
      if (!item.phone) { missing.push(`${item.name}: phone model unknown`); continue; }
      pieces += qty * (1 + (item.parts || []).length);
      const cases = caseAssets(item.phone, assets);
      if (cases.length !== 1) missing.push(`${item.phone}: case missing or ambiguous`);
      else {
        const caseAssembly = assemblies.find((x) => x.type === "Case" && x.components.some((c) => c.assetId === cases[0].id));
        const c = caseAssembly ? assemblyCost(caseAssembly) : summarize([partLine({ assetId: cases[0].id, quantity: 1 })]);
        lines.push({ label: `${item.phone} case`, quantity: qty, unit: c.total, cost: round(c.total * qty), complete: c.complete, missing: c.missing });
      }
      for (const option of item.parts || []) {
        const style = optionStyle(option.name), matches = style ? faceplateAssemblies(style, lineSize(item.phone), assets, assemblies) : [];
        if (matches.length !== 1) { missing.push(`${option.name}: assembly missing or ambiguous`); continue; }
        const f = assemblyCost(matches[0]);
        lines.push({ label: matches[0].name + " faceplate", quantity: qty, unit: f.total, cost: round(f.total * qty), complete: f.complete, missing: f.missing });
      }
    }
    // A single case on its own ships in the small box; anything more in the large one.
    const onlyCase = (order.items || []).length === 1 && units === 1 && !(order.items[0].parts || []).length;
    const pack = [[onlyCase ? "small" : "large", onlyCase ? "Box (case only)" : "Box", 1], ["pouch", "Bubble pouch", pieces * (settings.pouchesPerPiece ?? 1)]];
    for (const [key, label, q] of pack) {
      if (!q) continue;
      const id = settings.packaging?.[key], price = id ? supplies.best(id) : null;
      if (!price) { missing.push(`${label}: no packaging supply priced`); lines.push({ label, quantity: q, cost: null, complete: false }); continue; }
      lines.push({ label: key === "small" ? `${price.name} (case only)` : price.name, quantity: q, unit: round(price.price), cost: round(price.price * q), complete: true });
    }
    const priced = lines.filter((l) => l.cost !== null);
    const all = [...missing, ...lines.flatMap((l) => l.missing || [])];
    return { total: round(priced.reduce((s, l) => s + l.cost, 0)), complete: !all.length && lines.every((l) => l.complete), missing: [...new Set(all)], lines };
  }

  return { assemblyCost, orderCost, printedPiece };
}
