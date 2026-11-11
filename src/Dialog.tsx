// The one dialog every part of the app uses: a portal with a backdrop, a header with the title and a Close button,
// a body that scrolls inside itself, and an optional footer for actions.
//
//   <Dialog title="Print details" label={`Print details for ${name}`} onClose={close} busy={saving}
//     onSubmit={save} footer={<button className="primary">Save</button>}>…fields…</Dialog>
//
// While it's open: Escape and a click on the backdrop close it (not while `busy`), Tab and Shift+Tab stay inside it,
// and the page behind doesn't scroll. Focus moves in when it opens (to an element marked `data-autofocus`, the
// `initialFocus` ref, or the Close button) and goes back to whatever had it when it closes. Dialogs opened from a
// dialog stack: only the top one answers Escape and keeps focus, and the page unlocks when the last one closes.
// Sizes: "normal" (a bottom sheet at 760 px and under), "wide" (full screen there) and "panel" (Claude's side panel).
import { useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export type DialogSize = "normal" | "wide" | "panel";
export type DialogProps = {
  /** The heading. Also the accessible name, unless `label` is given. */
  title: ReactNode;
  /** The accessible name, when it should say more than the heading. */
  label?: string;
  onClose: () => void;
  /** While true, Escape, the backdrop and the Close button don't close it. */
  busy?: boolean;
  size?: DialogSize;
  /** Classes for the dialog box itself, for its content's styles. */
  className?: string;
  bodyClassName?: string;
  /** Beside the title, before Close: a status pill, a "New chat" button. */
  headExtra?: ReactNode;
  /** The Close button's name (default "Close"). */
  closeLabel?: string;
  /** Actions pinned under the scrolling body. */
  footer?: ReactNode;
  /** Where focus goes on open; otherwise an element marked data-autofocus, else the Close button. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Makes the dialog a <form>, so a submit button in the body or footer submits it. */
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
};

type OpenDialog = { panel: HTMLElement; close: () => void; busy: () => boolean; start: () => HTMLElement };
const stack: OpenDialog[] = [];
// The element a dialog just gave focus back to, for a dialog opening in the same update (Teach bed check replaces
// the printer details): its own opener is gone by then, so it returns there instead.
let justReturned: HTMLElement | null = null;

const FOCUSABLE = 'a[href], area[href], button, input:not([type="hidden"]), select, textarea, summary, iframe, [contenteditable="true"], [tabindex]';
const focusables = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.tabIndex >= 0 && !el.matches(":disabled") && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden");

// Safari doesn't focus a button when it's clicked or tapped, so the control last pressed stands in for the opener.
let pressed: HTMLElement | null = null;
if (typeof document !== "undefined") document.addEventListener("pointerdown", (e) => { pressed = e.target instanceof Element ? e.target.closest<HTMLElement>(FOCUSABLE) : null; }, true);
const currentOpener = () => {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) return active;
  return pressed?.isConnected ? pressed : null;
};

function onKeyDown(e: KeyboardEvent) {
  const top = stack.at(-1);
  if (!top) return;
  if (e.key === "Escape") {
    if (e.defaultPrevented || e.isComposing || top.busy()) return;
    e.preventDefault();
    top.close();
  } else if (e.key === "Tab") {
    const list = focusables(top.panel), active = document.activeElement as HTMLElement | null;
    const first = list[0], last = list.at(-1);
    if (!first || !last) { e.preventDefault(); top.panel.focus(); }
    else if (!active || !top.panel.contains(active)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && (active === first || active === top.panel)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }
}
// Focus that lands outside the top dialog (a click behind it, a radio group tabbing out) comes back in.
function onFocusIn(e: FocusEvent) {
  const top = stack.at(-1);
  if (top && e.target instanceof Node && !top.panel.contains(e.target)) top.start().focus({ preventScroll: true });
}

// The page behind stays put. The document is what scrolls on desktop; on a phone <main> scrolls, and it isn't
// behind the backdrop in the DOM, so wheel and touch over the backdrop never reach it.
let locks = 0, savedY = 0, savedPadding = "";
function lockScroll() {
  if (locks++) return;
  const root = document.documentElement, gap = innerWidth - root.clientWidth;
  savedY = scrollY;
  savedPadding = document.body.style.paddingRight;
  root.classList.add("dialog-open");
  if (gap > 0) document.body.style.paddingRight = `${gap}px`; // no jump when the scrollbar goes
}
function unlockScroll() {
  if (--locks) return;
  document.documentElement.classList.remove("dialog-open");
  document.body.style.paddingRight = savedPadding;
  if (scrollY !== savedY) scrollTo(0, savedY);
}

// When the control that opened a dialog is gone (the last review answered), focus goes to the page's main area.
function pageFallback() {
  const main = document.querySelector<HTMLElement>("main");
  if (main && !main.hasAttribute("tabindex")) main.tabIndex = -1;
  return main;
}

export function Dialog({ title, label, onClose, busy = false, size = "normal", className = "", bodyClassName = "", headExtra, closeLabel = "Close", footer, initialFocus, onSubmit, children }: DialogProps) {
  const headingId = useId();
  const panel = useRef<HTMLElement>(null), closeButton = useRef<HTMLButtonElement>(null), downOnBackdrop = useRef(false);
  // What had focus inside when the effect last cleaned up: in development React mounts effects twice, and an
  // autoFocus field keeps its focus through that.
  const kept = useRef<HTMLElement | null>(null);
  const latest = useRef({ onClose, busy });
  latest.current = { onClose, busy };
  // Read while rendering, before anything inside (an autoFocus field) takes focus.
  const [opener] = useState(currentOpener);
  const [over] = useState(() => stack.length > 0);

  useLayoutEffect(() => {
    const el = panel.current!;
    const start = () => {
      const close = closeButton.current;
      return initialFocus?.current || el.querySelector<HTMLElement>("[data-autofocus]") || (close && !close.disabled ? close : el);
    };
    const returnTo = opener?.isConnected && !el.contains(opener) ? opener : justReturned?.isConnected ? justReturned : opener;
    const entry: OpenDialog = { panel: el, close: () => latest.current.onClose(), busy: () => latest.current.busy, start };
    stack.push(entry);
    if (stack.length === 1) {
      document.addEventListener("keydown", onKeyDown);
      document.addEventListener("focusin", onFocusIn);
    }
    lockScroll();
    const keep = kept.current;
    kept.current = null;
    if (keep?.isConnected && el.contains(keep)) keep.focus({ preventScroll: true });
    else if (!el.contains(document.activeElement)) start().focus({ preventScroll: true });
    return () => {
      stack.splice(stack.indexOf(entry), 1);
      if (!stack.length) {
        document.removeEventListener("keydown", onKeyDown);
        document.removeEventListener("focusin", onFocusIn);
      }
      unlockScroll();
      const active = document.activeElement;
      if (active && active !== document.body && !el.contains(active)) return; // focus already moved on by itself
      if (active instanceof HTMLElement && el.contains(active)) kept.current = active;
      const below = stack.at(-1);
      const target = returnTo?.isConnected && (!below || below.panel.contains(returnTo)) ? returnTo : below ? below.start() : pageFallback();
      target?.focus({ preventScroll: true });
      justReturned = target;
      queueMicrotask(() => (justReturned = null));
    };
  }, []);

  const Box = onSubmit ? "form" : "section";
  return createPortal(
    <div
      className={`dialog-backdrop dialog-backdrop-${size}${over ? " dialog-over" : ""}`}
      onPointerDown={(e) => (downOnBackdrop.current = e.target === e.currentTarget)}
      onClick={(e) => {
        // Clicks inside stay inside, as they did when each dialog stopped them itself.
        e.stopPropagation();
        if (e.target === e.currentTarget && downOnBackdrop.current && !busy) onClose();
      }}
    >
      <Box
        ref={panel as RefObject<HTMLFormElement & HTMLElement>}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={label ? undefined : headingId}
        tabIndex={-1}
        className={`dialog dialog-${size}${className ? ` ${className}` : ""}`}
        onSubmit={onSubmit}
      >
        <header className="dialog-head">
          <h2 id={headingId} className="dialog-title">{title}</h2>
          {headExtra}
          <button type="button" ref={closeButton} className="icon-button dialog-close" aria-label={closeLabel} disabled={busy} onClick={onClose}><X size={20} /></button>
        </header>
        <div className={`dialog-body${bodyClassName ? ` ${bodyClassName}` : ""}`}>{children}</div>
        {footer && <footer className="dialog-foot">{footer}</footer>}
      </Box>
    </div>,
    document.body,
  );
}
