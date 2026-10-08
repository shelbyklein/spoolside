// Use a category only when every linked asset agrees. Mixed/unlinked prints need a choice.
export function defaultPrinter(file, assets, categories) {
  if (file.printer) return {preferredPrinter:file.printer,printerSource:'Print override'};
  const ids=[...new Set(file.plates.flatMap(p=>(p.coverage || []).map(c=>c.assetId)))];
  const defaults=ids.map(id=>categories.find(c=>c.id===assets.find(a=>a.id===id)?.category)?.printer || null);
  const preferredPrinter=defaults.length && defaults.every(p=>p && p===defaults[0]) ? defaults[0] : null;
  return {preferredPrinter,printerSource:preferredPrinter ? 'Category default' : null};
}
