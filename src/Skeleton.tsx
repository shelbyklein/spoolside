// Placeholder rows for an area whose data hasn't arrived. They hold no text (screen readers get the one
// role="status" "Loading…" in main.tsx). `still` stops the shimmer, for a load that failed.
export function Skeleton({ rows = 3, still = false, tall = false }: { rows?: number; still?: boolean; tall?: boolean }) {
  return (
    <div className={`skeleton${still ? " still" : ""}${tall ? " tall" : ""}`} aria-hidden="true" data-skeleton>
      {Array.from({ length: rows }, (_, i) => <div className="skeleton-row" key={i}><i /><span /><span /></div>)}
    </div>
  );
}
