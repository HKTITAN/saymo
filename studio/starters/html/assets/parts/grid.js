// Grid field: many cards laid out as a grid, a scatter, a ring, along a path
// or over a turning sphere, morphing from one layout to the next, with a
// point moving through them that cards react to (near it they grow, turn to
// face it, step aside, blur, fade or take a colour) and ripples that roll
// across them. Inspired by an After Effects grid tool: its ideas, rebuilt
// here from scratch for the studio.
//
// It draws from the film's clock, never on its own, so the studio and the
// renderer get exactly the same frame for the same time:
//
//   const grid = gridField(document.getElementById("grid"), {
//     items: [{ src: "assets/shot-1.png" }, { text: "Fast" }, ...],
//     layout: "grid",
//     morphs: [{ at: 2, duration: 1.2, to: "ring" }],
//     field: { keys: [{ at: 0, x: 200, y: 540 }, { at: 4, x: 1700, y: 540 }], radius: 320, scale: [1.5, 1] },
//   });
//   const tl = filmTimeline(sequence, { duration: FILM.duration, parts: [grid] });
//
// Load it after timeline.js: <script src="assets/parts/grid.js"></script>
//
// The container is a positioned element with a size (position: absolute and
// inset: 0, say). Times are film seconds and positions px in the container.
// Only `items` is needed; everything else is optional.
//
//   items     the cards: { src } an image, { text } a word, { html } markup
//             or { el } an element you made, each with an optional
//             `className`, `style` (an object) and `id`. Or a number: that
//             many plain tiles (dots, with corner 0.5), styled by cardStyle.
//   card      card size in px (default: fitted to the first layout)
//   corner    corner radius as a share of the card (default 0.18; 0.5 is round)
//   layout    where the cards start: "grid" (default), "scatter", "ring",
//             "path" or "sphere", or { type, ...its options }:
//               grid     cols, gap (px between cards)
//               scatter  seed (any number, for another scatter), spread
//                        (share of the frame used, default 0.8), turn (most
//                        degrees a card leans, default 12)
//               ring     radius (px), rings (default 1: with more, outer
//                        rings hold more cards, as on a polar grid, unless
//                        fill: "even"), turn (degrees where each ring's
//                        first card sits, default -90), spin (turns a
//                        second, default 0; rings alternate direction),
//                        face: "out" (cards point outward; default upright)
//               path     d (an SVG path in container px) or shape: "wave",
//                        "loop" or "arc" (default "wave"); travel (px a
//                        second along it, default 0); align: false keeps
//                        cards upright (default: they turn with the path)
//               sphere   radius (px), spin (turns a second, default 0.05),
//                        tilt (degrees, default 14), turn (degrees),
//                        perspective (px, default 4 x radius); cards at the
//                        back go small, soft and faint
//   morphs    [{ at, duration, to, stagger, from }]: each moves every card
//             from the layout it's in to `to` (a layout, as above).
//             stagger (0 to 0.9, default 0.35) spreads the move across the
//             cards, starting from "center" (default), "start", "end" or
//             "random". Give them in time order.
//   field     a point moving through the cards: keys [{ at, x, y }] (eased
//             between, held before the first and after the last), or
//             follow: a function of time giving { x, y } (a cursor part's
//             pointAt, so the grid answers the cursor), radius
//             (px, default 300), falloff "smooth" (default), "linear" or
//             "sharp", and what happens near it, each optional:
//               scale  [near, far], e.g. [1.6, 1]
//               aim    true: every card turns its top to the point (arrows
//                      and chevrons show it best); "near": only within the
//                      radius, more the closer
//               push   px: cards step away from it (negative pulls them in)
//               blur   px, at the point
//               fade   [near, far] opacity
//               color  { near, far, prop }: hex colours mixed by closeness,
//                      on "background" (default) or "color"
//               show   true draws the point's reach as a faint ring
//               name   a CSS variable set on every card, from 0 (out of
//                      reach) to 1 (at the point): name "glow" gives --glow,
//                      so the film's CSS can drive anything with it, e.g.
//                      .grid-card { filter: saturate(calc(0.3 + var(--glow))) }
//               apply  (card, near, index) => {}: runs for every card on
//                      every frame, for anything else closeness should drive
//             A field can follow several points at once: points: [{ keys }
//             or { follow }, ...] (the closest one counts for each card).
//   fields    several fields at once, each as above with its own points,
//             reach and effects (one might push, another colour)
//   waves     [{ at, x, y, speed, width, scale, lift }]: a ripple rolling
//             out from (x, y) (default the middle) from `at`: speed px a
//             second (default 900), width px (default 160), scale at its
//             crest (default 1.35), lift px up at its crest (default 0).
//             A cursor's click is a good place to start one. Cards get
//             --wave, 0 to 1 as a crest passes, for the film's CSS.
//   enter     { at, duration, stagger, from }: cards pop in (default: in
//             place from the start)
//   leave     { at, duration, stagger, from }: cards shrink away
//   camera    keys [{ at, zoom, x, y, turn }]: zoom 1 is as set, x and y pan
//             in px, turn in degrees; eased between keys
//   cardStyle styles for every card (an object): background, color, font,
//             boxShadow and so on. Cards default to the brand's surface and
//             ink colours and its display font.
//
// The returned part has draw(t) (filmTimeline calls it on every seek),
// cards (the elements, in order) and points (where each card sat at the
// last draw, before the camera: x, y, scale), for anything that follows them.
(function () {
  const TAU = Math.PI * 2;
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const mix = (a, b, k) => a + (b - a) * k;
  const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
  // Expo out: quick, then a long soft stop.
  const easeOut = (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p));
  const smooth = (p) => p * p * (3 - 2 * p);
  const range = (n) => Array.from({ length: n }, (_, i) => i);
  const FALLOFF = { smooth, linear: (k) => k, sharp: (k) => k * k * k };

  // A small seeded random, so a scatter is the same on every frame and every render.
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

  // The shorter way round between two angles, in degrees.
  const turnMix = (a, b, k) => a + ((((b - a + 540) % 360) + 360) % 360 - 180) * k;

  const rgb = (c) => {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c ?? "").trim());
    if (!m) return null;
    const hex = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
    const n = Number.parseInt(hex, 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  };
  const mixColor = (a, b, k) => {
    const A = rgb(a);
    const B = rgb(b);
    if (!A || !B) return k > 0.5 ? b : a;
    return `rgb(${A.map((v, i) => Math.round(mix(v, B[i], k))).join(", ")})`;
  };

  // Values from keys at time t, eased between them.
  function keyed(keys, t, defaults) {
    if (!keys?.length) return { ...defaults };
    const ks = [...keys].sort((p, q) => p.at - q.at);
    const value = (k, f) => k[f] ?? defaults[f];
    const at = (k) => Object.fromEntries(Object.keys(defaults).map((f) => [f, value(k, f)]));
    if (t <= ks[0].at) return at(ks[0]);
    for (let i = 0; i < ks.length - 1; i++) {
      const a = ks[i];
      const b = ks[i + 1];
      if (t <= b.at) {
        const k = easeInOut(clamp((t - a.at) / Math.max(1e-6, b.at - a.at)));
        return Object.fromEntries(Object.keys(defaults).map((f) => [f, mix(value(a, f), value(b, f), k)]));
      }
    }
    return at(ks[ks.length - 1]);
  }

  const normal = (layout) => (typeof layout === "string" ? { type: layout } : { type: "grid", ...(layout ?? {}) });

  // ─── Layouts: where each card sits, as { x, y, r (degrees), s (scale), blur, fade, z } ───

  const SHAPES = {
    // Across the frame, one and a half waves.
    wave: (u, w, h) => [mix(w * 0.08, w * 0.92, u), h / 2 + Math.sin(u * TAU * 1.5) * h * 0.22],
    // A figure of eight, closed.
    loop: (u, w, h) => {
      const a = u * TAU;
      const d = 1 + Math.sin(a) ** 2;
      return [w / 2 + (Math.cos(a) * w * 0.4) / d, h / 2 + (Math.sin(a) * Math.cos(a) * h * 0.9) / d];
    },
    // An arch across the frame.
    arc: (u, w, h) => {
      const a = Math.PI + u * Math.PI;
      return [w / 2 + Math.cos(a) * w * 0.4, h * 0.72 + Math.sin(a) * h * 0.5];
    },
  };

  // A path sampled by length, once per layout and frame size, so cards sit
  // evenly along it and a travelling path costs nothing extra per frame.
  const sampled = new WeakMap();
  function sampler(o, w, h) {
    const size = `${w}x${h}`;
    let sizes = sampled.get(o);
    if (!sizes) sampled.set(o, (sizes = new Map()));
    if (sizes.has(size)) return sizes.get(size);
    const N = 480;
    let pts;
    let closed;
    if (o.d) {
      // Measured on the page (a path only measures reliably there), then taken off.
      const NS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(NS, "svg");
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", o.d);
      svg.setAttribute("width", "0");
      svg.setAttribute("height", "0");
      svg.style.position = "absolute";
      svg.appendChild(path);
      document.body.appendChild(svg);
      const L = path.getTotalLength();
      pts = range(N + 1).map((i) => {
        const p = path.getPointAtLength((i / N) * L);
        return [p.x, p.y];
      });
      svg.remove();
      closed = /z\s*$/i.test(o.d.trim());
    } else {
      const shape = SHAPES[o.shape] ?? SHAPES.wave;
      pts = range(N + 1).map((i) => shape(i / N, w, h));
      closed = o.shape === "loop";
    }
    const len = [0];
    for (let i = 1; i <= N; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = len[N] || 1;
    const point = (s) => {
      const d = clamp(s, 0, total);
      let lo = 0;
      let hi = N;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (len[mid] < d) lo = mid;
        else hi = mid;
      }
      const k = (d - len[lo]) / Math.max(1e-6, len[hi] - len[lo]);
      const a = pts[lo];
      const b = pts[hi];
      return { x: mix(a[0], b[0], k), y: mix(a[1], b[1], k), r: deg(Math.atan2(b[1] - a[1], b[0] - a[0])) };
    };
    const out = { total, closed, point };
    sizes.set(size, out);
    return out;
  }

  // Columns for n cards when none are given: close to the frame's shape,
  // with as few gaps in the last row as that allows (12 cards make 4 by 3,
  // not 5, 5 and 2).
  function autoCols(n, w, h) {
    const guess = Math.max(1, Math.round(Math.sqrt((n * w) / h)));
    let best = guess;
    let score = Number.POSITIVE_INFINITY;
    for (let cols = Math.max(1, guess - 2); cols <= guess + 2; cols++) {
      const rows = Math.ceil(n / cols);
      const empty = rows * cols - n;
      const s = Math.abs(Math.log(cols / Math.max(1, rows) / (w / h))) + (0.5 * empty) / cols;
      if (s < score) {
        score = s;
        best = cols;
      }
    }
    return best;
  }

  const LAYOUTS = {
    grid(o, n, w, h, t, card) {
      const gap = o.gap ?? card * 0.32;
      const cols = Math.max(1, o.cols ?? autoCols(n, w, h));
      const rows = Math.ceil(n / cols);
      const step = card + gap;
      const y0 = h / 2 - ((rows - 1) * step) / 2;
      return range(n).map((i) => {
        const row = Math.floor(i / cols);
        // The last row, if short, is centred under the others.
        const inRow = row === rows - 1 ? n - cols * (rows - 1) : cols;
        return { x: w / 2 - ((inRow - 1) * step) / 2 + (i % cols) * step, y: y0 + row * step, r: 0 };
      });
    },
    scatter(o, n, w, h) {
      const next = seeded(o.seed ?? 7);
      const spread = o.spread ?? 0.8;
      const lean = o.turn ?? 12;
      const placed = [];
      for (let i = 0; i < n; i++) {
        // Of a few tries, the spot furthest from the cards already down, so they don't pile up.
        let best = null;
        let room = -1;
        for (let k = 0; k < 10; k++) {
          const x = w / 2 + (next() - 0.5) * w * spread;
          const y = h / 2 + (next() - 0.5) * h * spread;
          const d = placed.reduce((m, p) => Math.min(m, Math.hypot(p.x - x, p.y - y)), Number.POSITIVE_INFINITY);
          if (d > room) {
            room = d;
            best = { x, y };
          }
        }
        placed.push({ ...best, r: (next() - 0.5) * 2 * lean });
      }
      return placed;
    },
    ring(o, n, w, h, t) {
      const rings = Math.max(1, Math.round(o.rings ?? 1));
      const outer = o.radius ?? Math.min(w, h) * 0.36;
      // Rings evenly spaced out to the radius, innermost first; each holds
      // cards in step with its size, as on a polar grid, or the same number.
      const radii = range(rings).map((k) => (outer * (k + 1)) / rings);
      const share = o.fill === "even" ? radii.map(() => 1) : radii;
      const total = share.reduce((a, b) => a + b, 0);
      const counts = share.map((v) => Math.floor((n * v) / total));
      for (let k = rings - 1, left = n - counts.reduce((a, b) => a + b, 0); left > 0; k = (k + rings - 1) % rings, left--) counts[k]++;
      const out = [];
      counts.forEach((count, k) => {
        for (let j = 0; j < count; j++) {
          const a = rad(o.turn ?? -90) + (j / count) * TAU + (o.spin ?? 0) * t * TAU * (k % 2 ? -1 : 1);
          out.push({ x: w / 2 + Math.cos(a) * radii[k], y: h / 2 + Math.sin(a) * radii[k], r: o.face === "out" ? deg(a) + 90 : 0 });
        }
      });
      return out;
    },
    path(o, n, w, h, t) {
      const p = sampler(o, w, h);
      const flowing = p.closed || Boolean(o.travel);
      const step = p.total / (flowing ? n : Math.max(1, n - 1));
      return range(n).map((i) => {
        let s = i * step + (o.travel ?? 0) * t;
        let fade = 1;
        if (flowing) {
          s = ((s % p.total) + p.total) % p.total;
          // Cards travelling an open path fade at its ends instead of jumping.
          if (!p.closed) fade = smooth(clamp(Math.min(s, p.total - s) / (step * 0.8)));
        }
        const at = p.point(s);
        return { x: at.x, y: at.y, r: o.align === false ? 0 : at.r, fade };
      });
    },
    sphere(o, n, w, h, t) {
      const R = o.radius ?? Math.min(w, h) * 0.36;
      const turn = (o.spin ?? 0.05) * t * TAU + rad(o.turn ?? 0);
      const tilt = rad(o.tilt ?? 14);
      const P = o.perspective ?? R * 4;
      const golden = Math.PI * (3 - Math.sqrt(5));
      return range(n).map((i) => {
        const yv = 1 - (2 * (i + 0.5)) / n;
        const ring = Math.sqrt(Math.max(0, 1 - yv * yv));
        const a = i * golden + turn;
        const x = Math.cos(a) * ring;
        const z = Math.sin(a) * ring;
        const y = yv * Math.cos(tilt) - z * Math.sin(tilt);
        const zt = yv * Math.sin(tilt) + z * Math.cos(tilt);
        const near = (zt + 1) / 2; // 0 at the back, 1 at the front
        const persp = P / (P - zt * R);
        return { x: w / 2 + x * R * persp, y: h / 2 - y * R * persp, r: 0, s: persp * mix(0.62, 1.08, near), blur: mix(4, 0, near), fade: mix(0.4, 1, near), z: zt };
      });
    },
  };

  const full = (p) => ({ x: p.x, y: p.y, r: p.r ?? 0, s: p.s ?? 1, blur: p.blur ?? 0, fade: p.fade ?? 1, z: p.z ?? 0 });

  // Each card's turn in a staggered move, 0 to 1.
  function order(from, starts, w, h, seed) {
    const n = starts.length;
    if (n < 2) return starts.map(() => 0);
    if (from === "start") return starts.map((_, i) => i / (n - 1));
    if (from === "end") return starts.map((_, i) => 1 - i / (n - 1));
    if (from === "random") {
      const next = seeded(seed);
      const keys = starts.map(() => next());
      const sorted = [...keys].sort((a, b) => a - b);
      return keys.map((k) => sorted.indexOf(k) / (n - 1));
    }
    const d = starts.map((p) => Math.hypot(p.x - w / 2, p.y - h / 2));
    const most = Math.max(...d) || 1;
    return d.map((v) => v / most);
  }

  // How far one card is through a staggered move.
  const through = (t, step, rank) => {
    const share = clamp(step.stagger ?? 0.35, 0, 0.9);
    const own = step.duration * (1 - share);
    return clamp((t - step.at - rank * share * step.duration) / Math.max(1e-6, own));
  };

  function gridField(container, opts = {}) {
    const items = typeof opts.items === "number" ? range(opts.items).map(() => ({})) : (opts.items ?? []);
    const n = items.length;
    const brand = window.__brand;
    const roles = brand?.colors?.roles ?? {};
    const font = (brand?.fonts?.find((f) => f.role === "display") ?? brand?.fonts?.[0])?.family;
    const layouts = [normal(opts.layout ?? "grid"), ...(opts.morphs ?? []).map((m) => normal(m.to))];
    const morphs = (opts.morphs ?? []).map((m) => ({ at: m.at ?? 0, duration: Math.max(0.01, m.duration ?? 1), stagger: m.stagger, from: m.from ?? "center" }));
    const waves = (opts.waves ?? []).map((v) => ({ at: v.at ?? 0, x: v.x, y: v.y, speed: v.speed ?? 900, width: v.width ?? 160, scale: v.scale ?? 1.35, lift: v.lift ?? 0 }));
    const surface = opts.cardStyle?.background ?? roles.surface ?? "#f2f2f2";
    const ink = opts.cardStyle?.color ?? roles.ink ?? "#111111";
    // Proximity: one field or several, each following one point or several.
    const fields = [...(opts.field ? [opts.field] : []), ...(opts.fields ?? [])].map((f) => {
      const colorProp = f.color?.prop === "color" ? "color" : "background";
      return {
        ...f,
        points: f.points?.length ? f.points : [{ keys: f.keys, follow: f.follow }],
        radius: f.radius ?? 300,
        falloff: FALLOFF[f.falloff] ?? smooth,
        colorProp,
        colorFar: f.color ? (f.color.far ?? (colorProp === "color" ? ink : surface)) : null,
        variable: f.name ? `--${String(f.name).replace(/[^a-z0-9-]/gi, "")}` : null,
        rings: [],
      };
    });

    const W = () => container.clientWidth || 1920;
    const H = () => container.clientHeight || 1080;
    // A card size that fits the first layout, unless one is given.
    const card =
      opts.card ??
      (() => {
        const w = W();
        const h = H();
        if (layouts[0].type === "grid") {
          const cols = Math.max(1, layouts[0].cols ?? autoCols(n, w, h));
          const rows = Math.ceil(n / cols);
          return Math.max(12, Math.min((w * 0.84) / cols, (h * 0.84) / rows) * 0.76);
        }
        return Math.max(12, Math.min(w, h) * 0.11);
      })();

    // Its own layer: cards stack by depth inside it, and nothing outside it
    // (a cursor above the grid, say) ends up beneath a card.
    const stage = document.createElement("div");
    Object.assign(stage.style, { position: "absolute", inset: "0", transformOrigin: "50% 50%", isolation: "isolate" });
    container.appendChild(stage);

    for (const f of fields) {
      if (!f.show) continue;
      f.rings = f.points.map(() => {
        const ring = document.createElement("div");
        Object.assign(ring.style, {
          position: "absolute",
          left: "0",
          top: "0",
          width: `${f.radius * 2}px`,
          height: `${f.radius * 2}px`,
          borderRadius: "50%",
          border: `1.5px solid ${roles.muted ?? "rgba(127,127,127,0.5)"}`,
          opacity: "0.5",
        });
        stage.appendChild(ring);
        return ring;
      });
    }

    const cards = items.map((item, i) => {
      const el = item.el ?? document.createElement("div");
      el.classList.add("grid-card");
      if (item.className) el.classList.add(...String(item.className).split(/\s+/).filter(Boolean));
      if (item.id) el.id = item.id;
      Object.assign(el.style, {
        position: "absolute",
        left: "0",
        top: "0",
        width: `${card}px`,
        height: `${card}px`,
        borderRadius: `${(opts.corner ?? 0.18) * card}px`,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transformOrigin: "50% 50%",
        willChange: "transform, opacity",
        background: roles.surface ?? "#f2f2f2",
        color: roles.ink ?? "#111111",
        fontFamily: font ? `"${font}", sans-serif` : "inherit",
        fontSize: `${Math.round(card * 0.16)}px`,
        textAlign: "center",
        ...(opts.cardStyle ?? {}),
        ...(item.style ?? {}),
      });
      if (!item.el) {
        if (item.src) {
          const img = document.createElement("img");
          img.src = item.src;
          img.alt = "";
          img.draggable = false;
          Object.assign(img.style, { width: "100%", height: "100%", objectFit: "cover", display: "block" });
          el.appendChild(img);
        } else if (item.html) el.innerHTML = item.html;
        else if (item.text) el.textContent = item.text;
      }
      el.dataset.index = String(i);
      // Cards overlap by design here (scatter, sphere, the field's growth); tell the layout checker.
      el.setAttribute("data-layout-allow-overlap", "");
      stage.appendChild(el);
      return el;
    });

    // Layouts that don't move with time are worked out once.
    const fixed = new Map();
    const place = (k, t, w, h) => {
      const layout = layouts[k];
      const moving = layout.type === "sphere" || (layout.type === "path" && layout.travel) || (layout.type === "ring" && layout.spin);
      const key = `${k}:${w}x${h}`;
      if (!moving && fixed.has(key)) return fixed.get(key);
      const at = (LAYOUTS[layout.type] ?? LAYOUTS.grid)(layout, n, w, h, t, card).map(full);
      if (!moving) fixed.set(key, at);
      return at;
    };

    // Stagger orders, worked out once from fixed moments (never from the
    // frame being drawn), so seeking in any order gives the same frames.
    const ranks = new Map();
    const rankFor = (key, from, starts, w, h, seed) => {
      if (!ranks.has(key)) ranks.set(key, order(from, starts(), w, h, seed));
      return ranks.get(key);
    };

    // Where every card is at time t, through the morphs (the last begun decides).
    function arranged(t, w, h) {
      let now = place(0, t, w, h);
      morphs.forEach((m, k) => {
        if (t < m.at) return;
        const from = now;
        const to = place(k + 1, t, w, h);
        const rank = rankFor(`m${k}:${w}x${h}`, m.from, () => place(k, m.at, w, h), w, h, 11 + k);
        now = to.map((b, i) => {
          const a = from[i];
          const e = easeInOut(through(t, m, rank[i]));
          return { x: mix(a.x, b.x, e), y: mix(a.y, b.y, e), r: turnMix(a.r, b.r, e), s: mix(a.s, b.s, e), blur: mix(a.blur, b.blur, e), fade: mix(a.fade, b.fade, e), z: mix(a.z, b.z, e) };
        });
      });
      return now;
    }

    const points = [];

    function draw(t) {
      const w = W();
      const h = H();
      const now = arranged(t, w, h);

      // Where each field's points are now.
      const spots = fields.map((f) => f.points.map((pt) => (typeof pt.follow === "function" ? pt.follow(t) : keyed(pt.keys, t, { x: w / 2, y: h / 2 }))));
      fields.forEach((f, k) => {
        f.rings.forEach((ring, j) => {
          const at = spots[k][j];
          ring.style.transform = `translate(${at.x - f.radius}px, ${at.y - f.radius}px)`;
        });
      });

      const enter = opts.enter;
      const leave = opts.leave;
      const startRank = enter ? rankFor(`enter:${w}x${h}`, enter.from ?? "center", () => place(0, enter.at ?? 0, w, h), w, h, 5) : null;
      const endRank = leave ? rankFor(`leave:${w}x${h}`, leave.from ?? "center", () => arranged(leave.at ?? 0, w, h), w, h, 9) : null;

      cards.forEach((el, i) => {
        const p = now[i];
        let { x, y, r, s, blur, fade } = p;
        let nearest = 0;
        fields.forEach((f, k) => {
          // The field's closest point to this card decides.
          let pt = null;
          let d = 0;
          for (const at of spots[k]) {
            const dd = Math.hypot(x - at.x, y - at.y);
            if (pt === null || dd < d) {
              pt = at;
              d = dd;
            }
          }
          if (!pt) return;
          const near = f.falloff(clamp(1 - d / f.radius)); // 1 at the point, 0 at its reach
          if (f.scale) s *= mix(f.scale[1], f.scale[0], near);
          if (f.fade) fade *= mix(f.fade[1], f.fade[0], near);
          if (f.blur) blur += f.blur * near;
          if (f.push && d > 0.01) {
            x += ((x - pt.x) / d) * f.push * near;
            y += ((y - pt.y) / d) * f.push * near;
          }
          // The card's top turns to the point: up is -90 degrees, so add 90.
          if (f.aim) r = turnMix(r, deg(Math.atan2(pt.y - y, pt.x - x)) + 90, f.aim === "near" ? near : 1);
          if (f.colorFar && f.color.near) el.style[f.colorProp] = mixColor(f.colorFar, f.color.near, near);
          if (f.variable) el.style.setProperty(f.variable, near.toFixed(3));
          if (typeof f.apply === "function") f.apply(el, near, i);
          nearest = Math.max(nearest, near);
        });
        let swell = 0;
        for (const v of waves) {
          if (t < v.at) continue;
          const d = Math.hypot(x - (v.x ?? w / 2), y - (v.y ?? h / 2));
          const crest = Math.exp(-(((d - v.speed * (t - v.at)) / v.width) ** 2));
          if (crest < 0.002) continue;
          s *= 1 + (v.scale - 1) * crest;
          y -= v.lift * crest;
          swell = Math.max(swell, crest);
        }
        if (waves.length) el.style.setProperty("--wave", swell.toFixed(3));
        if (enter) {
          const e = easeOut(through(t, { at: enter.at ?? 0, duration: enter.duration ?? 0.8, stagger: enter.stagger ?? 0.4 }, startRank[i]));
          s *= e;
          fade *= clamp(e * 1.4);
        }
        if (leave) {
          const e = easeInOut(through(t, { at: leave.at ?? 0, duration: leave.duration ?? 0.6, stagger: leave.stagger ?? 0.4 }, endRank[i]));
          s *= 1 - e;
          fade *= 1 - e;
        }
        el.style.zIndex = String(1000 + Math.round(nearest * 500) + Math.round(p.z * 100));
        el.style.transform = `translate(${x - card / 2}px, ${y - card / 2}px) rotate(${r}deg) scale(${Math.max(0, s)})`;
        el.style.opacity = String(clamp(fade));
        el.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "";
        points[i] = { x, y, scale: s };
      });

      const cam = opts.camera ? keyed(opts.camera, t, { zoom: 1, x: 0, y: 0, turn: 0 }) : null;
      stage.style.transform = cam ? `translate(${cam.x}px, ${cam.y}px) rotate(${cam.turn}deg) scale(${cam.zoom})` : "";
    }

    draw(0);
    return { draw, cards, points };
  }

  window.gridField = gridField;
})();
