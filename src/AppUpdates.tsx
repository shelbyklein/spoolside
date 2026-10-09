import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

// Keep the existing registration and push subscription. Updating code needs no sign-out.
export function useAppUpdates() {
  const [available, setAvailable] = useState(false), [checking, setChecking] = useState(false);
  const resumedAt = useRef(0);
  const reloading = useRef(false);
  const edited = useRef(false);
  const reload = () => { if (!reloading.current) { reloading.current = true; window.location.reload(); } };
  const refresh = async () => {
    setChecking(true);
    try {
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) {
          await registration.update();
          const worker = registration.installing || registration.waiting;
          if (worker && worker.state !== "activated" && worker.state !== "redundant") {
            await new Promise<void>((resolve) => {
              const done = () => { clearTimeout(timer); worker.removeEventListener("statechange", changed); resolve(); };
              const changed = () => { if (worker.state === "activated" || worker.state === "redundant") done(); };
              const timer = window.setTimeout(done, 8000);
              worker.addEventListener("statechange", changed);
            });
          }
        }
      }
    } catch { /* Reload still works if the update check is temporarily unavailable. */ }
    reload();
  };
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let hadController = !!navigator.serviceWorker.controller;
    const check = () => navigator.serviceWorker.getRegistration().then(r => r?.update()).catch(() => {});
    const changed = () => {
      if (!hadController) { hadController = true; return; }
      if (reloading.current) return;
      setAvailable(true);
      // Resume is a natural reload point. An open print dialog or edited field gets a prompt instead.
      const editing = edited.current || document.querySelector('[role="dialog"]') || document.activeElement?.matches("input, textarea, select, [contenteditable=true]");
      if (!document.hidden && Date.now() - resumedAt.current < 5000 && !editing) reload();
    };
    const visible = () => {
      if (document.hidden) return;
      resumedAt.current = Date.now();
      if (available) changed();
      check();
    };
    const input = () => { edited.current = true; };
    document.addEventListener("input", input, true);
    document.addEventListener("change", input, true);
    navigator.serviceWorker.addEventListener("controllerchange", changed);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", check);
    check();
    return () => {
      document.removeEventListener("input", input, true);
      document.removeEventListener("change", input, true);
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", check);
    };
  }, [available]);
  return { available, checking, refresh };
}

export function RefreshAppButton({ checking, refresh }: { checking: boolean; refresh: () => void }) {
  return <button className="secondary" disabled={checking} onClick={refresh}><RefreshCw size={16} /> {checking ? "Refreshing…" : "Refresh app"}</button>;
}
