const norm = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// What an order needs printed, grouped the way it's printed: each item's case, then each faceplate
// (its top and bottom pieces). Parts (buttons, membranes, bridges, inserts) are printed ahead in bulk.
export function orderRequirements(order, assets, assemblies) {
  const review = [], groups = [];
  if (order.sourceReview) review.push('Store items changed: review requirements');
  if (!order.items?.length) review.push('No order items');
  (order.items || []).forEach((item, n) => {
    const qty = Math.max(1, Number(item.quantity) || 1);
    if (!item.phone) { review.push(`${item.name}: phone model or requirements unknown`); return; }
    const cases = assets.filter(a => a.type === 'Case' && norm(a.fit.phone) === norm(item.phone));
    if (cases.length !== 1) review.push(`${item.phone}: case missing or ambiguous`);
    else groups.push({ key: `${n}:case`, label: 'case', item: item.id, pieces: [{ asset: cases[0], needed: qty }] });
    const size = /plus|pro max/i.test(item.phone) ? 'Plus' : 'Standard';
    // Missing options on a kit must not silently mean case-only.
    if (!item.parts?.length && !/case only/i.test(item.name)) review.push(`${item.name}: faceplate requirements not specified`);
    for (const option of item.parts || []) {
      const style = option.name.match(/\b(handheld|ds|classic)\b/i)?.[1];
      if (!style) { review.push(`${option.name}: requirements unknown`); continue; }
      const matches = assemblies.filter(a => a.type === 'Faceplate' && a.components.some(c => {
        const part = assets.find(x => x.id === c.assetId);
        return part?.type === 'Faceplate' && norm(part.fit.style) === norm(style) && norm(part.fit.size) === norm(size);
      }));
      if (matches.length !== 1) { review.push(`${style} ${size}: assembly missing or ambiguous`); continue; }
      const assembly = matches[0], pieces = [];
      if (!assembly.components.length) review.push(`${assembly.name}: no active parts`);
      for (const c of assembly.components) {
        const a = assets.find(x => x.id === c.assetId);
        if (!a) review.push(`${assembly.name}: missing part`);
        else if (a.type !== 'Part') pieces.push({ asset: a, needed: qty * Math.max(1, Number(c.quantity) || 1) });
      }
      const label = `${style.length <= 2 ? style.toUpperCase() : style[0].toUpperCase() + style.slice(1).toLowerCase()} faceplate`;
      if (pieces.length) groups.push({ key: `${n}:${norm(style)}`, label, item: item.id, pieces });
    }
  });
  return { review, groups };
}
// The sliced plates linked to each asset.
const platesFor = (files) => {
  const map = new Map();
  for (const f of files) for (const p of f.plates) for (const c of p.coverage || []) {
    if (!map.has(c.assetId)) map.set(c.assetId, []);
    map.get(c.assetId).push({ fileId: f.id, fileName: f.name, plate: p.index });
  }
  return map;
};
export function orderReadiness(order, assets, assemblies, files) {
  const { review, groups } = orderRequirements(order, assets, assemblies);
  const linked = platesFor(files), missing = [], required = new Map();
  for (const g of groups) for (const p of g.pieces) required.set(p.asset.id, p.asset);
  // Ready once every case and faceplate piece has a sliced plate linked; STL versions don't matter.
  for (const a of required.values()) if (!linked.has(a.id)) missing.push(`${a.name}: no sliced file`);
  return {status: review.length ? 'review' : missing.length ? 'missing' : 'ready', reasons: [...new Set([...review, ...missing])], required: required.size};
}
// The print buttons for an order: each group with its pieces, how many are printed, and the plate to print.
// `printed` maps assetId -> pieces already printed for this order; they're credited to groups in order.
export function orderPrintPlan(order, assets, assemblies, files, printed = {}) {
  const { groups } = orderRequirements(order, assets, assemblies), linked = platesFor(files), left = { ...printed };
  return groups.map(g => {
    const pieces = g.pieces.map(({ asset, needed }) => {
      const done = Math.min(needed, left[asset.id] || 0);
      left[asset.id] = (left[asset.id] || 0) - done;
      return { assetId: asset.id, name: asset.name, needed, done, plates: linked.get(asset.id) || [] };
    });
    const next = pieces.find(p => p.done < p.needed && p.plates.length) || null;
    return { key: g.key, label: g.label, pieces, done: pieces.every(p => p.done >= p.needed), next: next && { assetId: next.assetId, name: next.name, ...next.plates[0] } };
  });
}
