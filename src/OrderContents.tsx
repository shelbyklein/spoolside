import { Package } from "lucide-react";
import type { Order, OrderItem } from "./order-model";

export const swatch = (c?: string) => (c && CSS.supports("color", c) ? c.toLowerCase() : undefined);

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

export function itemLine(item: OrderItem) {
  const bits = [item.phone, item.colorway].filter(Boolean);
  if (bits.length) return bits.join(" · ");
  // Items without a phone or colour (replacement parts, add-ons) are named by the product, plus any real variant.
  const variant = item.variant.replace("Sample variant · ", "");
  return /^No variant details$/i.test(variant) || !variant ? item.name : `${item.name} · ${variant}`;
}

// Every line item in the order, one line each: what it is, its parts, and its quantity when more than one.
export function OrderContents({ order }: { order: Order }) {
  const first = order.items[0];
  if (!first) return <span className="order-contents">No line items</span>;
  const thumb = order.items.find((i) => i.image) || first;
  return (
    <span className="order-contents">
      <ItemThumb src={thumb.image} alt={`${thumb.colorway || ""} ${thumb.name}`.trim()} />
      <span className="order-contents-items">
        {order.items.map((item) => (
          <span key={item.id} className="order-contents-text">
            <strong>
              {swatch(item.colorway) && <span className="color-dot" style={{ background: swatch(item.colorway) }} />}
              {itemLine(item)}
            </strong>
            {((item.parts || []).length > 0 || item.quantity > 1) && (
              <span className="part-chips">
                {(item.parts || []).map((p) => (
                  <span key={p.name}>{p.name.replace(/ Faceplate$/, "")}</span>
                ))}
                {item.quantity > 1 && <span>×{item.quantity}</span>}
              </span>
            )}
          </span>
        ))}
      </span>
    </span>
  );
}
