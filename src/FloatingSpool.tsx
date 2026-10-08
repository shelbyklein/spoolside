import { useEffect, useRef } from "react";
import { gsap } from "gsap";

// Drag the spool itself; the inner image keeps its gentle idle bob independently.
export function FloatingSpool() {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const surface = el.closest<HTMLElement>(".sidebar, .water-home")!;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    const offset = { x: 0, y: 0 };
    let pointer: number | null = null, startX = 0, startY = 0, originX = 0, originY = 0;
    let home = el.getBoundingClientRect(), pool = surface.getBoundingClientRect();
    let returning: gsap.core.Tween | undefined;
    let waveAt = 0;
    const paint = () => {
      gsap.set(el, { x: offset.x, y: offset.y });
      const now = performance.now();
      if (now - waveAt < 110 || reduce.matches) return;
      const rect = el.getBoundingClientRect();
      surface.dispatchEvent(new CustomEvent("water-ripple", { detail: {
        x: rect.left + rect.width * .5, y: rect.top + rect.height * .78, strength: 1.4,
      } }));
      waveAt = now;
    };
    const measure = () => {
      const rect = el.getBoundingClientRect();
      home = { ...rect.toJSON(), left: rect.left - offset.x, right: rect.right - offset.x,
        top: rect.top - offset.y, bottom: rect.bottom - offset.y } as DOMRect;
      pool = surface.getBoundingClientRect();
    };
    const move = (x: number, y: number) => {
      offset.x = Math.min(pool.right - home.right, Math.max(pool.left - home.left, x));
      offset.y = Math.min(pool.bottom - home.bottom, Math.max(pool.top - home.top, y));
      paint();
    };
    const settle = () => {
      returning?.kill();
      el.classList.remove("dragging");
      surface.classList.remove("spool-dragging");
      returning = gsap.to(offset, { x: 0, y: 0, duration: reduce.matches ? .15 : 1.8,
        ease: "power3.out", onUpdate: paint, onComplete: () => { el.classList.remove("returning"); } });
      el.classList.add("returning");
    };
    const down = (event: PointerEvent) => {
      if (pointer !== null || event.button !== 0) return;
      returning?.kill(); el.classList.remove("returning");
      measure(); pointer = event.pointerId;
      startX = event.clientX; startY = event.clientY; originX = offset.x; originY = offset.y;
      el.setPointerCapture(pointer); el.classList.add("dragging");
      surface.classList.add("spool-dragging");
    };
    const drag = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      move(originX + event.clientX - startX, originY + event.clientY - startY);
    };
    const release = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      const id = pointer; pointer = null;
      if (el.hasPointerCapture(id)) el.releasePointerCapture(id);
      settle();
    };
    const key = (event: KeyboardEvent) => {
      const directions: Record<string, number[]> = { ArrowLeft: [-24,0], ArrowRight: [24,0], ArrowUp: [0,-24], ArrowDown: [0,24] };
      if (!directions[event.key] && event.key !== "Escape" && event.key !== "Home") return;
      event.preventDefault(); returning?.kill(); measure();
      if (directions[event.key]) move(offset.x + directions[event.key][0], offset.y + directions[event.key][1]);
      settle();
    };
    const resized = () => { pointer = null; settle(); };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", drag);
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) el.addEventListener(name, release as EventListener);
    el.addEventListener("keydown", key);
    window.addEventListener("resize", resized);
    return () => {
      returning?.kill(); surface.classList.remove("spool-dragging");
      el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", drag);
      for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) el.removeEventListener(name, release as EventListener);
      el.removeEventListener("keydown", key); window.removeEventListener("resize", resized);
    };
  }, []);
  return <button ref={ref} className="floating-spool" aria-label="Drag the floating spool" title="Drag me around the water" >
    <img src="/spoolside.png" alt="" draggable={false} />
  </button>;
}
