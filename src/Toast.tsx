// Messages after an action, at the bottom of the screen (on a phone, just above the tab bar).
//
//   notify("Saved.")                                         // success: a check, gone after 4.5 s
//   notify("Auto-print is off.", { kind: "info" })           // info: an i, gone after 4.5 s
//   notify("Couldn't resume Alder.", { kind: "error", action: { label: "Retry", run: resume } })
//   notify("Couldn't resume Alder.", failure(resume))                                       // the same, shorter
//
// Errors have an alert icon and the alert colours, are announced as alerts, and stay until dismissed (their X, or
// their action). Successes and info wait while the pointer or focus is on them. Up to three show at once, the newest
// nearest the bottom; the same message again replaces the earlier one. <Toasts /> renders them, once, in the app.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CircleAlert, Check, Info, X } from "lucide-react";

export type ToastKind = "success" | "error" | "info";
export type ToastAction = { label: string; run: () => void };
export type ToastOptions = { kind?: ToastKind; action?: ToastAction };
export type Notify = (message: string, options?: ToastOptions) => void;
type Toast = { id: number; message: string; kind: ToastKind; action?: ToastAction };

const MAX = 3, LIFETIME = 4500;
let toasts: Toast[] = [], nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

export const notify: Notify = (message, options = {}) => {
  const kind = options.kind || "success";
  // An error with nothing to say still says something went wrong.
  const text = message || (kind === "error" ? "Something went wrong. Try again." : "");
  if (!text) return;
  toasts = [...toasts.filter((t) => t.message !== text), { id: nextId++, message: text, kind, action: options.action }].slice(-MAX);
  emit();
};

/** Options for a failure, with Retry when there's an obvious one: notify(message, failure(() => save(draft))). */
export const failure = (retry?: () => void): ToastOptions => ({ kind: "error", action: retry && { label: "Retry", run: retry } });

export const dismissToast = (id: number) => {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
};

export function Toasts() {
  const list = useSyncExternalStore(subscribe, () => toasts);
  return <div className="toasts">{list.map((t) => <ToastItem key={t.id} toast={t} />)}</div>;
}

function ToastItem({ toast }: { toast: Toast }) {
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  const left = useRef(LIFETIME);
  const error = toast.kind === "error";
  useEffect(() => {
    if (error || hovered || focused) return;
    const started = performance.now();
    const timer = setTimeout(() => dismissToast(toast.id), Math.max(left.current, 1000));
    return () => { clearTimeout(timer); left.current -= performance.now() - started; };
  }, [error, hovered, focused, toast.id]);
  const Icon = error ? CircleAlert : toast.kind === "info" ? Info : Check;
  return (
    <div
      role={error ? "alert" : "status"}
      className={`toast toast-${toast.kind}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}
    >
      <Icon className="toast-icon" size={18} aria-hidden="true" />
      <span className="toast-text">{toast.message}</span>
      {toast.action && <button type="button" className="toast-action" onClick={() => { dismissToast(toast.id); toast.action!.run(); }}>{toast.action.label}</button>}
      {error && <button type="button" className="toast-dismiss" aria-label="Dismiss" title="Dismiss" onClick={() => dismissToast(toast.id)}><X size={16} aria-hidden="true" /></button>}
    </div>
  );
}
