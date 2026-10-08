const norm = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function orderReadiness(order, assets, assemblies, files) {
  const review = [], missing = [], required = new Map();
  const requireAsset = a => required.set(a.id, a);
  if (order.sourceReview) review.push('Store items changed: review requirements');
  if (!order.items?.length) review.push('No order items');
  for (const item of order.items || []) {
    if (!item.phone) { review.push(`${item.name}: phone model or requirements unknown`); continue; }
    const cases = assets.filter(a => a.type === 'Case' && a.generation === 3 && norm(a.fit.phone) === norm(item.phone));
    if (cases.length !== 1) review.push(`${item.phone}: case missing or ambiguous`);
    else requireAsset(cases[0]);
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
      const assembly = matches[0];
      if (!assembly.components.length) review.push(`${assembly.name}: no active parts`);
      // Parts (buttons, membranes, bridges, inserts) are printed ahead in bulk, so only the
      // faceplate pieces printed per order need sliced files.
      for (const c of assembly.components) {
        const a = assets.find(x => x.id === c.assetId);
        if (!a) review.push(`${assembly.name}: missing part`); else if (a.type !== 'Part') requireAsset(a);
      }
    }
  }
  // Ready once every case and faceplate piece has a sliced plate linked; STL versions don't matter.
  const linked = new Set(files.flatMap(f => f.plates.flatMap(p => p.coverage || [])).map(c => c.assetId));
  for (const a of required.values()) if (!linked.has(a.id)) missing.push(`${a.name}: no sliced file`);
  return {status: review.length ? 'review' : missing.length ? 'missing' : 'ready', reasons: [...new Set([...review, ...missing])], required: required.size};
}
