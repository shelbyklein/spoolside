import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { WATER_FRAGMENT } from "./water.frag";

// Animated pool water for the desktop sidebar and the phone home screen: WebGL caustics and a slow GSAP tide.
// Pointer ripples disturb the surface locally without moving it. Still frame with reduced motion; CSS gradient if WebGL is unavailable.
export function WaterBackground({ className = "sidebar-water" }: { className?: string }) {
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
    const u = Object.fromEntries(["resolution", "drift", "time", "scale", "sunlight", "ripples[0]"].map((k) => [k, gl.getUniformLocation(program, k)]));

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
    const state = { tide: 0 };
    const tide = gsap.to(state, { tide: 0.16, duration: 12, ease: "sine.inOut", repeat: -1, yoyo: true });
    const motionPreference = () => { if (reduce.matches) tide.pause(); else tide.resume(); };
    motionPreference();
    reduce.addEventListener("change", motionPreference);
    const stillRipples = new Float32Array(32);

    // A bounded ring buffer avoids per-event React renders. Capture on the containing surface
    // so links still receive clicks and touch scrolling is never prevented.
    const surface = canvas.parentElement!;
    const ripples = new Float32Array(8 * 4);
    for (let i = 0; i < 8; i++) ripples[i * 4 + 2] = -100;
    let nextRipple = 0, lastRippleAt = -100, lastX = -1000, lastY = -1000;
    let elapsed = 0, last = performance.now();
    const addWave = (clientX: number, clientY: number, strength: number, trail: boolean) => {
      if (reduce.matches || document.hidden) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return;
      const x = clientX - rect.left, y = clientY - rect.top;
      if (trail && (elapsed - lastRippleAt < .10 || Math.hypot(x-lastX,y-lastY) < 12)) return;
      const i = (nextRipple++ % 8) * 4;
      ripples.set([x / rect.width, 1 - y / rect.height, elapsed, strength], i);
      lastRippleAt = elapsed; lastX = x; lastY = y;
      surface.dispatchEvent(new CustomEvent("water-wave", { detail: { x: clientX, y: clientY, strength } }));
    };
    const spoolWave = (event: Event) => {
      const { x, y, strength } = (event as CustomEvent).detail;
      addWave(x, y, strength, false);
    };
    const ripple = (event: PointerEvent) => {
      if (reduce.matches || document.hidden) return;
      if (event.type === "pointermove" && event.pointerType !== "mouse" && !event.buttons) return;
      if ((event.target as Element)?.closest(".floating-spool")) return;
      addWave(event.clientX, event.clientY, event.type === "pointerdown" ? 1 : .65, event.type === "pointermove");
    };
    surface.addEventListener("water-ripple", spoolWave);
    surface.addEventListener("pointermove", ripple, { passive: true });
    surface.addEventListener("pointerdown", ripple, { passive: true });
    const draw = () => {
      const now = performance.now(), delta = Math.min((now - last) / 1000, 0.06);
      last = now;
      if (document.hidden) return;
      if (!reduce.matches) elapsed += delta * 0.55;
      gl.uniform2f(u.resolution, canvas.width, canvas.height);
      gl.uniform2f(u.drift, 0, 0);
      gl.uniform1f(u.time, elapsed);
      gl.uniform1f(u.scale, 1.45 + state.tide);
      gl.uniform1f(u.sunlight, 0.8);
      gl.uniform4fv(u["ripples[0]"], reduce.matches ? stillRipples : ripples);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
    // 30 fps is plenty for slow water and keeps the sidebar cheap.
    gsap.ticker.fps(30);
    gsap.ticker.add(draw);
    draw();
    return () => {
      surface.removeEventListener("water-ripple", spoolWave);
      surface.removeEventListener("pointermove", ripple);
      surface.removeEventListener("pointerdown", ripple);
      gsap.ticker.remove(draw);
      tide.kill();
      reduce.removeEventListener("change", motionPreference);
      observer.disconnect();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);
  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
