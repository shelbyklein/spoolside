import { useEffect, useState } from "react";
import { WaterBackground } from "./WaterBackground";

const SEEN = "spoolside-splash";
// Phones only, once per launch: the spool floating on the sidebar's water, then a fade into the app.
export function shouldShowSplash() {
  try {
    return matchMedia("(max-width: 760px)").matches && !sessionStorage.getItem(SEEN);
  } catch {
    return false;
  }
}
export function Splash({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    try {
      sessionStorage.setItem(SEEN, "1");
    } catch {}
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(() => setLeaving(true), still ? 700 : 1600);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!leaving) return;
    document.documentElement.classList.add("ready");
    const timer = setTimeout(onDone, 550);
    return () => clearTimeout(timer);
  }, [leaving]);
  return (
    <div className={`splash${leaving ? " leaving" : ""}`} onClick={() => setLeaving(true)} role="presentation">
      <WaterBackground className="splash-water" />
      <div className="splash-mark">
        <img src="/spoolside.png" alt="" />
        <span>
          spoolside<span className="brand-dot">.</span>
        </span>
      </div>
    </div>
  );
}
