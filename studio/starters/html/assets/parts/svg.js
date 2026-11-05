// SVG draw: an SVG's lines drawing themselves on, one shape after another,
// with its fills fading in as each line closes; and drawing off again.
// Inspired by After Effects SaaS SVG import (shapes you can animate),
// rebuilt for the web, where an SVG is already shapes.
//
// It draws from the film's clock, never on its own:
//
//   const logo = svgDraw("#logo", { at: 0.3, duration: 1.2, stagger: 0.08 });
//   filmTimeline(sequence, { duration: FILM.duration, parts: [logo] });
//
// Load it after timeline.js: <script src="assets/parts/svg.js"></script>
// Put the SVG in the page as markup (not an <img>), so its shapes are there
// to draw.
//
//   svg       an <svg> or a selector; every path, line, polyline, polygon,
//             rect, circle and ellipse in it draws, in the order they come
//   at        when the first shape starts (s, default 0)
//   duration  each shape's line (s, default 1)
//   stagger   seconds between shapes (default 0.06)
//   fill      true (default): fills fade in as each line closes; false
//             leaves them as they are throughout
//   width     the line for shapes that have none of their own (default 2):
//             it draws them on, then fades as their fill arrives
//   leave     { at, duration, stagger }: draws off, last shape first
//
// The returned part has draw(t), shapes and end (when the last shape closes).
(function () {
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
  const f = (v) => v.toFixed(3);
  const SHAPES = "path, line, polyline, polygon, rect, circle, ellipse";

  function svgDraw(svg, opts = {}) {
    const root = typeof svg === "string" ? document.querySelector(svg) : svg;
    if (!root) throw new Error("svgDraw needs an SVG in the page.");
    const at = opts.at ?? 0;
    const duration = Math.max(0.01, opts.duration ?? 1);
    const stagger = opts.stagger ?? 0.06;
    const fills = opts.fill !== false;
    const leave = opts.leave ? { at: opts.leave.at ?? 0, duration: Math.max(0.01, opts.leave.duration ?? 0.6), stagger: opts.leave.stagger ?? stagger * 0.6 } : null;

    const shapes = [...root.querySelectorAll(SHAPES)].map((el) => {
      const look = getComputedStyle(el);
      const stroked = look.stroke && look.stroke !== "none";
      // A shape with no line of its own borrows its fill colour to draw with.
      if (!stroked) {
        el.style.stroke = look.fill && look.fill !== "none" ? look.fill : "currentColor";
        el.style.strokeWidth = String(opts.width ?? 2);
      }
      const length = typeof el.getTotalLength === "function" ? el.getTotalLength() : 0;
      return { el, length: Math.max(1, length), borrowed: !stroked, fillOpacity: Number(look.fillOpacity ?? 1) || 1 };
    });
    const n = shapes.length;

    function draw(t) {
      shapes.forEach((s, i) => {
        const p = easeInOut(clamp((t - at - i * stagger) / duration));
        const q = leave ? easeInOut(clamp((t - leave.at - (n - 1 - i) * leave.stagger) / leave.duration)) : 0;
        const k = p * (1 - q); // how much of the line shows
        s.el.style.strokeDasharray = `${f(s.length)} ${f(s.length)}`;
        s.el.style.strokeDashoffset = f(s.length * (1 - k));
        // The fill arrives over the last part of the line, and goes first on the way out.
        const fill = fills ? clamp((p - 0.6) / 0.4) * (1 - clamp(q / 0.4)) : 1;
        if (fills) s.el.style.fillOpacity = f(fill * s.fillOpacity);
        if (s.borrowed) s.el.style.strokeOpacity = f(fills ? 1 - fill : 1);
      });
    }

    draw(0);
    return { draw, shapes: shapes.map((s) => s.el), end: at + Math.max(0, n - 1) * stagger + duration };
  }

  window.svgDraw = svgDraw;
})();
