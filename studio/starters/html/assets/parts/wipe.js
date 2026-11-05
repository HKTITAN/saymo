// Wipe: shows a picture, a panel or a whole scene with a moving edge, led
// if you like by a band of colour, or opens it as a growing circle; and
// wipes it away again. Inspired by After Effects SaaS wipe transitions: the
// idea, rebuilt here from scratch for the studio.
//
// It draws from the film's clock, never on its own:
//
//   const shot = wipeReveal(document.getElementById("shot"), { at: 1, from: "left", band: true });
//   filmTimeline(sequence, { duration: FILM.duration, parts: [shot] });
//
// Load it after timeline.js: <script src="assets/parts/wipe.js"></script>
// The element stays where it is; the wipe only decides how much of it shows.
//
//   at        when it starts (s, default 0); duration (s, default 0.9)
//   from      the side the edge comes from: "left" (default), "right",
//             "top", "bottom", "middle" (opens out from a centre line) or
//             "circle" (a circle growing from origin)
//   origin    circle: where it grows from, { x, y } as shares of the
//             element (default the middle, { x: 0.5, y: 0.5 })
//   angle     degrees the edge leans (default 0; 10 to 20 reads as fast)
//   band      true or { color, width }: a solid band running just ahead of
//             the edge and off the far side; width as a share of the
//             element (default 0.14), colour the brand's accent
//   style     "edge" (default: a clean edge), "soft" (a gradient wipe: the
//             edge feathered over softness, a share of the element, default
//             0.25; no band) or "glitch" (the edge breaks into jittering
//             slices with a colour split; strips default 14)
//   strips    the wipe in this many strips, each a little behind the one
//             before (default 1); lag: seconds between strips (default 0.06,
//             glitch 0)
//   ease      "inOut" (default), "out" or "linear"
//   leave     { at, duration, reverse }: wipes it away, carrying on in the
//             same direction (reverse: true goes back the way it came; a
//             circle then closes)
//
// The returned part has draw(t) and end (when it's fully shown, s).
(function () {
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

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
  const EASE = { inOut: bezier(0.76, 0, 0.24, 1), out: bezier(0.16, 1, 0.3, 1), linear: (p) => p };
  // The gradient angle that runs from each side across (CSS: 90deg runs left to right).
  const SIDES = { left: 90, right: 270, top: 180, bottom: 0, middle: 90 };
  const f = (v) => v.toFixed(3);
  // A small hash for the glitch: the same jitter at the same moment, every render.
  const hash = (n) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };

  function wipeReveal(el, opts = {}) {
    const roles = window.__brand?.colors?.roles ?? {};
    const at = opts.at ?? 0;
    const duration = Math.max(0.01, opts.duration ?? 0.9);
    const from = opts.from ?? "left";
    const ease = EASE[opts.ease] ?? EASE.inOut;
    const style = opts.style ?? "edge";
    const glitch = style === "glitch";
    const soft = style === "soft" ? clamp(opts.softness ?? 0.25, 0.01, 1) * 100 : 0;
    const band = opts.band && !soft ? { color: opts.band.color ?? roles.accent ?? "#3d63ff", width: opts.band.width ?? 0.14 } : null;
    const bw = band ? band.width : 0;
    const strips = Math.max(1, Math.round(opts.strips ?? (glitch ? 14 : 1)));
    const lag = opts.lag ?? (glitch ? 0 : 0.06);
    // What the element had of its own, given back whenever the glitch is still.
    const own = { filter: el.style.filter ?? "", translate: el.style.translate ?? "" };
    const calm = () => {
      if (!glitch) return;
      el.style.filter = own.filter;
      el.style.translate = own.translate;
    };
    const leave = opts.leave ? { at: opts.leave.at ?? 0, duration: Math.max(0.01, opts.leave.duration ?? duration), reverse: Boolean(opts.leave.reverse) } : null;
    const circle = from === "circle";
    const middle = from === "middle";
    const angle = (SIDES[from] ?? 90) + (opts.angle ?? 0);
    const rows = from !== "top" && from !== "bottom";

    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    let cover = null;
    if (band) {
      cover = document.createElement("div");
      cover.className = "wipe-band";
      Object.assign(cover.style, { position: "absolute", inset: "0", borderRadius: "inherit", pointerEvents: "none", zIndex: "2147483000", backgroundRepeat: "no-repeat" });
      el.appendChild(cover);
    }

    // Each strip's slot; a pixel of overlap so no hairline shows between strips.
    const slot = (k) => {
      if (strips === 1) return { size: "100% 100%", position: "0 0" };
      const share = 100 / strips;
      const pos = (k * 100) / (strips - 1);
      return rows ? { size: `100% calc(${f(share)}% + 1px)`, position: `0 ${f(pos)}%` } : { size: `calc(${f(share)}% + 1px) 100%`, position: `${f(pos)}% 0` };
    };

    function mask(layers) {
      const s = el.style;
      const image = layers ? layers.map((l) => l.image).join(", ") : "";
      const size = layers ? layers.map((l) => l.size).join(", ") : "";
      const position = layers ? layers.map((l) => l.position).join(", ") : "";
      s.maskImage = s.webkitMaskImage = image;
      s.maskSize = s.webkitMaskSize = size;
      s.maskPosition = s.webkitMaskPosition = position;
      s.maskRepeat = s.webkitMaskRepeat = layers ? "no-repeat" : "";
    }
    function paintBand(layers) {
      if (!cover) return;
      cover.style.backgroundImage = layers?.length ? layers.map((l) => l.image).join(", ") : "";
      cover.style.backgroundSize = layers?.length ? layers.map((l) => l.size).join(", ") : "";
      cover.style.backgroundPosition = layers?.length ? layers.map((l) => l.position).join(", ") : "";
    }
    const stripe = (deg, a, b) => `linear-gradient(${deg}deg, transparent ${f(a)}%, ${band.color} ${f(a)}%, ${band.color} ${f(b)}%, transparent ${f(b)}%)`;

    function drawCircle(e, leaving) {
      const w = el.offsetWidth || 1920;
      const h = el.offsetHeight || 1080;
      const ox = opts.origin?.x ?? 0.5;
      const oy = opts.origin?.y ?? 0.5;
      const where = `at ${f(ox * 100)}% ${f(oy * 100)}%`;
      const R = Math.hypot(Math.max(ox, 1 - ox) * w, Math.max(oy, 1 - oy) * h);
      const bp = bw * R;
      const ring = (a, b) => (band ? [{ image: `radial-gradient(circle ${where}, transparent ${f(a)}px, ${band.color} ${f(a)}px, ${band.color} ${f(b)}px, transparent ${f(b)}px)`, size: "100% 100%", position: "0 0" }] : null);
      if (soft) {
        // A soft edge: the circle's rim feathered over softness of its radius.
        const sp = (soft / 100) * R;
        const L = (leaving ? e : e) * (R + sp);
        el.style.clipPath = "";
        mask([{ image: leaving && !leave.reverse ? `radial-gradient(circle ${where}, transparent ${f(L - sp)}px, #000 ${f(L)}px)` : `radial-gradient(circle ${where}, #000 ${f((leaving ? (1 - e) * (R + sp) : L) - sp)}px, transparent ${f(leaving ? (1 - e) * (R + sp) : L)}px)`, size: "100% 100%", position: "0 0" }]);
        paintBand(null);
      } else if (leaving && leave.reverse) {
        const S = (1 - e) * (R + bp);
        el.style.clipPath = `circle(${f(S)}px ${where})`;
        mask(null);
        paintBand(ring(Math.max(0, S - bp), S));
      } else if (leaving) {
        const L = e * (R + bp);
        const T = Math.max(0, L - bp);
        el.style.clipPath = "";
        mask([{ image: `radial-gradient(circle ${where}, transparent ${f(T)}px, #000 ${f(T)}px)`, size: "100% 100%", position: "0 0" }]);
        paintBand(ring(T, L));
      } else {
        const L = e * (R + bp);
        el.style.clipPath = `circle(${f(L)}px ${where})`;
        mask(null);
        paintBand(ring(Math.max(0, L - bp), L));
      }
    }

    function draw(t) {
      const ks = Array.from({ length: strips }, (_, k) => k);
      const enterQ = (k) => clamp((t - at - k * lag) / duration);
      const leaveQ = (k) => (leave ? clamp((t - leave.at - k * lag) / leave.duration) : 0);
      const leaving = Boolean(leave) && t >= leave.at;

      // Fully shown: nothing on it at all.
      if (!leaving && ks.every((k) => enterQ(k) >= 1)) {
        el.style.clipPath = "";
        mask(null);
        paintBand(null);
        calm();
        return;
      }
      // Fully hidden (not begun, or wiped away): clipped to nothing, which the layout checker reads as hidden.
      if ((!leaving && ks.every((k) => enterQ(k) <= 0)) || (leaving && ks.every((k) => leaveQ(k) >= 1))) {
        el.style.clipPath = "inset(50%)";
        mask(null);
        paintBand(null);
        calm();
        return;
      }
      if (circle) return drawCircle(ease(leaving ? leaveQ(0) : enterQ(0)), leaving);

      const shows = [];
      const bands = [];
      const deg = leaving && leave.reverse ? angle + 180 : angle;
      const B = bw * 100;
      const frame = Math.floor(t * 24);
      for (const k of ks) {
        const s = slot(k);
        let e = ease(leaving ? leaveQ(k) : enterQ(k));
        // Glitch: each slice runs a little ahead or behind, re-rolled 24 times a second, most in the middle of the move.
        if (glitch) e = clamp(e + (hash(k * 31 + frame) - 0.5) * 0.5 * Math.sin(Math.PI * e));
        if (middle) {
          const lead = e * (50 + B + soft);
          const trail = Math.max(0, lead - B);
          if (!leaving) {
            shows.push({ image: `linear-gradient(${deg}deg, transparent ${f(50 - lead)}%, #000 ${f(50 - lead + soft)}%, #000 ${f(50 + lead - soft)}%, transparent ${f(50 + lead)}%)`, ...s });
          } else {
            shows.push({ image: `linear-gradient(${deg}deg, #000 ${f(50 - trail - soft)}%, transparent ${f(50 - trail)}%, transparent ${f(50 + trail)}%, #000 ${f(50 + trail + soft)}%)`, ...s });
          }
          if (band) bands.push({ image: stripe(deg, 50 - lead, 50 - trail), ...s }, { image: stripe(deg, 50 + trail, 50 + lead), ...s });
          continue;
        }
        const lead = e * (100 + B + soft);
        const trail = lead - B;
        shows.push({ image: leaving ? `linear-gradient(${deg}deg, transparent ${f(trail - soft)}%, #000 ${f(trail)}%)` : `linear-gradient(${deg}deg, #000 ${f(lead - soft)}%, transparent ${f(lead)}%)`, ...s });
        if (band) bands.push({ image: stripe(deg, trail, lead), ...s });
      }
      el.style.clipPath = "";
      mask(shows);
      paintBand(bands);
      if (glitch) {
        // A colour split and a shake, strongest mid-move.
        const amp = Math.sin(Math.PI * clamp(leaving ? leaveQ(0) : enterQ(0)));
        const a = (2 + 6 * hash(frame * 3 + 1)) * amp * (hash(frame * 13 + 7) > 0.5 ? 1 : -1);
        el.style.filter = `${own.filter} drop-shadow(${f(a)}px 0 0 rgba(255, 0, 90, 0.55)) drop-shadow(${f(-a)}px 0 0 rgba(0, 210, 255, 0.55))`.trim();
        el.style.translate = `${f((hash(frame * 7 + 3) - 0.5) * 16 * amp)}px 0px`;
      }
    }

    draw(0);
    return { draw, end: at + duration + (strips - 1) * lag };
  }

  window.wipeReveal = wipeReveal;
})();
