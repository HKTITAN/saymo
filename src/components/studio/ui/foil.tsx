"use client";

import { useEffect, useRef } from "react";

// Coloured metal foil drawn with WebGL, for the AI cards in Settings: a fine
// embossed grain and brushed streaks catch a light, studio-light strips
// slide across as the light moves, and a sharp highlight follows it.
// `light` is where the light is, -1 to 1 on each axis (the pointer over
// the sleeve). With `drift`, the light wanders slowly on its own while
// nothing else moves it. If WebGL isn't there, nothing draws and the
// card's CSS foil shows through.

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform vec2 uLight;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uBright;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
// The surface's height: an embossed grain, and fine brushed streaks.
float height(vec2 p) {
  return fbm(p * 1.4) * 0.4 + noise(vec2(p.x * 0.06, p.y * 2.6)) * 0.18;
}

void main() {
  vec2 px = vUv * uRes; // in pixels, so the grain stays the same size
  float h = height(px);
  float hx = height(px + vec2(1.0, 0.0));
  float hy = height(px + vec2(0.0, 1.0));
  vec3 n = normalize(vec3((h - hx) * 0.9, (h - hy) * 0.9, 1.0));

  vec2 uv = vUv;
  vec2 l = uLight;

  // The colour: the middle shade, deepening towards the bottom left.
  vec3 base = mix(uMid, uDeep, smoothstep(0.0, 1.0, (1.0 - uv.y) * 0.65 + (1.0 - uv.x) * 0.45));

  // Studio-light strips reflected in the metal, sliding with the light.
  float band = uv.x * 0.85 + (1.0 - uv.y) * 0.35 - l.x * 0.55 + l.y * 0.25 + n.x * 0.35 + n.y * 0.2;
  float strip = pow(0.5 + 0.5 * sin(band * 6.2831 * 1.15), 8.0);
  float wash = pow(0.5 + 0.5 * sin(band * 6.2831 * 0.45 + 1.2), 3.0);

  // A point light for shading and a sharp highlight.
  vec3 L = normalize(vec3(l.x * 0.9 - (uv.x - 0.5), l.y * 0.9 - (uv.y - 0.5), 0.75));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float diff = max(dot(n, L), 0.0);
  float spec = pow(max(dot(n, H), 0.0), 90.0);
  float glint = smoothstep(0.55, 0.0, length((uv - 0.5) - vec2(l.x, l.y) * 0.45));

  vec3 col = base * (0.62 + 0.42 * diff);
  col += mix(uMid, uBright, 0.75) * strip * 0.55;
  col += uBright * wash * 0.22;
  col += vec3(1.0, 0.97, 0.95) * spec * 0.55;
  col += uBright * glint * 0.18;
  // Darker towards the edges, like a curved, lit plate.
  float edge = smoothstep(0.0, 0.08, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
  col *= 0.88 + 0.12 * edge;
  gl_FragColor = vec4(col, 1.0);
}
`;

const rgb = (hex: string) => {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] as const;
};

export function Foil({
  colors,
  light,
  drift,
}: {
  colors: readonly [string, string, string];
  light: { x: number; y: number } | null;
  drift: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const draw = useRef<((l: { x: number; y: number }) => void) | null>(null);
  const target = useRef(light);
  useEffect(() => {
    target.current = light;
  });

  // Set up once per set of colours.
  useEffect(() => {
    const el = canvas.current;
    const gl = el?.getContext("webgl", { premultipliedAlpha: false, antialias: true });
    if (!el || !gl) return;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    const u = (name: string) => gl.getUniformLocation(prog, name);
    gl.uniform3fv(u("uDeep"), rgb(colors[0]));
    gl.uniform3fv(u("uMid"), rgb(colors[1]));
    gl.uniform3fv(u("uBright"), rgb(colors[2]));
    const uRes = u("uRes");
    const uLight = u("uLight");

    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(el.clientWidth * dpr);
      const h = Math.round(el.clientHeight * dpr);
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
    };
    draw.current = (l) => {
      size();
      gl.uniform2f(uLight, l.x, l.y);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    draw.current(target.current ?? { x: -0.35, y: 0.3 });
    return () => {
      // The context stays with the canvas (React may set this up twice);
      // only the program and buffer go.
      draw.current = null;
      gl.deleteProgram(prog);
      gl.deleteBuffer(buf);
    };
  }, [colors]);

  // Follow the light, easing towards it; drift on its own when asked.
  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cur = target.current ?? { x: -0.35, y: 0.3 };
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      const goal =
        target.current ?? (drift && !still ? { x: Math.sin(t * 0.35) * 0.55, y: 0.25 + Math.cos(t * 0.27) * 0.3 } : { x: -0.35, y: 0.3 });
      const moved = Math.abs(goal.x - cur.x) + Math.abs(goal.y - cur.y) > 0.0005;
      cur = { x: cur.x + (goal.x - cur.x) * 0.12, y: cur.y + (goal.y - cur.y) * 0.12 };
      if (moved) draw.current?.(cur);
      // Keep going only while there's something to follow or drift.
      if (!still && (moved || drift || target.current)) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [drift]);

  return <canvas ref={canvas} aria-hidden="true" className="absolute inset-0 size-full rounded-[inherit]" />;
}
