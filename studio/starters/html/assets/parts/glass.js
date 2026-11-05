// Glass: a panel that turns to frosted glass over whatever is behind it:
// the blur and tint come up as it arrives, with a slow light sweep across
// it if you like. Inspired by After Effects SaaS glass panels: the idea,
// rebuilt here from scratch for the studio.
//
// It draws from the film's clock, never on its own:
//
//   const card = glassPanel(document.getElementById("card"), { at: 0.6 });
//   filmTimeline(sequence, { duration: FILM.duration, parts: [card] });
//
// Load it after timeline.js: <script src="assets/parts/glass.js"></script>
// Put the panel over something worth seeing through (a picture, a gradient,
// moving shapes): glass over a flat colour just looks grey. It keeps the
// panel's own size, corners and content.
//
//   at        when it arrives (s, default 0); duration (s, default 0.8)
//   blur      px of frost (default 24)
//   tint      the glass's own colour (default white at 14%; dark looks:
//             "rgba(20, 20, 24, 0.35)")
//   saturate  how much richer colours behind it get (default 1.6)
//   rise      px it rises as it arrives (default 24; 0 for none)
//   edge      true draws a faint light rim (default off: the studio's looks
//             keep edges unlit)
//   sheen     { at, duration }: one soft band of light crossing it
//   leave     { at, duration }: the glass clears and the panel goes
//
// The returned part has draw(t).
(function () {
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const easeOut = (p) => (p >= 1 ? 1 : 1 - (1 - p) ** 3);
  const easeIn = (p) => p * p * p;
  const f = (v) => v.toFixed(3);

  function glassPanel(el, opts = {}) {
    const at = opts.at ?? 0;
    const duration = Math.max(0.01, opts.duration ?? 0.8);
    const blur = opts.blur ?? 24;
    const tint = opts.tint ?? "rgba(255, 255, 255, 0.14)";
    const saturate = opts.saturate ?? 1.6;
    const rise = opts.rise ?? 24;
    const leave = opts.leave ? { at: opts.leave.at ?? 0, duration: Math.max(0.01, opts.leave.duration ?? 0.6) } : null;

    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    el.style.overflow = "hidden";
    el.style.isolation = "isolate";
    // The tint is its own layer, so it can fade in with the frost.
    const glaze = document.createElement("div");
    glaze.className = "glass-tint";
    Object.assign(glaze.style, { position: "absolute", inset: "0", borderRadius: "inherit", pointerEvents: "none", zIndex: "-1", background: tint });
    if (opts.edge) glaze.style.boxShadow = "inset 0 0 0 1px rgba(255, 255, 255, 0.28)";
    el.insertBefore(glaze, el.firstChild);
    let band = null;
    if (opts.sheen) {
      band = document.createElement("div");
      band.className = "glass-sheen";
      Object.assign(band.style, {
        position: "absolute",
        top: "-50%",
        bottom: "-50%",
        left: "0",
        width: "40%",
        pointerEvents: "none",
        background: "linear-gradient(100deg, transparent, rgba(255, 255, 255, 0.18) 45%, rgba(255, 255, 255, 0.24) 50%, rgba(255, 255, 255, 0.18) 55%, transparent)",
        opacity: "0",
      });
      el.appendChild(band);
    }

    function draw(t) {
      const k = easeOut(clamp((t - at) / duration)) * (leave ? 1 - easeIn(clamp((t - leave.at) / leave.duration)) : 1);
      const frost = `blur(${f(blur * k)}px) saturate(${f(1 + (saturate - 1) * k)})`;
      el.style.backdropFilter = el.style.webkitBackdropFilter = k > 0.001 ? frost : "";
      glaze.style.opacity = f(k);
      el.style.opacity = f(clamp(k * 1.4));
      el.style.translate = rise ? `0px ${f((1 - k) * rise)}px` : "";
      if (band) {
        const s = clamp((t - (opts.sheen.at ?? at + duration)) / (opts.sheen.duration ?? 1.2));
        band.style.opacity = s > 0 && s < 1 ? "1" : "0";
        // From just off the left edge to just off the right.
        band.style.transform = `translateX(${f(-100 + s * 350)}%)`;
      }
    }

    draw(0);
    return { draw };
  }

  window.glassPanel = glassPanel;
})();
