// Liquid glass: a lens of clear glass that bends whatever is behind it
// toward its rounded edges, with a little colour split at the rim and a
// painted line of light, the way Apple's iOS 26 glass does. It can glide
// over the film, and its bend and light come up as it arrives.
//
// Made here from scratch, after the methods glisse (Kelvin Zhang, MIT,
// github.com/0kzh/glisse) and Kube's article (kube.io/blog/liquid-glass-
// css-svg) write down: the backdrop bent by an SVG displacement, one grey
// map per direction (so a wide-gamut screen's colour conversion can't turn
// a straight pull sideways), red reaching a little further than blue, and a
// rim painted brightest at the very edge, lit along the top and left with a
// reflection along the bottom and right.
//
// It draws from the film's clock, never on its own:
//
//   const lens = liquidGlass(document.getElementById("pill"), { at: 0.4, keys: [{ at: 1, x: 0 }, { at: 3, x: 600 }] });
//   filmTimeline(sequence, { duration: FILM.duration, parts: [lens] });
//
// Load it after timeline.js: <script src="assets/parts/liquid.js"></script>
// The bending is real refraction of the page behind the element, which
// Chromium draws (the studio's preview and renderer are Chromium); other
// browsers show frosted glass instead. Put it over something with edges
// and colour to bend (type, stripes, a picture): over a flat colour it's
// invisible. Give the element its size and corner radius; its own content
// stays sharp on top.
//
//   at          when it arrives (s, default 0); duration (s, default 0.8)
//   depth       how far the rim pulls things in, px (default 40% of the
//               short side)
//   bevel       how wide the bending rim is, as a share of the short side
//               (default 0.25)
//   dispersion  0 to 1: how far red outreaches blue at the rim (default 0.4)
//   blur        a little frost, px (default 1.5)
//   tint        the glass's colour (default white at 6%)
//   light       the rim's light, 0 to 1 (default 0.6)
//   keys        [{ at, x, y, scale }]: where it is (px from where it sits)
//               and its size, eased between keys
//   leave       { at, duration }: the bend and light go, then the glass
//
// The returned part has draw(t).
(function () {
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const mix = (a, b, k) => a + (b - a) * k;
  const easeOut = (p) => (p >= 1 ? 1 : 1 - (1 - p) ** 3);
  const easeIn = (p) => p * p * p;
  const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
  const f = (v) => v.toFixed(3);
  let made = 0;

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

  // A rounded rectangle, w by h with corner r: how far inside its edge a
  // point is, and the way out from there.
  function edgeOf(px, py, hx, hy, r) {
    const qx = Math.abs(px) - (hx - r);
    const qy = Math.abs(py) - (hy - r);
    const inside = -(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r);
    let nx = 0;
    let ny = 0;
    if (qx > 0 && qy > 0) {
      const l = Math.hypot(qx, qy) || 1;
      nx = (qx / l) * Math.sign(px);
      ny = (qy / l) * Math.sign(py);
    } else if (qx > qy) nx = Math.sign(px);
    else ny = Math.sign(py);
    return { inside, nx, ny };
  }

  const canvasOf = (w, h) => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext?.("2d");
    if (!ctx) return null;
    canvas.width = w;
    canvas.height = h;
    return { canvas, ctx, img: ctx.createImageData(w, h) };
  };

  // The bend, as two grey images, one per direction: grey above or below
  // the middle says how far each pixel near the rim looks inward, along a
  // shallow dome; alpha at a half means "no pull" for the other direction.
  function bendMaps(w, h, radius, bevel) {
    const across = canvasOf(w, h);
    const down = canvasOf(w, h);
    if (!across || !down) return null;
    const hx = w / 2;
    const hy = h / 2;
    const r = Math.min(radius, hx, hy);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const e = edgeOf(x + 0.5 - hx, y + 0.5 - hy, hx, hy, r);
        const k = e.inside < 0 || e.inside >= bevel ? 0 : (1 - e.inside / bevel) ** 2;
        const i = (y * w + x) * 4;
        const gx = Math.round(128 - e.nx * k * 127);
        const gy = Math.round(128 - e.ny * k * 127);
        across.img.data.set([gx, gx, gx, 128], i);
        down.img.data.set([gy, gy, gy, 128], i);
      }
    }
    across.ctx.putImageData(across.img, 0, 0);
    down.ctx.putImageData(down.img, 0, 0);
    return { across: across.canvas.toDataURL(), down: down.canvas.toDataURL() };
  }

  // The rim: a line brightest at the very edge and gone about 1.2 px in,
  // lit along the top and left, with a fainter reflection along the bottom
  // and right, fading out at the other two corners. Drawn at twice the size.
  function rimImage(w, h, radius) {
    const s = 2;
    const c = canvasOf(w * s, h * s);
    if (!c) return null;
    const hx = (w * s) / 2;
    const hy = (h * s) / 2;
    const r = Math.min(radius * s, hx, hy);
    const lx = -0.6;
    const ly = -0.8;
    for (let y = 0; y < h * s; y++) {
      for (let x = 0; x < w * s; x++) {
        const e = edgeOf(x + 0.5 - hx, y + 0.5 - hy, hx, hy, r);
        const d = e.inside / s;
        if (d < 0 || d > 1.6) continue;
        const near = Math.max(0, 1 - d / 1.22) ** 1.5;
        const facing = e.nx * lx + e.ny * ly;
        const lit = Math.max(Math.max(0, facing), Math.max(0, -facing) * 0.55);
        c.img.data.set([255, 255, 255, Math.round(255 * near * lit)], (y * w * s + x) * 4);
      }
    }
    c.ctx.putImageData(c.img, 0, 0);
    return c.canvas.toDataURL();
  }

  // One colour's bend: across, then down, then just that colour kept.
  const KEEP = { R: "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0", G: "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0", B: "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" };
  const pass = (c) =>
    `<feDisplacementMap in="SourceGraphic" in2="across" scale="0" xChannelSelector="R" yChannelSelector="A" result="${c}x"/>` +
    `<feDisplacementMap in="${c}x" in2="down" scale="0" xChannelSelector="A" yChannelSelector="R" result="${c}xy"/>` +
    `<feColorMatrix in="${c}xy" type="matrix" values="${KEEP[c]}" result="${c}"/>`;

  function liquidGlass(el, opts = {}) {
    const at = opts.at ?? 0;
    const duration = Math.max(0.01, opts.duration ?? 0.8);
    const blur = opts.blur ?? 1.5;
    const light = clamp(opts.light ?? 0.6);
    const dispersion = clamp(opts.dispersion ?? 0.4);
    const leave = opts.leave ? { at: opts.leave.at ?? 0, duration: Math.max(0.01, opts.leave.duration ?? 0.6) } : null;
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    el.style.isolation = "isolate";
    el.style.background = opts.tint ?? "rgba(255, 255, 255, 0.06)";

    // The filter and the rim, made once for the element's size.
    const w = Math.max(1, Math.round(el.offsetWidth || 0));
    const h = Math.max(1, Math.round(el.offsetHeight || 0));
    const short = Math.min(w, h);
    const depth = opts.depth ?? short * 0.4;
    const radius = Number.parseFloat(getComputedStyle(el).borderTopLeftRadius ?? "0") || short / 2;
    const maps = w > 1 && h > 1 ? bendMaps(w, h, radius, (opts.bevel ?? 0.25) * short) : null;
    const rim = w > 1 && h > 1 ? rimImage(w, h, radius) : null;
    let id = null;
    let bends = [];
    if (maps) {
      id = `liquid-glass-${++made}`;
      const NS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("width", "0");
      svg.setAttribute("height", "0");
      svg.style.position = "absolute";
      svg.innerHTML =
        `<filter id="${id}" x="0" y="0" width="${w}" height="${h}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">` +
        `<feImage href="${maps.across}" x="0" y="0" width="${w}" height="${h}" result="across"/>` +
        `<feImage href="${maps.down}" x="0" y="0" width="${w}" height="${h}" result="down"/>` +
        pass("R") +
        pass("G") +
        pass("B") +
        `<feComposite in="R" in2="G" operator="arithmetic" k2="1" k3="1" result="RG"/>` +
        `<feComposite in="RG" in2="B" operator="arithmetic" k2="1" k3="1"/>` +
        `</filter>`;
      document.body.appendChild(svg);
      // Each colour's two passes, with how much further than blue it reaches.
      bends = [...(svg.querySelectorAll?.("feDisplacementMap") ?? [])].map((node, i) => ({ node, reach: [1 + 0.2 * dispersion, 1 + 0.1 * dispersion, 1][Math.floor(i / 2)] }));
    }
    let shine = null;
    if (rim) {
      shine = document.createElement("div");
      shine.className = "liquid-rim";
      Object.assign(shine.style, { position: "absolute", inset: "0", borderRadius: "inherit", pointerEvents: "none", backgroundImage: `url("${rim}")`, backgroundSize: "100% 100%", opacity: "0" });
      el.appendChild(shine);
    }

    function draw(t) {
      const k = easeOut(clamp((t - at) / duration)) * (leave ? 1 - easeIn(clamp((t - leave.at) / leave.duration)) : 1);
      for (const b of bends) b.node.setAttribute("scale", f(depth * b.reach * k));
      const bend = id ? `url(#${id}) ` : "";
      el.style.backdropFilter = el.style.webkitBackdropFilter = k > 0.001 ? `${bend}blur(${f(blur * k)}px) saturate(${f(1 + 0.4 * k)})` : "";
      const l = light * k;
      if (shine) {
        shine.style.opacity = f(l);
        el.style.boxShadow = k > 0.001 ? `0 8px 24px rgba(0, 0, 0, ${f(0.18 * k)})` : "";
      } else {
        // Where there's nothing to paint the rim with, a plain one.
        el.style.boxShadow = l > 0.001 ? `inset 0 1px 1px rgba(255, 255, 255, ${f(0.7 * l)}), inset 0 -1px 1px rgba(255, 255, 255, ${f(0.3 * l)}), 0 8px 24px rgba(0, 0, 0, ${f(0.18 * k)})` : "";
      }
      el.style.opacity = f(clamp(k * 1.5));
      const m = keyed(opts.keys, t, { x: 0, y: 0, scale: 1 });
      el.style.translate = `${f(m.x)}px ${f(m.y)}px`;
      el.style.scale = f(m.scale);
    }

    draw(0);
    return { draw };
  }

  window.liquidGlass = liquidGlass;
})();
