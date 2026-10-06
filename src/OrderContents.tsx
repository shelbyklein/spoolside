import { Package } from "lucide-react";
import type { Order, OrderItem } from "./order-model";

const swatch = (c?: string) => (c && CSS.supports("color", c) ? c.toLowerCase() : undefined);

export function ItemThumb({ src, alt, size = 52 }: { src?: string; alt: string; size?: number }) {
  return (
    <span className="item-thumb" style={{ width: size, height: size }}>
      {src ? (
        <img src={src} alt={alt} loading="lazy" onError={(e) => (e.currentTarget.style.display = "none")} />
      ) : (
        <Package size={size * 0.4} aria-hidden="true" />
      )}
    </span>
  );
}

function itemLine(item: OrderItem) {
  const bits = [item.phone, item.colorway].filter(Boolean);
  return bits.length ? bits.join(" · ") : item.variant.replace("Sample variant · ", "");
}

// Compact "what's in this order" summary for list rows.
export function OrderContents({ order }: { order: Order }) {
  const item = order.items[0];
  if (!item) return <span className="order-contents">No line items</span>;
  const units = order.items.reduce((n, i) => n + i.quantity, 0);
  return (
    <span className="order-contents">
      <ItemThumb src={item.image} alt={`${item.colorway || ""} ${item.name}`.trim()} />
      <span className="order-contents-text">
        <strong>
          {swatch(item.colorway) && <span className="color-dot" style={{ background: swatch(item.colorway) }} />}
          {itemLine(item)}
        </strong>
        <span className="part-chips">
          {(item.parts || []).map((p) => (
            <span key={p.name}>{p.name.replace(/ Faceplate$/, "")}</span>
          ))}
          {units > 1 && <span>{units} units</span>}
          {order.items.length > 1 && <span>+{order.items.length - 1} more</span>}
        </span>
      </span>
    </span>
  );
}

// Full item breakdown with a photo for the case and each faceplate.
export function ItemBreakdown({ item }: { item: OrderItem }) {
  return (
    <div className="item-breakdown">
      <div className="item-hero">
        <ItemThumb src={item.image} alt={`${item.colorway || ""} ${item.name}`.trim()} size={88} />
        <dl>
          {item.phone && (<><dt>Phone</dt><dd>{item.phone}</dd></>)}
          {item.colorway && (<><dt>Colorway</dt><dd>{swatch(item.colorway) && <span className="color-dot" style={{ background: swatch(item.colorway) }} />}{item.colorway}</dd></>)}
          {!item.phone && !item.colorway && (<><dt>Details</dt><dd>{item.variant}</dd></>)}
        </dl>
      </div>
      {!!item.parts?.length && (
        <ul className="part-grid">
          {item.parts.map((p) => (
            <li key={p.name}>
              <ItemThumb src={p.image} alt={`${item.colorway || ""} ${p.name}`.trim()} size={64} />
              <span>{p.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
