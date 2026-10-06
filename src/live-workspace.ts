import { useEffect, useRef, useState } from "react";
import type { Order, Job } from "./order-model";
export type Machine = {
  id: string;
  name: string;
  state: string;
  job: string;
  progress: number;
  remaining: string;
  material: string;
  nozzle?: number | null;
  bed?: number | null;
  seen?: string | null;
  stale?: boolean;
  connected?: boolean;
  error?: string | null;
  rawState?: string | null;
  trays?: { slot: number; type: string; color: string }[];
  external?: { type: string; color: string } | null;
};
export type Spool = {
  materialId?: string;
  capacity?: number;
  id: string;
  name: string;
  color: string;
  remaining: number;
};
type Data = {
  revision: number;
  orders: Order[];
  jobs: Job[];
  spools: Spool[];
  machines: Machine[];
  lastSync: string | null;
  syncError: string | null;
};
const empty: Data = {
  revision: 0,
  orders: [],
  jobs: [],
  spools: [],
  machines: [],
  lastSync: null,
  syncError: null,
};
export function useLiveWorkspace(enabled: boolean) {
  const [data, setData] = useState<Data>(empty),
    [loading, setLoading] = useState(enabled),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const current = useRef(empty),
    dirty = useRef(false),
    busy = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    version = useRef(0);
  const accept = (value: Data) => {
    current.current = value;
    setData(value);
    setLoading(false);
  };
  const load = async () => {
    if (!enabled || busy.current) return;
    const at = version.current;
    try {
      const r = await fetch("/api/workspace", { cache: "no-store" });
      if (!r.ok)
        throw Error(
          r.status === 401
            ? "Your session expired. Sign in again."
            : "Could not load your workshop. Retry when the connection returns.",
        );
      const value = await r.json();
      if (value.revision < current.current.revision) return;
      if (!dirty.current && at === version.current && !busy.current) {
        accept(value);
        setError("");
      } else {
        current.current = { ...current.current, machines: value.machines, lastSync: value.lastSync, syncError: value.syncError };
        setData(current.current);
      }
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  };
  const save = async () => {
    if (!dirty.current || busy.current) return;
    busy.current = true;
    setSaving(true);
    const at = version.current;
    try {
      const r = await fetch("/api/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(current.current),
      });
      const value = await r.json();
      if (!r.ok)
        throw Error(value.error || "Could not save production changes.");
      if (at === version.current) {
        dirty.current = false;
        accept(value);
        setError("");
      } else {
        current.current = { ...current.current, revision: value.revision };
        timer.current = setTimeout(save, 100);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  const update = <K extends "orders" | "jobs" | "spools">(
    key: K,
    value: Data[K],
  ) => {
    current.current = { ...current.current, [key]: value };
    setData(current.current);
    dirty.current = true;
    version.current++;
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 500);
  };
  useEffect(() => {
    if (!enabled) return;
    load();
    const interval = setInterval(load, 10000);
    const before = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => {
      clearInterval(interval);
      clearTimeout(timer.current);
      window.removeEventListener("beforeunload", before);
    };
  }, [enabled]);
  return {
    data,
    loading,
    error,
    saving,
    update,
    retry: () => (dirty.current ? save() : load()),
    reload: () => {
      if (
        dirty.current &&
        !window.confirm("Discard unsaved changes and reload server state?")
      )
        return;
      dirty.current = false;
      load();
    },
    sync: async () => {
      if (dirty.current) {
        setError("Save pending changes before refreshing orders.");
        return;
      }
      busy.current = true;
      const at = version.current;
      try {
        const r = await fetch("/api/sync", { method: "POST" });
        if (!r.ok) throw Error("Store refresh failed");
        const value = await r.json();
        if (at === version.current && !dirty.current) accept(value);
        else setError("Store refreshed while you were editing. Reload to review updated orders before saving.");
      } catch (e) {
        setError((e as Error).message);
      } finally {
        busy.current = false;
        if (dirty.current) { clearTimeout(timer.current); timer.current = setTimeout(save, 100); }
      }
    },
  };
}
