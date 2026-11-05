// Stagger: a set of interface pieces (cards, rows, buttons, list items)
// landing one after another: rising, fading, growing or sliding in, with a
// spring's bounce if you like, and leaving the same way. Inspired by After
// Effects SaaS UI stagger and bounce: the ideas, rebuilt here from scratch.
//
// It draws from the film's clock, never on its own:
//
//   const rows = staggerIn(".pricing .row", { at: 0.4, move: "rise", bounce: 0.4 });
//   const badge = bounceIn("#badge", { at: 1.6 });
//   filmTimeline(sequence, { duration: FILM.duration, parts: [rows, badge] });
//
// Load it after timeline.js: <script src="assets/parts/stagger.js"></script>
// It sets each piece's transform, opacity and filter while it moves, and
// gives them back when it lands, so put it on pieces with no transform of
// their own (wrap one that has).
//
//   elements  a selector, a list of elements or one element
//   at        when the first one starts (s, default 0)
//   duration  each one's move (s, default 0.6; with a bounce, 0.9)
//   stagger   seconds between them (default 0.06)
//   order     "start" (default, as listed), "end", "center" (from the
//             middle out), "random", "top" (by height on the page, top
//             first) or "left" (left first)
//   move      "rise" (default: up from 40 px below), "fade", "grow" (from
//             0.8 of its size), "left" or "right" (slides in from that
//             side), or your own { x, y, scale, rotate, blur }: where it
//             starts, in px and degrees; every move fades in too
//   bounce    0 (default) to 1: lands with a spring's overshoot; 1 is a
//             lively boing
//   leave     { at, duration, stagger, order, move }: out the same way
//
// bounceIn(elements, opts) is staggerIn with bounce 1 and "grow".
//
// The returned part has draw(t), elements and end (when the last lands).
(function () {
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const mix = (a, b, k) => a + (b - a) * k;

  // A cubic-bezier easing, as in CSS.
  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;
    const sx = (u) => ((ax * u + bx) * u + cx) * u;
    const sy = (u) => ((ay * u + by) * u + cy) * u;
    return (p) => {
      if (p <= 0) return 0;
      if (p >= 1) return 1;
      let lo = 0;
      let hi = 1;
      let u = p;
      for (let i = 0; i < 40; i++) {
        const x = sx(u);
        if (Math.abs(x - p) < 1e-7) break;
        if (x < p) lo = u;
        else hi = u;
        u = (lo + hi) / 2;
      }
      return sy(u);
    };
  }
  const ARRIVE = bezier(0.16, 1, 0.3, 1);
  const DEPART = bezier(0.7, 0, 0.84, 0);

  // A spring that has settled by the end of its move: the bouncier, the
  // less damped. 0 is no spring at all.
  const springOf = (bounce) => {
    if (bounce <= 0) return ARRIVE;
    const zeta = 1 - 0.75 * clamp(bounce);
    const w = Math.log(200) / zeta;
    const wd = w * Math.sqrt(1 - zeta * zeta);
    return (p) => (p <= 0 ? 0 : p >= 1 ? 1 : 1 - Math.exp(-zeta * w * p) * (Math.cos(wd * p) + ((zeta * w) / wd) * Math.sin(wd * p)));
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

  const MOVES = {
    rise: { y: 40 },
    fade: {},
    grow: { scale: 0.8 },
    left: { x: -80 },
    right: { x: 80 },
  };
  const moveOf = (m) => ({ x: 0, y: 0, scale: 1, rotate: 0, blur: 0, ...(typeof m === "object" && m ? m : (MOVES[m] ?? MOVES.rise)) });

  const listOf = (elements) => {
    if (typeof elements === "string") return [...document.querySelectorAll(elements)];
    if (elements && typeof elements.length === "number" && typeof elements !== "string" && !elements.nodeType) return [...elements];
    return elements ? [elements] : [];
  };

  // Each piece's turn, 0 to n - 1, in the order asked for.
  function ranks(els, order, seed) {
    const n = els.length;
    const index = els.map((_, i) => i);
    if (order === "end") return index.map((i) => n - 1 - i);
    const sortBy = (key) => {
      const sorted = [...index].sort((a, b) => key(a) - key(b) || a - b);
      const out = [];
      sorted.forEach((el, r) => {
        out[el] = r;
      });
      return out;
    };
    if (order === "random") {
      const next = seeded(seed);
      const keys = index.map(() => next());
      return sortBy((i) => keys[i]);
    }
    if (order === "center") return sortBy((i) => Math.abs(i - (n - 1) / 2));
    if (order === "top") return sortBy((i) => els[i].offsetTop ?? 0);
    if (order === "left") return sortBy((i) => els[i].offsetLeft ?? 0);
    return index;
  }

  function staggerIn(elements, opts = {}) {
    const els = listOf(elements);
    const at = opts.at ?? 0;
    const bounce = clamp(opts.bounce ?? 0);
    const duration = Math.max(0.01, opts.duration ?? (bounce > 0 ? 0.9 : 0.6));
    const stagger = opts.stagger ?? 0.06;
    const ease = springOf(bounce);
    const from = moveOf(opts.move);
    const leave = opts.leave
      ? { at: opts.leave.at ?? 0, duration: Math.max(0.01, opts.leave.duration ?? 0.45), stagger: opts.leave.stagger ?? stagger * 0.6, order: opts.leave.order ?? opts.order, to: moveOf(opts.leave.move ?? opts.move) }
      : null;

    // Orders by position need the page laid out, so they're read on the first draw.
    let rankIn = null;
    let rankOut = null;
    // Pieces that move may cross each other; the layout checker is told while they do.
    const marked = new WeakSet();

    function draw(t) {
      rankIn ??= ranks(els, opts.order ?? "start", 3);
      if (leave) rankOut ??= ranks(els, leave.order ?? "start", 7);
      els.forEach((el, i) => {
        const x = leave ? DEPART(clamp((t - leave.at - rankOut[i] * leave.stagger) / leave.duration)) : 0;
        const e = ease(clamp((t - at - rankIn[i] * stagger) / duration));
        const k = x > 0 ? x : 1 - e; // 0: in place; 1: all the way out
        const m = x > 0 ? leave.to : from;
        if (k === 0) {
          el.style.transform = "";
          el.style.opacity = "";
          el.style.filter = "";
        } else {
          el.style.transform = `translate(${(m.x * k).toFixed(2)}px, ${(m.y * k).toFixed(2)}px) rotate(${(m.rotate * k).toFixed(2)}deg) scale(${mix(1, m.scale, k).toFixed(4)})`;
          el.style.opacity = String(clamp(1 - k * 1.6));
          el.style.filter = m.blur ? `blur(${(m.blur * clamp(k)).toFixed(2)}px)` : "";
        }
        const busy = k !== 0;
        if (busy && !el.hasAttribute?.("data-layout-allow-overlap")) {
          el.setAttribute("data-layout-allow-overlap", "");
          marked.add(el);
        } else if (!busy && marked.has(el)) {
          el.removeAttribute("data-layout-allow-overlap");
          marked.delete(el);
        }
      });
    }

    draw(0);
    return { draw, elements: els, end: at + Math.max(0, els.length - 1) * stagger + duration };
  }

  window.staggerIn = staggerIn;
  window.bounceIn = (elements, opts = {}) => staggerIn(elements, { bounce: 1, move: "grow", ...opts });
})();
