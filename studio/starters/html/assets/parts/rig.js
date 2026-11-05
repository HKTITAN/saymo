// Rig: helpers the moving parts of a film lean on, as After Effects'
// rigging layers do. attachTo keeps one element pinned to another as it
// moves (a label on a card, a badge on a button); adjustment lays a layer
// over everything beneath it that changes how it all looks over time (blur,
// brightness, contrast, saturation, hue, grey), like an adjustment layer;
// solid is a sheet of colour that can fade. (A null, an empty layer things
// hang off, is just an empty element in HTML, so it has no helper.)
// Inspired by After Effects SaaS rigging tools: the ideas, rebuilt here.
//
// Each draws from the film's clock, never on its own:
//
//   const tag = attachTo("#tag", "#card", { anchor: "top right", align: "bottom left", offset: { x: -16, y: 16 } });
//   const grade = adjustment(document.getElementById("root"), { keys: [{ at: 0, blur: 14, saturate: 0 }, { at: 0.8 }] });
//   const flash = solid(document.getElementById("root"), { color: "#ffffff", keys: [{ at: 2, opacity: 0 }, { at: 2.05, opacity: 1 }, { at: 2.4, opacity: 0 }] });
//   filmTimeline(sequence, { duration: FILM.duration, parts: [tag, grade, flash] });
//
// Load it after timeline.js: <script src="assets/parts/rig.js"></script>
//
// attachTo(el, target, opts): el (an element or a selector) follows target
// (the same), whatever moves it; el is placed absolutely in its own parent.
//   anchor   the spot on the target: "center" (default), "top", "bottom",
//            "left", "right", "top left", "top right", "bottom left",
//            "bottom right", or { x, y } as shares of the target (0 to 1)
//   align    the spot on el that sits there (same words; default "center")
//   offset   { x, y } px
//
// adjustment(container, opts): a layer over everything in the container.
//   keys     [{ at, blur (px), brightness, contrast, saturate (1 is as is),
//            hue (degrees), grey (0 to 1) }], eased between, held at the
//            ends; a value a key leaves out is as is
//
// solid(container, opts): a sheet of colour over the container.
//   color    (default the brand's background); keys [{ at, opacity }]
//
// Each returns a part with draw(t), and el (the layer it made or moves).
(function () {
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const mix = (a, b, k) => a + (b - a) * k;
  const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
  const f = (v) => v.toFixed(3);
  const one = (x) => (typeof x === "string" ? document.querySelector(x) : x);

  // Values from keys at time t, eased between them.
  function keyed(keys, t, defaults) {
    const ks = [...(keys ?? [])].sort((p, q) => (p.at ?? 0) - (q.at ?? 0));
    const at = (k) => Object.fromEntries(Object.keys(defaults).map((n) => [n, k[n] ?? defaults[n]]));
    if (!ks.length) return { ...defaults };
    if (t <= (ks[0].at ?? 0)) return at(ks[0]);
    for (let i = 0; i < ks.length - 1; i++) {
      const a = ks[i];
      const b = ks[i + 1];
      if (t <= b.at) {
        const k = easeInOut(clamp((t - a.at) / Math.max(1e-6, b.at - a.at)));
        return Object.fromEntries(Object.keys(defaults).map((n) => [n, mix(a[n] ?? defaults[n], b[n] ?? defaults[n], k)]));
      }
    }
    return at(ks[ks.length - 1]);
  }

  const SPOTS = {
    center: [0.5, 0.5],
    top: [0.5, 0],
    bottom: [0.5, 1],
    left: [0, 0.5],
    right: [1, 0.5],
    "top left": [0, 0],
    "top right": [1, 0],
    "bottom left": [0, 1],
    "bottom right": [1, 1],
  };
  const spotOf = (s) => (s && typeof s === "object" ? [s.x ?? 0.5, s.y ?? 0.5] : (SPOTS[s] ?? SPOTS.center));

  function attachTo(element, target, opts = {}) {
    const el = one(element);
    const to = one(target);
    if (!el || !to) throw new Error("attachTo needs the element and the one it follows.");
    const [ax, ay] = spotOf(opts.anchor);
    const [bx, by] = spotOf(opts.align);
    Object.assign(el.style, { position: "absolute", left: "0", top: "0" });
    function draw() {
      const home = el.offsetParent ?? el.parentElement;
      if (!home) return;
      const base = home.getBoundingClientRect();
      const scale = base.width / (home.offsetWidth || base.width || 1) || 1;
      const r = to.getBoundingClientRect();
      const x = (r.left - base.left + r.width * ax) / scale + (opts.offset?.x ?? 0) - el.offsetWidth * bx;
      const y = (r.top - base.top + r.height * ay) / scale + (opts.offset?.y ?? 0) - el.offsetHeight * by;
      el.style.transform = `translate(${f(x)}px, ${f(y)}px)`;
    }
    draw();
    return { draw, el };
  }

  const AS_IS = { blur: 0, brightness: 1, contrast: 1, saturate: 1, hue: 0, grey: 0 };

  function adjustment(container, opts = {}) {
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    const el = document.createElement("div");
    el.className = "rig-adjustment";
    Object.assign(el.style, { position: "absolute", inset: "0", pointerEvents: "none", zIndex: "2147482000" });
    container.appendChild(el);
    function draw(t) {
      const v = keyed(opts.keys, t, AS_IS);
      const parts = [];
      if (v.blur > 0.01) parts.push(`blur(${f(v.blur)}px)`);
      if (Math.abs(v.brightness - 1) > 0.001) parts.push(`brightness(${f(v.brightness)})`);
      if (Math.abs(v.contrast - 1) > 0.001) parts.push(`contrast(${f(v.contrast)})`);
      if (Math.abs(v.saturate - 1) > 0.001) parts.push(`saturate(${f(v.saturate)})`);
      if (Math.abs(v.hue) > 0.01) parts.push(`hue-rotate(${f(v.hue)}deg)`);
      if (v.grey > 0.001) parts.push(`grayscale(${f(v.grey)})`);
      el.style.backdropFilter = el.style.webkitBackdropFilter = parts.join(" ");
    }
    draw(0);
    return { draw, el };
  }

  function solid(container, opts = {}) {
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    const el = document.createElement("div");
    el.className = "rig-solid";
    Object.assign(el.style, { position: "absolute", inset: "0", pointerEvents: "none", background: opts.color ?? window.__brand?.colors?.roles?.background ?? "#141414" });
    container.appendChild(el);
    function draw(t) {
      el.style.opacity = f(clamp(keyed(opts.keys, t, { opacity: 1 }).opacity));
    }
    draw(0);
    return { draw, el };
  }

  window.attachTo = attachTo;
  window.adjustment = adjustment;
  window.solid = solid;
})();
