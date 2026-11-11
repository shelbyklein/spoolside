import { useEffect, useRef, useState, type ReactNode } from "react";
import { Upload } from "lucide-react";
import { Dialog } from "./Dialog";

// The Upload menu. Wide screens: a dropdown that closes on an outside click or Escape. Phones: a bottom sheet
// (Dialog), so it opens above everything, including the home's printer pills.
// `close` is passed to the items' owner through onUploaded, so the sheet stays mounted while a file chooser or the
// upload dialog (stacked on top of it) is in use.
export function UploadMenu({ wide, children }: { wide: boolean; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false), root = useRef<HTMLDetailsElement>(null);
  const close = () => setOpen(false);
  useEffect(() => {
    if (!open || !wide) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); root.current?.querySelector("summary")?.focus(); } };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open, wide]);
  if (!wide) return <>
    <button className="secondary upload-menu-trigger" aria-haspopup="dialog" onClick={() => setOpen(true)}><Upload size={16} /> Upload</button>
    {open && <Dialog title="Upload" onClose={close} className="upload-sheet"><div className="upload-menu-list">{children(close)}</div></Dialog>}
  </>;
  return <details className="upload-menu" ref={root} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
    <summary className="secondary"><Upload size={16} /> Upload</summary>
    <div className="upload-menu-list">{children(close)}</div>
  </details>;
}
