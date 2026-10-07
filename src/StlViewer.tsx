import { useEffect, useRef, useState } from "react";
import { DEFAULT_PART_COLOR } from "./colors";

export type PartRef = { part: number; instance: number };
type Props = {
  url?: string;
  urls?: string[];
  colors?: string[];
  positions?: (number[][] | undefined)[];
  // Editing: click a part to select it, drag the arrows to move it.
  editable?: boolean;
  selected?: PartRef | null;
  onSelect?: (ref: PartRef | null) => void;
  onMove?: (ref: PartRef, position: number[]) => void;
};
type Scene = {
  THREE: typeof import("three");
  group: import("three").Group;
  center: import("three").Vector3;
  geometries: import("three").BufferGeometry[];
  materials: import("three").MeshStandardMaterial[];
  meshes: import("three").Mesh[];
  transform: import("three/examples/jsm/controls/TransformControls.js").TransformControls;
};

const placements = (p?: number[][]) => (p?.length ? p : [[0, 0, 0]]);

// Lazy-loaded three.js viewer: drag to rotate, pinch/scroll to zoom.
// Models load once per set of URLs; colors and positions update in place.
export default function StlViewer({ url, urls, colors, positions, editable, selected, onSelect, onMove }: Props) {
  const sourceKey = JSON.stringify(urls || (url ? [url] : []));
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene | null>(null);
  const [ready, setReady] = useState(0);
  const [error, setError] = useState("");
  const latest = useRef({ positions, onSelect, onMove, editable });
  latest.current = { positions, onSelect, onMove, editable };

  useEffect(() => {
    setError("");
    let cancelled = false,
      cleanup = () => {};
    (async () => {
      const THREE = await import("three");
      const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      const { TransformControls } = await import("three/examples/jsm/controls/TransformControls.js");
      const el = host.current;
      if (cancelled || !el) return;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(el.clientWidth, el.clientHeight);
      el.appendChild(renderer.domElement);
      const world = new THREE.Scene();
      world.add(new THREE.HemisphereLight(0xffffff, 0x9fb4b8, 2.2));
      const sun = new THREE.DirectionalLight(0xffffff, 1.6);
      sun.position.set(1, 2, 3);
      world.add(sun);
      const camera = new THREE.PerspectiveCamera(35, el.clientWidth / el.clientHeight, 0.1, 5000);
      const orbit = new OrbitControls(camera, renderer.domElement);
      orbit.enableDamping = true;
      const transform = new TransformControls(camera, renderer.domElement);
      transform.setSize(0.8);
      world.add(transform.getHelper());
      const group = new THREE.Group();
      group.rotation.x = -Math.PI / 2;
      world.add(group);
      const geometries: import("three").BufferGeometry[] = [];
      const materials: import("three").MeshStandardMaterial[] = [];
      const resize = new ResizeObserver(() => {
        if (!el.clientWidth || !el.clientHeight) return;
        renderer.setSize(el.clientWidth, el.clientHeight);
        camera.aspect = el.clientWidth / el.clientHeight;
        camera.updateProjectionMatrix();
      });
      resize.observe(el);
      // Dragging a part pauses orbiting and reports its new position (mm, STL coordinates).
      transform.addEventListener("dragging-changed", (e) => {
        orbit.enabled = !e.value;
        const mesh = transform.object as import("three").Mesh | undefined;
        if (!e.value && mesh && scene.current) {
          const p = mesh.position.clone().add(scene.current.center);
          latest.current.onMove?.(mesh.userData.ref, [...[p.x, p.y, p.z].map((n) => Math.round(n * 100) / 100), Math.round(((mesh.rotation.z * 180) / Math.PI) * 100) / 100]);
        }
      });
      // A click (not a drag) selects the part under the pointer.
      let down: { x: number; y: number } | null = null;
      const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
      const onUp = (e: PointerEvent) => {
        if (!latest.current.editable || !down || transform.dragging || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
        const rect = renderer.domElement.getBoundingClientRect();
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
        const hit = ray.intersectObjects(scene.current?.meshes || [], false)[0];
        latest.current.onSelect?.(hit ? hit.object.userData.ref : null);
      };
      renderer.domElement.addEventListener("pointerdown", onDown);
      renderer.domElement.addEventListener("pointerup", onUp);
      let frame = 0;
      const loop = () => {
        orbit.update();
        renderer.render(world, camera);
        frame = requestAnimationFrame(loop);
      };
      cleanup = () => {
        cancelAnimationFrame(frame);
        resize.disconnect();
        renderer.domElement.removeEventListener("pointerdown", onDown);
        renderer.domElement.removeEventListener("pointerup", onUp);
        transform.dispose();
        orbit.dispose();
        geometries.forEach((g) => g.dispose());
        materials.forEach((m) => m.dispose());
        renderer.dispose();
        renderer.domElement.remove();
        scene.current = null;
      };
      try {
        const sources: string[] = JSON.parse(sourceKey);
        if (!sources.length) throw Error("No models");
        for (const source of sources) {
          const response = await fetch(source);
          if (!response.ok) throw Error("Model unavailable");
          const buffer = await response.arrayBuffer();
          if (cancelled) return;
          const geometry = new STLLoader().parse(buffer);
          geometry.computeVertexNormals();
          geometry.computeBoundingBox();
          geometries.push(geometry);
          materials.push(new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 }));
        }
        // Center the assembly once, from where parts start, so moving a part doesn't shift the view.
        const bounds = new THREE.Box3();
        geometries.forEach((g, i) => {
          for (const [x, y, z] of placements(latest.current.positions?.[i])) bounds.union(g.boundingBox!.clone().translate(new THREE.Vector3(x, y, z)));
        });
        const center = bounds.getCenter(new THREE.Vector3());
        const r = bounds.getBoundingSphere(new THREE.Sphere()).radius || 50;
        camera.position.set(r * 1.2, r * 1.5, r * 2.2);
        camera.lookAt(0, 0, 0);
        scene.current = { THREE, group, center, geometries, materials, meshes: [], transform };
        setReady((n) => n + 1);
        loop();
      } catch {
        setError("Couldn't load this model.");
      }
    })();
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [sourceKey]);

  // (Re)build one mesh per position whenever positions change.
  const positionsKey = JSON.stringify(positions || []);
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    s.transform.detach();
    s.meshes.forEach((m) => s.group.remove(m));
    s.meshes = [];
    s.geometries.forEach((g, part) => {
      placements(positions?.[part]).forEach(([x, y, z, turn = 0], instance) => {
        const mesh = new s.THREE.Mesh(g, s.materials[part]);
        mesh.position.set(x - s.center.x, y - s.center.y, z - s.center.z);
        mesh.rotation.z = (turn * Math.PI) / 180;
        mesh.userData.ref = { part, instance };
        s.group.add(mesh);
        s.meshes.push(mesh);
      });
    });
  }, [ready, positionsKey]);

  useEffect(() => {
    scene.current?.materials.forEach((m, i) => m.color.set(colors?.[i] || DEFAULT_PART_COLOR));
  }, [ready, JSON.stringify(colors)]);

  // Attach the move arrows to the selected part and tint it.
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    const mesh = editable && selected ? s.meshes.find((m) => m.userData.ref.part === selected.part && m.userData.ref.instance === selected.instance) : undefined;
    if (mesh) s.transform.attach(mesh);
    else s.transform.detach();
    s.materials.forEach((m, i) => m.emissive.set(mesh && i === selected?.part ? 0x553300 : 0x000000));
  }, [ready, positionsKey, editable, selected?.part, selected?.instance]);

  return <div className={`stl-viewer${editable ? " editing" : ""}`} ref={host}>{error && <p>{error}</p>}</div>;
}
