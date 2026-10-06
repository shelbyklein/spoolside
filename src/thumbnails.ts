// Renders STL previews one at a time with a single shared WebGL context,
// then stores them on the server so every device reuses the image.
type Job = { id: string; resolve: (ok: boolean) => void };
const queue: Job[] = [];
const pending = new Map<string, Promise<boolean>>();
let running = false;
let renderer: import("three").WebGLRenderer | null = null;

async function render(id: string) {
  const THREE = await import("three");
  const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
  const width = 480, height = 360;
  renderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9fb4b8, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(1, 2, 3);
  scene.add(sun);
  const geometry = new STLLoader().parse(await (await fetch(`/api/assets/${id}/stl`)).arrayBuffer());
  geometry.computeVertexNormals();
  geometry.center();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x5aa9a3, roughness: 0.55, metalness: 0.05 }));
  mesh.rotation.x = -Math.PI / 2;
  scene.add(mesh);
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 5000);
  const dir = new THREE.Vector3(0.55, 1.1, 1).normalize();
  const radius = size.length() / 2;
  camera.position.copy(dir.multiplyScalar((radius / Math.sin((camera.fov * Math.PI) / 360)) * 0.9));
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
  const blob = await new Promise<Blob | null>((r) => renderer!.domElement.toBlob(r, "image/png"));
  geometry.dispose();
  if (!blob) return false;
  const res = await fetch(`/api/assets/${id}/thumb`, { method: "PUT", headers: { "Content-Type": "image/png" }, body: blob });
  return res.ok;
}

async function drain() {
  if (running) return;
  running = true;
  while (queue.length) {
    const job = queue.shift()!;
    job.resolve(await render(job.id).catch(() => false));
  }
  running = false;
}

export function requestThumbnail(id: string) {
  if (!pending.has(id))
    pending.set(id, new Promise<boolean>((resolve) => {
      queue.push({ id, resolve });
      drain();
    }));
  return pending.get(id)!;
}
