import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

// A section that folds: a header button (title and a one-line summary of what's inside) over content that stays
// mounted while closed, so what it holds (a form's half-typed note, data it's still loading) isn't lost and the
// header button is the same element before and after the data arrives.
export function Fold({ title, summary, tone, className = "", children }: { title: string; summary?: ReactNode; tone?: "warn"; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={`fold${className ? ` ${className}` : ""}`}>
      <h3>
        <button type="button" className="fold-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          <ChevronDown size={16} aria-hidden="true" />
          <span className="fold-title">{title}</span>
          {summary && <small className={`fold-summary${tone ? ` ${tone}` : ""}`}>{summary}</small>}
        </button>
      </h3>
      <div id={id} className="fold-body" hidden={!open}>{children}</div>
    </div>
  );
}
