import { useEffect, useRef, useState } from "react";

// Lazy-loaded three.js view of a plate's toolpath (runs of Int16 x,y,z in 0.01 mm, -32768 between runs).
// Drag to rotate, pinch/scroll to zoom; the slider replays the print in order.
export default function GcodeViewer({ url, color = "#e0201b" }: { url: string; color?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const draw = useRef<(fraction: number) => void>(() => {});
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [progress, setProgress] = useState(1);
  useEffect(() => {
    let stop = false, cleanup = () => {};
    (async () => {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      let data: Int16Array;
      try {
        const r = await fetch(url);
        if (!r.ok) throw Error();
        data = new Int16Array(await r.arrayBuffer());
      } catch {
        if (!stop) setState("error");
        return;
      }
      const el = host.current;
      if (stop || !el) return;
      // Turn each run of points into line segments, shaded darker toward the bed.
      const base = new THREE.Color(color), dark = base.clone().multiplyScalar(0.35);
      const pos: number[] = [];
      let prev: number[] | null = null, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i + 2 < data.length; i += 3) {
        if (data[i] === -32768) { prev = null; continue; }
        const p = [data[i] / 100, data[i + 1] / 100, data[i + 2] / 100];
        if (prev) pos.push(...prev, ...p);
        minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]);
        prev = p;
      }
      const colors = new Float32Array(pos.length);
      for (let i = 0; i < pos.length; i += 3) {
        const t = maxZ > minZ ? (pos[i + 2] - minZ) / (maxZ - minZ) : 1;
        const c = dark.clone().lerp(base, 0.35 + 0.65 * t);
        colors.set([c.r, c.g, c.b], i);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geometry.computeBoundingBox();
      const segments = pos.length / 6;
      const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true }));
      const center = geometry.boundingBox!.getCenter(new THREE.Vector3());
      lines.position.sub(center);
      const group = new THREE.Group();
      group.rotation.x = -Math.PI / 2; // printer Z up
      group.add(lines);
      const scene = new THREE.Scene();
      scene.add(group);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(el.clientWidth, el.clientHeight);
      el.appendChild(renderer.domElement);
      const camera = new THREE.PerspectiveCamera(35, el.clientWidth / el.clientHeight, 0.1, 5000);
      const r = geometry.boundingBox!.getBoundingSphere(new THREE.Sphere()).radius || 50;
      camera.position.set(r * 1.2, r * 1.5, r * 2.2);
      camera.lookAt(0, 0, 0);
      const orbit = new OrbitControls(camera, renderer.domElement);
      orbit.enableDamping = true;
      const resize = new ResizeObserver(() => {
        if (!el.clientWidth || !el.clientHeight) return;
        renderer.setSize(el.clientWidth, el.clientHeight);
        camera.aspect = el.clientWidth / el.clientHeight;
        camera.updateProjectionMatrix();
      });
      resize.observe(el);
      draw.current = (f) => geometry.setDrawRange(0, Math.round(segments * f) * 2);
      let frame = 0;
      const loop = () => { orbit.update(); renderer.render(scene, camera); frame = requestAnimationFrame(loop); };
      loop();
      setState("ready");
      cleanup = () => {
        cancelAnimationFrame(frame);
        resize.disconnect();
        orbit.dispose();
        geometry.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();
    return () => { stop = true; cleanup(); };
  }, [url, color]);
  useEffect(() => draw.current(progress), [progress, state]);
  return (
    <div className="gcode-viewer">
      <div className="stl-viewer" ref={host}>{state === "loading" && <p>Loading the toolpath…</p>}{state === "error" && <p>Couldn't load the toolpath.</p>}</div>
      {state === "ready" && (
        <label className="gcode-progress">
          Replay
          <input type="range" min={0} max={1} step={0.001} value={progress} onChange={(e) => setProgress(Number(e.target.value))} aria-label="Print progress" />
          <small>{Math.round(progress * 100)}%</small>
        </label>
      )}
    </div>
  );
}
