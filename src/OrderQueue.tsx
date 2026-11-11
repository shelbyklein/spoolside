import type { Order, PrintGroup } from './order-model';
import type { Machine, QueueEntry } from './live-workspace';
import type { ReactNode } from 'react';
import { Skeleton } from './Skeleton';
import { ArrowRight } from 'lucide-react';
import { COLORWAYS, colorwayName, matchesColorway } from '../server/colorway.mjs';

const pieceLabel = (g?: PrintGroup | null) => (g?.label === 'case' ? 'Case' : g?.label ? g.label[0].toUpperCase() + g.label.slice(1) : 'Order requirements');
const shortDate = (placed: string) => placed.replace(/, \d{4}$/, '');
// A status the queue can't act on yet, as a pill: printing now in teal, anything waiting on you in amber.
const statusTone = (s: string) => (/printing/i.test(s) ? 'teal' : /review/i.test(s) ? 'red' : 'amber');

// The print queue, grouped by order (oldest first): each order's colour once, then its pieces, each with the
// same Print button. An order whose colour isn't loaded on any printer says so before you open the dialog.
export function OrderQueue({ entries, orders, machines = [], abbreviated, onPrint, onOpen, onOpenOrder, control, placeholder }: { placeholder?: 'loading' | 'unavailable'; entries: QueueEntry[]; orders: Order[]; machines?: Machine[]; abbreviated: boolean; onPrint: (order: Order, group: PrintGroup) => void; onOpen: () => void; onOpenOrder?: (orderId: string) => void; control?: ReactNode; held?: unknown }) {
  const groups: { order: Order; entries: QueueEntry[] }[] = [];
  for (const entry of entries) {
    const order = orders.find(o => o.id === entry.orderId);
    if (!order) continue;
    const g = groups.find(x => x.order.id === order.id);
    if (g) g.entries.push(entry); else groups.push({ order, entries: [entry] });
  }
  const shown = placeholder ? [] : abbreviated ? groups.slice(0, 4) : groups;
  const loaded = (colorway: string) => machines.some(m => (m.trays || []).some(t => /TPU/i.test(t.type) && matchesColorway(t.color, colorway)));
  return <section className="panel order-queue" aria-label="Order print queue">
    <div className="section-top"><h2>Print queue</h2><div className="queue-top-right">{control}{!placeholder && <span className="count">{entries.length} {entries.length === 1 ? 'piece' : 'pieces'} · {groups.length} {groups.length === 1 ? 'order' : 'orders'}</span>}</div></div>
    {placeholder && <Skeleton rows={3} still={placeholder === 'unavailable'} />}
    {!placeholder && !entries.length && <p className="queue-empty">No order prints waiting. New processing orders appear here automatically.</p>}
    {shown.map(({ order, entries: list }) => {
      const colorway = order.items.find(i => i.colorway)?.colorway || '';
      const review = list.every(e => /review/i.test(e.blocked || ''));
      const printable = list.some(e => !e.blocked && e.group?.next);
      const missingColor = printable && colorway && COLORWAYS[colorwayName(colorway)] && machines.length > 0 && !loaded(colorway);
      return <article className="queue-order-group" key={order.id} aria-label={`${order.number} queue`}>
        <div className="queue-order-head">
          <strong>{order.number}</strong>
          {colorway && <span className="sw" style={{ background: COLORWAYS[colorwayName(colorway)] || '#ccc' }} />}
          <small>{[colorway, shortDate(order.placed)].filter(Boolean).join(' · ')}</small>
          {missingColor && <span className="pill amber">No {colorway.toLowerCase()} loaded</span>}
          {review && <><span className="pill red">Needs review</span>{onOpenOrder && <button className="text-button" onClick={() => onOpenOrder(order.id)}>Review order <ArrowRight size={14} /></button>}</>}
        </div>
        {review
          ? <p className="queue-held-pieces">{list.map(e => pieceLabel(e.group)).join(' · ')} <span>held until the order is reviewed</span></p>
          : list.map((entry, i) => {
            const group = entry.group;
            const total = group?.pieces.reduce((n, p) => n + p.needed, 0) || 0;
            const done = group?.pieces.reduce((n, p) => n + p.done, 0) || 0;
            const left = group?.pieces.filter(p => p.done < p.needed).map(p => p.name.replace(new RegExp(`^${pieceLabel(group)}\\s*[-–]\\s*`, 'i'), '')).join(' · ');
            return <div className="order-queue-row" key={`${entry.orderId}:${group?.key || i}`} aria-label={`${order.number} ${group?.label || 'review'}`}>
              <div className="queue-required"><strong>{pieceLabel(group)}</strong><span>{total ? `${done}/${total}` : ''}{left ? `${total ? ' · ' : ''}${left}` : ''}</span>{entry.missing.length > 0 && <small className="queue-blocked">Missing sliced plate: {entry.missing.join(', ')}</small>}</div>
              {entry.blocked ? <span className={`pill ${statusTone(entry.blocked)}`}>{entry.blocked}</span> : group?.next && <button className={missingColor ? 'secondary' : 'primary'} aria-label={`Print ${group.label}`} onClick={() => onPrint(order, group)}>{missingColor ? 'Print…' : 'Print'}</button>}
            </div>;
          })}
      </article>;
    })}
    {abbreviated && groups.length > shown.length && <button className="text-button queue-more" onClick={onOpen}>View all {entries.length} pieces in {groups.length} orders <ArrowRight size={14} /></button>}
  </section>;
}
