// The queue is a view of order requirements, never another editable job list.
export function reservedPieces(watcher, orderPrints) {
  const taken = new Set(watcher?.inFlight() || []);
  for (const tag of orderPrints?.pending?.values() || [])
    for (const id of tag.assetIds) taken.add(`${tag.orderId}:${id}`);
  return taken;
}
export function printQueue(orders, taken = new Set()) {
  const rows = [];
  const sorted = [...orders].sort((a, b) => (Number(a.number.replace(/\D/g, '')) || 0) - (Number(b.number.replace(/\D/g, '')) || 0));
  for (const order of sorted) {
    if (String(order.commercial).toLowerCase() !== 'processing' || order.assembled) continue;
    const review = order.refundReview || order.sourceReview || order.printReadiness?.status === 'review';
    for (const group of order.printPlan || []) {
      if (group.done) continue;
      const busy = group.pieces.some(p => p.done < p.needed && taken.has(`${order.id}:${p.assetId}`));
      const missing = group.pieces.filter(p => p.done < p.needed && !p.plates.length).map(p => p.name);
      rows.push({ orderId: order.id, group, blocked: review ? 'Review order requirements' : busy ? 'Printing / awaiting result' : !group.next ? 'No sliced plate linked' : null, missing });
    }
    if (review && !(order.printPlan || []).some(g => !g.done))
      rows.push({ orderId: order.id, group: null, blocked: 'Review order requirements', missing: [] });
  }
  return rows;
}
