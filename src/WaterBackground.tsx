import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { WATER_FRAGMENT } from "./water.frag";

// Animated pool water for the desktop sidebar: WebGL caustics, GSAP-eased pointer parallax
// and a slow tide. Still frame with reduced motion; CSS gradient if WebGL is unavailable.
export function WaterBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl", { alpha: false, antialias: false, powerPreference: "low-power" });
    if (!canvas || !gl) return;
    const compile = (type: number, source: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, source);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(sh) || "shader");
      return sh;
    };
    const program = gl.createProgram()!;
    try {
      gl.attachShader(program, compile(gl.VERTEX_SHADER, "attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}"));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, WATER_FRAGMENT));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error("link");
    } catch {
      canvas.hidden = true;
      return;
    }
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    const u = Object.fromEntries(["resolution", "drift", "time", "scale", "sunlight"].map((k) => [k, gl.getUniformLocation(program, k)]));

    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    const state = { x: 0, y: 0, tide: 0 };
    const xTo = gsap.quickTo(state, "x", { duration: 1.8, ease: "power2.out" });
    const yTo = gsap.quickTo(state, "y", { duration: 1.8, ease: "power2.out" });
    const onMove = (e: PointerEvent) => {
      if (reduce.matches) return;
      xTo((e.clientX / innerWidth - 0.5) * 2);
      yTo((0.5 - e.clientY / innerHeight) * 2);
    };
    addEventListener("pointermove", onMove, { passive: true });
    const tide = gsap.to(state, { tide: 0.16, duration: 12, ease: "sine.inOut", repeat: -1, yoyo: true });

    let elapsed = 0, last = performance.now();
    const draw = () => {
      const now = performance.now(), delta = Math.min((now - last) / 1000, 0.06);
      last = now;
      if (document.hidden) return;
      if (!reduce.matches) elapsed += delta * 0.55;
      gl.uniform2f(u.resolution, canvas.width, canvas.height);
      gl.uniform2f(u.drift, state.x, state.y);
      gl.uniform1f(u.time, elapsed);
      gl.uniform1f(u.scale, 1.05 + state.tide);
      gl.uniform1f(u.sunlight, 0.8);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
    // 30 fps is plenty for slow water and keeps the sidebar cheap.
    gsap.ticker.fps(30);
    gsap.ticker.add(draw);
    draw();
    return () => {
      gsap.ticker.remove(draw);
      tide.kill();
      removeEventListener("pointermove", onMove);
      observer.disconnect();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);
  return <canvas ref={canvasRef} className="sidebar-water" aria-hidden="true" />;
}
