import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../../lib/theme';

interface AmbientLightProps {
  dark: boolean;
}

// The field is soft by design, so a third of native resolution is indistinguishable and far cheaper
const RENDER_SCALE = 0.34;
const FRAME_MS = 1000 / 30;

const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// Domain-warped fbm: slow, warm light moving through linen. Two palettes blended by uDark.
const FRAGMENT = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uDark;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = uTime * 0.035;

  vec2 q = vec2(fbm(p * 1.3 + vec2(0.0, t)), fbm(p * 1.3 + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p * 1.5 + 2.0 * q + vec2(1.7, 9.2) + t * 1.3),
                fbm(p * 1.5 + 2.0 * q + vec2(8.3, 2.8) - t * 0.9));
  float f = fbm(p * 1.15 + 2.2 * r);

  vec3 cream = vec3(0.984, 0.965, 0.933);
  vec3 peach = vec3(0.985, 0.860, 0.745);
  vec3 apricot = vec3(0.965, 0.735, 0.540);
  vec3 rose = vec3(0.945, 0.790, 0.770);
  vec3 sage = vec3(0.860, 0.875, 0.770);
  vec3 light = mix(cream, peach, smoothstep(0.25, 0.85, f));
  light = mix(light, apricot, smoothstep(0.65, 1.15, length(q)) * 0.55);
  light = mix(light, rose, smoothstep(0.45, 0.9, r.y) * 0.32);
  light = mix(light, sage, smoothstep(0.55, 0.95, r.x) * 0.26);

  vec3 espresso = vec3(0.102, 0.078, 0.067);
  vec3 ember = vec3(0.330, 0.150, 0.070);
  vec3 amber = vec3(0.330, 0.220, 0.090);
  vec3 wine = vec3(0.240, 0.085, 0.095);
  vec3 dark = mix(espresso, ember, smoothstep(0.38, 0.95, f) * 0.75);
  dark = mix(dark, amber, smoothstep(0.7, 1.15, length(q)) * 0.45);
  dark = mix(dark, wine, smoothstep(0.45, 0.95, r.y) * 0.4);

  vec3 col = mix(light, dark, uDark);

  col *= mix(1.0, 0.93, smoothstep(0.35, 1.1, length(uv - 0.5) * 1.4));
  col += (hash(gl_FragCoord.xy + t) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('AmbientLight shader failed:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('AmbientLight link failed:', gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

/** Full-window WebGL light field behind the frosted panes; falls back to a static CSS gradient. */
export function AmbientLight({ dark }: AmbientLightProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const darkRef = useRef(dark ? 1 : 0);
  const kickRef = useRef<() => void>(() => {});
  const [failed, setFailed] = useState(false);
  darkRef.current = dark ? 1 : 0;

  // When the loop is paused (reduced motion, unfocused), still play the theme blend to completion
  useEffect(() => kickRef.current(), [dark]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
    const program = gl ? createProgram(gl) : null;
    if (!canvas || !gl || !program) {
      setFailed(true);
      return;
    }

    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, 'uRes');
    const uTime = gl.getUniformLocation(program, 'uTime');
    const uDark = gl.getUniformLocation(program, 'uDark');

    const still = prefersReducedMotion();
    let darkMix = darkRef.current;
    let frame = 0;
    let last = 0;
    let running = true;
    const start = performance.now();

    const resize = () => {
      canvas.width = Math.max(1, Math.round(window.innerWidth * RENDER_SCALE));
      canvas.height = Math.max(1, Math.round(window.innerHeight * RENDER_SCALE));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
    };

    const draw = (now: number) => {
      darkMix += (darkRef.current - darkMix) * 0.12;
      gl.uniform1f(uTime, still ? 12 : (now - start) / 1000);
      gl.uniform1f(uDark, darkMix);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const loop = (now: number) => {
      if (!running) return;
      frame = requestAnimationFrame(loop);
      if (now - last < FRAME_MS) return;
      last = now;
      draw(now);
    };

    const setRunning = (next: boolean) => {
      if (next === running) return;
      running = next;
      if (running) frame = requestAnimationFrame(loop);
      else cancelAnimationFrame(frame);
    };

    // An unfocused mail client sits open for hours; freezing the field there costs nothing visually
    const onVisibility = () => setRunning(!document.hidden && document.hasFocus() && !still);
    const onResize = () => {
      resize();
      draw(performance.now());
    };
    // A GPU reset kills the context; the static CSS gradient is a fine stand-in
    const onContextLost = (event: Event) => {
      event.preventDefault();
      setRunning(false);
      setFailed(true);
    };

    resize();
    draw(performance.now());
    running = false;
    setRunning(!still);

    canvas.addEventListener('webglcontextlost', onContextLost);
    window.addEventListener('resize', onResize);
    window.addEventListener('focus', onVisibility);
    window.addEventListener('blur', onVisibility);
    document.addEventListener('visibilitychange', onVisibility);

    let burst = 0;
    kickRef.current = () => {
      if (running) return;
      cancelAnimationFrame(burst);
      const until = performance.now() + 700;
      const step = (now: number) => {
        draw(now);
        if (now < until && !running) burst = requestAnimationFrame(step);
      };
      burst = requestAnimationFrame(step);
    };

    return () => {
      running = false;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(burst);
      kickRef.current = () => {};
      window.removeEventListener('resize', onResize);
      window.removeEventListener('focus', onVisibility);
      window.removeEventListener('blur', onVisibility);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      // No loseContext() here: StrictMode re-runs this effect on the same canvas, and a lost context can't be reused
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, []);

  if (failed) {
    return (
      <div
        aria-hidden="true"
        className="fixed inset-0 -z-0 bg-[radial-gradient(1200px_700px_at_80%_10%,rgb(var(--primary-soft)),transparent_60%),radial-gradient(900px_600px_at_10%_90%,rgb(var(--marigold)/0.18),transparent_60%)] bg-background"
      />
    );
  }

  return <canvas ref={canvasRef} aria-hidden="true" className="fixed inset-0 z-0 h-full w-full" />;
}
