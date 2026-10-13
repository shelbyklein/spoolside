import { useState } from "react";
import { ArrowDownUp } from "lucide-react";

export type SortOption<T> = { id: string; label: string; compare: (a: T, b: T) => number };

export const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

// A list's sort choice, remembered on this device. Returns the sorter and the menu that changes it.
export function useSort<T>(list: string, label: string, options: SortOption<T>[]) {
  const key = `spoolside-sort-${list}`;
  const [id, setId] = useState(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(key); } catch { /* private mode */ }
    return options.some((o) => o.id === saved) ? saved! : options[0].id;
  });
  const choose = (next: string) => {
    setId(next);
    try { localStorage.setItem(key, next); } catch { /* private mode */ }
  };
  const option = options.find((o) => o.id === id) || options[0];
  const sort = <U extends T>(items: U[]): U[] => [...items].sort(option.compare);
  const menu = (
    <label className="sort-select" title={`Sort ${label}`}>
      <ArrowDownUp size={15} aria-hidden="true" />
      <select aria-label={`Sort ${label}`} value={option.id} onChange={(e) => choose(e.target.value)}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  );
  return { sort, menu, id: option.id };
}
