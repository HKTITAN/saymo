// Mesh gradient: a ground of soft colour from the brand's palette, blobs
// drifting on loops that close at the film's end (so a looping film loops
// cleanly), with optional film grain. Inspired by After Effects SaaS
// gradient backgrounds: the idea, rebuilt here from scratch for the studio.
// Read the brand's rules first: some brands are flat colour only, and then
// this part isn't for them.
//
// It draws from the film's clock, never on its own:
//
//   const ground = meshGradient(document.getElementById("ground"), { grain: 0.4 });
//   filmTimeline(sequence, { duration: FILM.duration, parts: [ground] });
//
// Load it after timeline.js: <script src="assets/parts/gradient.js"></script>
// Give it its own element behind everything (position: absolute, inset: 0,
// first in the film); the blobs go under anything already inside it.
//
//   preset    a ready look: "aurora", "dusk", "mint", "peach", "ocean",
//             "lilac", "ember" or "star" (a starburst: slow light rays
//             turning round a glow); colors and base still override it
//   colors    the blobs' colours (default: the brand's accent and two light
//             steps from its ramps, tints of the accent, or a soft pastel
//             three without a brand)
//   base      the colour under them (default the brand's background)
//   blobs     how many (default one per colour)
//   size      each blob, as a share of the frame's long side (default 0.8)
//   softness  0 to 1: how gently each blob fades out (default 0.7)
//   drift     how far blobs wander, as a share of the frame (default 0.1)
//   period    seconds for one full loop (default the film's duration)
//   seed      another arrangement (any number)
//   grain     0 to 1 (default 0): film grain over it, changing 24 times a
//             second
//   star      the starburst on any look: true, or { rays (default 24),
//             strength (0 to 1, default 0.5) }
//
// The returned part has draw(t) and blobs (the elements).
(function () {
  const TAU = Math.PI * 2;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smooth = (p) => p * p * (3 - 2 * p);
  const f = (v) => v.toFixed(3);
  const PASTEL = ["#c4d4ff", "#ffcfe1", "#cdeedd"];
  // The ready looks: three colours over a ground each, and the starburst.
  const PRESETS = {
    aurora: { base: "#0b1020", colors: ["#3d63ff", "#22d3ee", "#a855f7"] },
    dusk: { base: "#1a1020", colors: ["#ff7a59", "#ff3d8b", "#6b4dff"] },
    mint: { base: "#f6fbf8", colors: ["#b8f2d0", "#9fe6ff", "#d9f99d"] },
    peach: { base: "#fff7f2", colors: ["#ffd1b8", "#ffc2d6", "#ffe7a8"] },
    ocean: { base: "#04121f", colors: ["#0ea5e9", "#14b8a6", "#1d4ed8"] },
    lilac: { base: "#f7f5ff", colors: ["#d8ccff", "#ffd6f5", "#c7e3ff"] },
    ember: { base: "#140b06", colors: ["#ff6a00", "#ff2e4d", "#ffb800"] },
    star: { base: "#07070c", colors: ["#9747ff", "#3d63ff", "#ff3d8b"], star: true },
  };

  function seeded(seed) {
    let a = (seed * 2654435761) >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Grey noise for the grain, drawn once by the browser from an SVG filter.
  const NOISE = `url("data:image/svg+xml,${encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>",
  )}")`;

  function meshGradient(container, opts = {}) {
    const brand = window.__brand;
    const roles = brand?.colors?.roles ?? {};
    const ramps = brand?.colors?.ramps ?? [];
    const preset = PRESETS[opts.preset] ?? null;
    const base = opts.base ?? preset?.base ?? roles.background ?? "#fbfbfa";
    const fromBrand = [roles.accent, ramps[0]?.steps?.[1]?.hex, ramps[1]?.steps?.[1]?.hex].filter(Boolean);
    const tints = roles.accent ? [roles.accent, `color-mix(in oklab, ${roles.accent} 50%, ${base})`, `color-mix(in oklab, ${roles.accent} 28%, white)`] : PASTEL;
    const colors = opts.colors?.length ? opts.colors : (preset?.colors ?? (fromBrand.length >= 3 ? fromBrand : tints));
    const count = Math.max(1, Math.round(opts.blobs ?? colors.length));
    const size = opts.size ?? 0.8;
    const inner = (1 - clamp(opts.softness ?? 0.7)) * 0.5;
    const drift = opts.drift ?? 0.1;
    const period = Math.max(0.1, opts.period ?? (window.__film?.duration || 8));
    const grain = clamp(opts.grain ?? 0);
    const next = seeded(opts.seed ?? 1);

    container.style.background = base;
    container.style.overflow = "hidden";
    if (getComputedStyle(container).position === "static") container.style.position = "relative";

    // A blob fades on an eased curve, so it has no hard rim and no banding ring.
    const stops = (c) =>
      Array.from({ length: 15 }, (_, i) => {
        const u = i / 14;
        const a = 1 - smooth(clamp((u - inner) / (1 - inner)));
        return `color-mix(in oklab, ${c} ${f(a * 100)}%, transparent) ${f(u * 100)}%`;
      }).join(", ");

    const first = container.firstChild;
    const blobs = Array.from({ length: count }, (_, i) => {
      const el = document.createElement("div");
      el.className = "mesh-blob";
      Object.assign(el.style, { position: "absolute", left: "0", top: "0", pointerEvents: "none", willChange: "transform", background: `radial-gradient(closest-side, ${stops(colors[i % colors.length])})` });
      container.insertBefore(el, first);
      return { el, cx: 0.18 + 0.64 * next(), cy: 0.18 + 0.64 * next(), fx: 1 + Math.floor(next() * 2), fy: 1 + Math.floor(next() * 2), px: next() * TAU, py: next() * TAU, ps: next() * TAU, turn: next() < 0.5 ? -1 : 1 };
    });

    // The starburst: soft rays turning round a glow, under the grain.
    const starOpts = opts.star ?? (preset?.star ? true : null);
    let rays = null;
    let rayStep = 15;
    if (starOpts) {
      const count = Math.max(6, Math.round(starOpts.rays ?? 24));
      const strength = clamp(starOpts.strength ?? 0.5);
      rayStep = 360 / count;
      rays = document.createElement("div");
      rays.className = "mesh-rays";
      Object.assign(rays.style, {
        position: "absolute",
        left: "-50%",
        top: "-50%",
        width: "200%",
        height: "200%",
        pointerEvents: "none",
        background: `radial-gradient(circle at 50% 50%, color-mix(in oklab, ${colors[0]} ${f(70 * strength)}%, transparent) 0%, transparent 22%), repeating-conic-gradient(from 0deg at 50% 50%, rgba(255, 255, 255, ${f(0.16 * strength)}) 0deg ${f(rayStep * 0.32)}deg, transparent ${f(rayStep * 0.5)}deg ${f(rayStep)}deg)`,
        maskImage: "radial-gradient(circle at 50% 50%, #000 0%, transparent 46%)",
        webkitMaskImage: "radial-gradient(circle at 50% 50%, #000 0%, transparent 46%)",
      });
      container.appendChild(rays);
    }

    let noise = null;
    if (grain > 0) {
      noise = document.createElement("div");
      noise.className = "mesh-grain";
      Object.assign(noise.style, { position: "absolute", inset: "0", pointerEvents: "none", backgroundImage: NOISE, backgroundSize: "220px 220px", mixBlendMode: "overlay", opacity: f(grain * 0.55) });
      container.appendChild(noise);
    }

    let sized = 0;
    function draw(t) {
      const w = container.clientWidth || 1920;
      const h = container.clientHeight || 1080;
      const S = size * Math.max(w, h);
      // Whole turns in one period, so t = period looks exactly like t = 0.
      const a = (t / period) * TAU;
      for (const b of blobs) {
        if (S !== sized) b.el.style.width = b.el.style.height = `${f(S)}px`;
        const x = (b.cx + drift * Math.sin(b.fx * a * b.turn + b.px)) * w;
        const y = (b.cy + drift * Math.cos(b.fy * a + b.py)) * h;
        const k = 1 + 0.08 * Math.sin(a + b.ps);
        b.el.style.transform = `translate(${f(x - S / 2)}px, ${f(y - S / 2)}px) scale(${f(k)})`;
      }
      sized = S;
      // One ray's width a period, so the turn loops cleanly.
      if (rays) rays.style.transform = `rotate(${f((t / period) * rayStep)}deg) scale(${f(1 + 0.04 * Math.sin(a))})`;
      if (noise) {
        const shake = seeded(Math.floor(t * 24) + 1);
        noise.style.backgroundPosition = `${Math.floor(shake() * 220)}px ${Math.floor(shake() * 220)}px`;
      }
    }

    draw(0);
    return { draw, blobs: blobs.map((b) => b.el) };
  }

  window.meshGradient = meshGradient;
})();
