import { useEffect, useRef, useState } from "react";

// Lazy-loaded three.js viewer: drag to rotate, pinch/scroll to zoom.
export default function StlViewer({ url }: { url: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false,
      cleanup = () => {};
    (async () => {
      const THREE = await import("three");
      const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      const el = host.current;
      if (cancelled || !el) return;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(el.clientWidth, el.clientHeight);
      el.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x9fb4b8, 2.2));
      const sun = new THREE.DirectionalLight(0xffffff, 1.6);
      sun.position.set(1, 2, 3);
      scene.add(sun);
      const camera = new THREE.PerspectiveCamera(35, el.clientWidth / el.clientHeight, 0.1, 5000);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      let frame = 0;
      const loop = () => {
        controls.update();
        renderer.render(scene, camera);
        frame = requestAnimationFrame(loop);
      };
      cleanup = () => {
        cancelAnimationFrame(frame);
        controls.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
      try {
        const buffer = await (await fetch(url)).arrayBuffer();
        if (cancelled) return;
        const geometry = new STLLoader().parse(buffer);
        geometry.computeVertexNormals();
        geometry.center();
        geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x5aa9a3, roughness: 0.55, metalness: 0.05 }));
        mesh.rotation.x = -Math.PI / 2;
        scene.add(mesh);
        const r = geometry.boundingSphere?.radius || 50;
        camera.position.set(r * 1.2, r * 1.5, r * 2.2);
        camera.lookAt(0, 0, 0);
        loop();
      } catch {
        setError("Couldn't load this model.");
      }
    })();
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [url]);
  return <div className="stl-viewer" ref={host}>{error && <p>{error}</p>}</div>;
}
