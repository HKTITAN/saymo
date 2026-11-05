// Carousel: cards in a row that move along: stepping one card at a time
// ("slide"), turning like a shelf of records as they pass the middle
// ("coverflow"), or flowing past without end ("marquee"). Inspired by After
// Effects SaaS carousels: the idea, rebuilt here from scratch for the studio.
//
// It draws from the film's clock, never on its own:
//
//   const shelf = carousel(document.getElementById("shelf"), {
//     items: [{ src: "assets/shot-1.png" }, { src: "assets/shot-2.png" }, ...],
//     style: "coverflow",
//     every: 1.2,
//   });
//   filmTimeline(sequence, { duration: FILM.duration, parts: [shelf] });
//
// Load it after timeline.js: <script src="assets/parts/carousel.js"></script>
// The container is a positioned element with a size (position: absolute and
// inset: 0, say). Times are film seconds; sizes px.
//
//   items     the cards: { src } an image, { text }, { html } or { el }, each
//             with an optional `className` and `style`; or a number of plain
//             cards
//   style     "slide" (default), "coverflow" or "marquee"
//   width, height  each card (default 440 by 300)
//   gap       px between cards (default 32)
//   y         the row's middle (default the container's)
//   corner    corner radius, px (default 24)
//   start     the card in the middle at first (default 0)
//   steps     slide, coverflow: [{ at, to, duration }]: bring card `to` to
//             the middle (it counts on past the last card and wraps round);
//             or every: seconds between steps of one card, from `at`
//             (default 0); a step takes duration (default 0.6)
//   speed     marquee: px a second (default 140; negative runs right)
//   focus     slide: { scale, fade } for cards away from the middle
//             (default 0.88 and 0.55)
//   enter     { at, duration }: the row rises in (default: there from 0)
//   cardStyle styles for every card (an object)
//
// The returned part has draw(t), cards and index(t) (the card at the middle
// at time t, a fraction while it moves).
(function () {
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const mix = (a, b, k) => a + (b - a) * k;
  const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
  const easeOut = (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p));
  // Where a card sits from the middle, counted round the shortest way.
  const wrap = (v, n) => ((((v + n / 2) % n) + n) % n) - n / 2;

  function carousel(container, opts = {}) {
    const items = typeof opts.items === "number" ? Array.from({ length: opts.items }, () => ({})) : (opts.items ?? []);
    const n = Math.max(1, items.length);
    const brand = window.__brand;
    const roles = brand?.colors?.roles ?? {};
    const font = (brand?.fonts?.find((f) => f.role === "display") ?? brand?.fonts?.[0])?.family;
    const style = opts.style ?? "slide";
    const width = opts.width ?? 440;
    const height = opts.height ?? 300;
    const pitch = width + (opts.gap ?? 32);
    const focus = { scale: opts.focus?.scale ?? 0.88, fade: opts.focus?.fade ?? 0.55 };
    const at = opts.at ?? 0;
    const stepTime = Math.max(0.05, opts.duration ?? 0.6);
    const steps = (opts.steps ?? []).map((s) => ({ at: s.at ?? 0, to: s.to ?? 0, duration: Math.max(0.05, s.duration ?? stepTime) })).sort((a, b) => a.at - b.at);

    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    const stage = document.createElement("div");
    Object.assign(stage.style, { position: "absolute", inset: "0", isolation: "isolate", perspective: style === "coverflow" ? `${width * 4}px` : "", transformStyle: "preserve-3d" });
    container.appendChild(stage);

    const cards = items.map((item) => {
      const el = item.el ?? document.createElement("div");
      el.classList.add("carousel-card");
      if (item.className) el.classList.add(...String(item.className).split(/\s+/).filter(Boolean));
      Object.assign(el.style, {
        position: "absolute",
        left: "0",
        top: "0",
        width: `${width}px`,
        height: `${height}px`,
        borderRadius: `${opts.corner ?? 24}px`,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: roles.surface ?? "#f2f2f2",
        color: roles.ink ?? "#111111",
        fontFamily: font ? `"${font}", sans-serif` : "inherit",
        fontSize: `${Math.round(height * 0.14)}px`,
        willChange: "transform, opacity",
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
      // Cards pass over each other as they move; the layout checker is told.
      el.setAttribute("data-layout-allow-overlap", "");
      stage.appendChild(el);
      return el;
    });

    // The card at the middle at time t: the start, then each step eased in turn.
    function index(t) {
      const start = opts.start ?? 0;
      if (opts.every) {
        // One card a step, the first at `at`, each taking its duration (at most the gap between steps).
        if (t < at) return start;
        const j = Math.floor((t - at) / opts.every);
        return start + j + easeInOut(clamp((t - at - j * opts.every) / Math.min(stepTime, opts.every)));
      }
      let now = start;
      for (const s of steps) {
        if (t < s.at) break;
        now = mix(now, s.to, easeInOut(clamp((t - s.at) / s.duration)));
      }
      return now;
    }

    function draw(t) {
      const w = container.clientWidth || 1920;
      const h = container.clientHeight || 1080;
      const cy = opts.y ?? h / 2;
      const e = opts.enter ? easeOut(clamp((t - (opts.enter.at ?? 0)) / (opts.enter.duration ?? 0.8))) : 1;
      const lift = (1 - e) * 80;
      const middle = index(t);
      const run = n * pitch; // the whole row, once round
      cards.forEach((el, i) => {
        let x;
        let extra = "";
        let scale = 1;
        let fade = 1;
        let z = 0;
        if (style === "marquee") {
          const speed = opts.speed ?? 140;
          const along = (((i * pitch - speed * (t - at)) % run) + run) % run; // 0 to run
          x = along - pitch / 2;
          if (x > w + pitch / 2) x -= run;
        } else {
          const off = wrap(i - middle, n); // cards from the middle, round the shortest way
          const d = Math.abs(off);
          if (style === "coverflow") {
            // The middle card faces you; the others turn away and stack close.
            const side = Math.sign(off);
            x = w / 2 + side * (Math.min(d, 1) * width * 0.72 + Math.max(d - 1, 0) * width * 0.3);
            extra = ` translateZ(${(-Math.min(d, 1) * width * 0.6).toFixed(2)}px) rotateY(${(-side * Math.min(d, 1) * 52).toFixed(2)}deg)`;
            fade = mix(1, 0.7, clamp(d - 1));
          } else {
            x = w / 2 + off * pitch;
            scale = mix(1, focus.scale, clamp(d));
            fade = mix(1, focus.fade, clamp(d));
          }
          z = Math.round(100 - d * 10);
        }
        el.style.zIndex = String(z);
        el.style.transform = `translate(${(x - width / 2).toFixed(2)}px, ${(cy - height / 2 + lift).toFixed(2)}px)${extra} scale(${scale.toFixed(4)})`;
        el.style.opacity = String(clamp(fade * e));
      });
    }

    draw(0);
    return { draw, cards, index };
  }

  window.carousel = carousel;
})();
