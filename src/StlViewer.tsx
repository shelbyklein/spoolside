import { useEffect, useRef, useState } from "react";
import { DEFAULT_PART_COLOR } from "./colors";

// Lazy-loaded three.js viewer: drag to rotate, pinch/scroll to zoom.
export default function StlViewer({ url, urls, colors }: { url?: string; urls?: string[]; colors?: string[] }) {
  const sourceKey=JSON.stringify(urls || (url?[url]:[]));
  const host = useRef<HTMLDivElement>(null);
  const meshMaterials = useRef<import("three").MeshStandardMaterial[]>([]);
  const colorsRef = useRef(colors);
  colorsRef.current = colors;
  const [error, setError] = useState("");
  useEffect(() => {
    setError("");
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
      const geometries: import("three").BufferGeometry[]=[];
      const materials: import("three").Material[]=[];
      const resize = new ResizeObserver(()=>{
        if(!el.clientWidth || !el.clientHeight)return;
        renderer.setSize(el.clientWidth,el.clientHeight);
        camera.aspect=el.clientWidth/el.clientHeight;
        camera.updateProjectionMatrix();
      });
      resize.observe(el);
      let frame = 0;
      const loop = () => {
        controls.update();
        renderer.render(scene, camera);
        frame = requestAnimationFrame(loop);
      };
      cleanup = () => {
        cancelAnimationFrame(frame);
        resize.disconnect();
        controls.dispose();
        geometries.forEach(g=>g.dispose());
        materials.forEach(m=>m.dispose());
        renderer.dispose();
        renderer.domElement.remove();
      };
      try {
        const group=new THREE.Group();
        const sources: string[]=JSON.parse(sourceKey);
        if(!sources.length)throw Error("No models");
        // Preserve relative STL coordinates; center only the combined assembly.
        for(const source of sources){
          const response=await fetch(source);
          if(!response.ok)throw Error("Model unavailable");
          const buffer=await response.arrayBuffer();
          if(cancelled)return;
          const geometry=new STLLoader().parse(buffer);
          geometries.push(geometry);
          geometry.computeVertexNormals();
          const material=new THREE.MeshStandardMaterial({color:colorsRef.current?.[materials.length]||DEFAULT_PART_COLOR,roughness:0.55,metalness:0.05});
          materials.push(material);
          group.add(new THREE.Mesh(geometry,material));
        }
        meshMaterials.current=materials as import("three").MeshStandardMaterial[];
        const bounds=new THREE.Box3().setFromObject(group);
        const center=bounds.getCenter(new THREE.Vector3());
        group.children.forEach(mesh=>mesh.position.sub(center));
        group.rotation.x=-Math.PI/2;
        scene.add(group);
        const r=bounds.getBoundingSphere(new THREE.Sphere()).radius || 50;
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
  }, [sourceKey]);
  useEffect(() => {
    meshMaterials.current.forEach((m, i) => m.color.set(colors?.[i] || DEFAULT_PART_COLOR));
  }, [JSON.stringify(colors)]);
  return <div className="stl-viewer" ref={host}>{error && <p>{error}</p>}</div>;
}
