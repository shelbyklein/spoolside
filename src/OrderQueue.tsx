import type { Order, PrintGroup } from './order-model';
import type { QueueEntry } from './live-workspace';
export function OrderQueue({ entries, orders, abbreviated, onPrint, onOpen }: { entries: QueueEntry[]; orders: Order[]; abbreviated: boolean; onPrint: (order: Order, group: PrintGroup) => void; onOpen: () => void }) {
  const shown = abbreviated ? entries.slice(0, 5) : entries;
  return <section className="panel order-queue" aria-label="Order print queue">
    <div className="section-top"><div><h2>Print queue</h2><p>Remaining order prints · oldest first</p></div><span>{entries.length} needed</span></div>
    {!entries.length && <p className="queue-empty">No order prints waiting. New processing orders appear here automatically.</p>}
    {shown.map((entry, i) => {
      const order = orders.find(o => o.id === entry.orderId);
      if (!order) return null;
      const group = entry.group;
      const total = group?.pieces.reduce((n, p) => n + p.needed, 0) || 0;
      const done = group?.pieces.reduce((n, p) => n + p.done, 0) || 0;
      return <article className="order-queue-row" key={`${entry.orderId}:${group?.key || i}`} aria-label={`${order.number} ${group?.label || 'review'}`}>
        <div className="queue-order"><strong>{order.number}</strong><small>{order.placed}</small></div>
        <div className="queue-required"><strong>{group?.label === 'case' ? 'Case' : group?.label || 'Order requirements'}</strong><span>{order.items[Number(group?.key.split(':')[0] || 0)]?.colorway || ''}{total ? ` · ${done}/${total} printed` : ''}</span><small>{group?.pieces.filter(p => p.done < p.needed).map(p => `${p.name}${p.needed - p.done > 1 ? ` ×${p.needed - p.done}` : ''}`).join(' · ')}</small>{entry.missing.length > 0 && <small className="queue-blocked">Missing sliced plate: {entry.missing.join(', ')}</small>}</div>
        {entry.blocked ? <span className="queue-blocked">{entry.blocked}</span> : group?.next && <button className="primary" onClick={() => onPrint(order, group)}>Print {group.label}</button>}
      </article>;
    })}
    {abbreviated && entries.length > 5 && <button className="text-button queue-more" onClick={onOpen}>View all {entries.length} required prints →</button>}
  </section>;
}
