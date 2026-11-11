// "Are you sure?" in the app's own dialog, in place of the browser's confirm box.
//
//   if (!(await confirmAction({ title: `Stop the print on ${name}?`, body: "This can't be undone.", confirmLabel: "Stop print", danger: true }))) return;
//
// Resolves true when the action button is pressed, false for Cancel, Close, Escape or the backdrop. Cancel has focus
// when it opens. It works from inside another dialog (it stacks over it, see Dialog.tsx). <ConfirmHost /> renders it,
// once, in the app; asks that arrive while one is open wait their turn.
import { useSyncExternalStore, type ReactNode } from "react";
import { Dialog } from "./Dialog";

export type ConfirmOptions = {
  /** The question, as the heading: "Delete iPhone 15 Case?" */
  title: string;
  /** What happens, in a sentence or two. */
  body?: ReactNode;
  /** The action, named: "Stop print", "Delete", "Remove". */
  confirmLabel: string;
  /** Red action button, for what can't be undone. */
  danger?: boolean;
  cancelLabel?: string;
};
type Ask = ConfirmOptions & { id: number; resolve: (ok: boolean) => void };

let asks: Ask[] = [], nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    asks = [...asks, { ...options, id: nextId++, resolve }];
    emit();
  });
}

export function ConfirmHost() {
  const list = useSyncExternalStore(subscribe, () => asks);
  const ask = list[0];
  if (!ask) return null;
  const answer = (ok: boolean) => {
    if (!asks.includes(ask)) return;
    asks = asks.filter((a) => a !== ask);
    emit();
    ask.resolve(ok);
  };
  return (
    <Dialog
      key={ask.id}
      title={ask.title}
      className="confirm-dialog"
      onClose={() => answer(false)}
      footer={<>
        <button type="button" className="secondary" data-autofocus onClick={() => answer(false)}>{ask.cancelLabel || "Cancel"}</button>
        <button type="button" className={ask.danger ? "primary danger" : "primary"} onClick={() => answer(true)}>{ask.confirmLabel}</button>
      </>}
    >
      {ask.body && <p className="confirm-body">{ask.body}</p>}
    </Dialog>
  );
}
