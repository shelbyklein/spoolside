import { DEFAULT_PART_COLOR } from "./colors";
import type { Asset } from "./AssetLibrary";

// Static snapshots of assembled previews for list cards. One shared WebGL context renders
// them one at a time; STLs are fetched once and reused across assemblies.
export type SnapshotPart = { asset: Asset; color?: string; positions?: number[][] };

// Fingerprint of everything that changes the picture: parts, positions, colors, STL contents.
export function snapshotKey(parts: SnapshotPart[]) {
  const text = JSON.stringify(parts.map((p) => [p.asset.id, p.asset.hash || "", p.color || p.asset.categoryColor || "", p.positions || []]));
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return "v2" + (h >>> 0).toString(36) + text.length.toString(36);
}

const buffers = new Map<string, Promise<ArrayBuffer>>();
const stl = (id: string) => {
  if (!buffers.has(id)) buffers.set(id, fetch(`/api/assets/${id}/stl`).then((r) => { if (!r.ok) throw Error("STL unavailable"); return r.arrayBuffer(); }));
  return buffers.get(id)!;
};

let renderer: import("three").WebGLRenderer | null = null;
let chain: Promise<unknown> = Promise.resolve();
const pending = new Map<string, Promise<boolean>>();

async function render(upload: (png: Blob) => Promise<Response>, parts: SnapshotPart[], size = 600, fitWhole = false) {
  const THREE = await import("three");
  const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
  const width = size, height = size;
  renderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9fb4b8, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(1, 2, 3);
  scene.add(sun);
  const group = new THREE.Group();
  const disposable: { dispose(): void }[] = [];
  for (const p of parts.filter((p) => p.asset.hasStl !== false)) {
    const geometry = new STLLoader().parse(await stl(p.asset.id));
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ color: p.color || p.asset.categoryColor || DEFAULT_PART_COLOR, roughness: 0.55, metalness: 0.05 });
    disposable.push(geometry, material);
    for (const [x, y, z, turn = 0] of p.positions?.length ? p.positions : [[0, 0, 0]]) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.rotation.z = (turn * Math.PI) / 180;
      group.add(mesh);
    }
  }
  if (!group.children.length) return false;
  // Same framing as the live viewer: centered, lying flat, camera up and to the right.
  const center = new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3());
  group.children.forEach((m) => m.position.sub(center));
  group.rotation.x = -Math.PI / 2;
  scene.add(group);
  const r = new THREE.Box3().setFromObject(group).getBoundingSphere(new THREE.Sphere()).radius || 50;
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 5000);
  // Part thumbnails pull back until the whole bounding sphere fits, so long flat parts aren't cropped.
  const view = new THREE.Vector3(1.2, 1.5, 2.2);
  if (fitWhole) view.normalize().multiplyScalar((r / Math.sin((camera.fov * Math.PI) / 360)) * 1.04);
  else view.multiplyScalar(r);
  camera.position.copy(view);
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
  const blob = await new Promise<Blob | null>((done) => renderer!.domElement.toBlob(done, "image/png"));
  disposable.forEach((d) => d.dispose());
  if (!blob) return false;
  return (await upload(blob)).ok;
}

export function requestSnapshot(assemblyId: string, key: string, parts: SnapshotPart[]) {
  const id = `${assemblyId}:${key}`;
  if (!pending.has(id)) {
    const job = chain.then(() => render((png) => fetch(`/api/assemblies/${assemblyId}/thumb`, { method: "PUT", headers: { "Content-Type": "image/png", "X-Thumb-Key": key }, body: png }), parts)).catch(() => false);
    chain = job;
    pending.set(id, job);
  }
  return pending.get(id)!;
}

// One part on its own, small, for Library pills.
export function requestPartThumb(asset: Asset) {
  const id = `part:${asset.id}:${asset.hash}`;
  if (!pending.has(id)) {
    const job = chain.then(() => render((png) => fetch(`/api/assets/${asset.id}/thumb`, { method: "PUT", headers: { "Content-Type": "image/png" }, body: png }), [{ asset }], 480, true)).catch(() => false);
    chain = job;
    pending.set(id, job);
  }
  return pending.get(id)!;
}
