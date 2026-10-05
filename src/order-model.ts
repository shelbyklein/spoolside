export type PrintState = "Queued" | "Printing" | "Accepted" | "Failed";
export type Job = {
  id: string;
  name: string;
  material: string;
  time: string;
  printer: string;
  orderId?: string;
  itemId?: string;
  component?: string;
  units?: number;
  state?: PrintState;
};
export type Recipe = {
  component: string;
  units: number;
  material: string;
  time: string;
};
export type OrderItem = {
  id: string;
  name: string;
  variant: string;
  quantity: number;
  recipe: Recipe[];
};
export type Order = {
  id: string;
  number: string;
  placed: string;
  commercial: string;
  refundReview?: boolean;
  sourceReview?: boolean;
  items: OrderItem[];
  assembled: boolean;
  packed: boolean;
  tracking: string;
  shipped: boolean;
  note: string;
};
export const initialOrders: Order[] = [
  {
    id: "demo-1042",
    number: "DEMO-1042",
    placed: "Sample order · standard shipping",
    commercial: "Processing",
    items: [
      {
        id: "line-1",
        name: "PlayCase kit",
        variant: "Sample variant · Tangerine",
        quantity: 1,
        recipe: [
          {
            component: "Case body",
            units: 1,
            material: "Tangerine PLA",
            time: "2h 15m",
          },
          {
            component: "Faceplate",
            units: 1,
            material: "Cloud white PLA",
            time: "45 min",
          },
        ],
      },
    ],
    assembled: false,
    packed: false,
    tracking: "",
    shipped: false,
    note: "",
  },
  {
    id: "demo-1043",
    number: "DEMO-1043",
    placed: "Sample order · standard shipping",
    commercial: "Processing",
    items: [
      {
        id: "line-1",
        name: "PlayCase kit",
        variant: "Sample variant · Seafoam",
        quantity: 2,
        recipe: [],
      },
    ],
    assembled: false,
    packed: false,
    tracking: "",
    shipped: false,
    note: "",
  },
  {
    id: "demo-1044",
    number: "DEMO-1044",
    placed: "Sample cancelled order",
    commercial: "Cancelled",
    items: [
      {
        id: "line-1",
        name: "PlayCase kit",
        variant: "Sample variant · Midnight",
        quantity: 1,
        recipe: [],
      },
    ],
    assembled: false,
    packed: false,
    tracking: "",
    shipped: false,
    note: "",
  },
];
export function componentsFor(order: Order) {
  return order.items.flatMap((item) =>
    item.recipe.map((recipe) => ({
      ...recipe,
      itemId: item.id,
      required: recipe.units * item.quantity,
    })),
  );
}
export function acceptedUnits(
  order: Order,
  jobs: Job[],
  itemId: string,
  component: string,
) {
  return jobs
    .filter(
      (j) =>
        j.orderId === order.id &&
        j.itemId === itemId &&
        j.component === component &&
        j.state === "Accepted",
    )
    .reduce((n, j) => n + (j.units || 1), 0);
}
export function partsComplete(order: Order, jobs: Job[]) {
  const parts = componentsFor(order);
  return (
    parts.length > 0 &&
    order.items.every((i) => i.recipe.length > 0) &&
    parts.every(
      (p) => acceptedUnits(order, jobs, p.itemId, p.component) >= p.required,
    )
  );
}
export function productionAllowed(order: Order) {
  return (
    ["Processing", "processing"].includes(order.commercial) &&
    !order.refundReview && !order.sourceReview
  );
}
export function orderStage(order: Order, jobs: Job[]) {
  if (
    ["Cancelled", "cancelled", "refunded", "failed"].includes(order.commercial)
  )
    return "Cancelled";
  if (["completed", "delivered"].includes(order.commercial)) return "Fulfilled in store";
  if (!productionAllowed(order)) return "On hold";
  if (order.items.some((i) => !i.recipe.length)) return "Needs mapping";
  if (order.shipped && partsComplete(order, jobs)) return "Shipped";
  if (partsComplete(order, jobs))
    return order.assembled && order.packed ? "Ready to ship" : "Assembly";
  const linked = jobs.filter((j) => j.orderId === order.id);
  if (
    linked.some((j) => j.state === "Failed") &&
    !linked.some((j) => j.state === "Queued" || j.state === "Printing")
  )
    return "Blocked";
  if (linked.some((j) => j.state === "Printing")) return "Printing";
  if (linked.some((j) => j.state === "Queued")) return "Queued";
  return "To queue";
}
export function buildMissingJobs(
  order: Order,
  jobs: Job[],
  printer: string,
): Job[] {
  if (!productionAllowed(order) || order.items.some((i) => !i.recipe.length))
    return [];
  return componentsFor(order).flatMap((p) => {
    const covered = jobs
      .filter(
        (j) =>
          j.orderId === order.id &&
          j.itemId === p.itemId &&
          j.component === p.component &&
          j.state !== "Failed",
      )
      .reduce((n, j) => n + (j.units || 1), 0);
    const units = Math.max(0, p.required - covered);
    return units
      ? [
          {
            id: crypto.randomUUID(),
            name: `${order.number} · ${p.component}`,
            material: p.material,
            time: p.time,
            printer,
            orderId: order.id,
            itemId: p.itemId,
            component: p.component,
            units,
            state: "Queued" as const,
          },
        ]
      : [];
  });
}
