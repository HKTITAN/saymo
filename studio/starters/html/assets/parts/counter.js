// Counter: a number that rolls or counts to its value, for stats, prices,
// growth and totals ("$48,200 saved", "3.2x faster", "99.9% uptime").
// Inspired by After Effects SaaS counters: the idea, rebuilt here from
// scratch for the studio.
//
// It draws from the film's clock, never on its own:
//
//   const saved = filmCounter(document.getElementById("saved"), {
//     to: 48200, at: 0.8, duration: 1.6,
//     format: { style: "currency", currency: "USD", maximumFractionDigits: 0 },
//   });
//   filmTimeline(sequence, { duration: FILM.duration, parts: [saved] });
//
// Load it after timeline.js: <script src="assets/parts/counter.js"></script>
// The element keeps its own font, size and colour; its contents become the
// number, set in figures of one width so nothing shifts as it changes.
//
//   from, to   the numbers (from: default 0)
//   at         when it starts (s, default 0); duration (s, default 1.4)
//   style      "roll" (default): each digit spins on its own wheel and the
//              wheels land one after another, left to right; new digits
//              open in and lost ones close up; "count": the number counts
//              in place
//   ease       "out" (default: quick, then settling), "inOut" or "linear"
//   format     how it's written, as Intl.NumberFormat options:
//              { style: "currency", currency: "EUR" }, { style: "percent" }
//              (0.25 is 25%), { maximumFractionDigits: 1 } and so on;
//              locale (default "en-US"). Roll writes every value with the
//              same decimals (99.9% then 50.0%), so the wheels line up.
//   prefix, suffix  text before and after: "+", "x", " users"
//   spins      roll: extra turns the last wheel makes (default 2; each
//              wheel to its left one fewer)
//   stagger    roll: seconds between wheels landing (default 0.07)
//   steps      [{ at, to, duration }]: later changes (another rise, a drop),
//              each from where the number stood
//
// The returned part has draw(t) and value(t), the number at time t.
(function () {
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smooth = (p) => p * p * (3 - 2 * p);
  const EASE = {
    out: (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p)),
    inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2),
    linear: (p) => p,
  };
  const CELL = 1.15; // a wheel's digit height, in em
  const DIGIT = /^[0-9]$/;

  function filmCounter(el, opts = {}) {
    const locale = opts.locale ?? "en-US";
    const format = opts.format ?? { maximumFractionDigits: 0 };
    const nf = new Intl.NumberFormat(locale, format);
    const prefix = opts.prefix ?? "";
    const suffix = opts.suffix ?? "";
    const ease = EASE[opts.ease] ?? EASE.out;
    const spins = opts.spins ?? 2;
    const stagger = opts.stagger ?? 0.07;
    const roll = (opts.style ?? "roll") === "roll";

    const steps = [{ at: opts.at ?? 0, duration: opts.duration ?? 1.4, to: opts.to ?? 0 }, ...(opts.steps ?? []).map((s) => ({ at: s.at ?? 0, duration: s.duration ?? 1, to: s.to ?? 0 }))].sort((a, b) => a.at - b.at);
    steps.forEach((s, i) => {
      s.duration = Math.max(0.05, s.duration);
      s.from = i === 0 ? (opts.from ?? 0) : steps[i - 1].to;
    });

    function value(t) {
      let v = steps[0].from;
      for (const s of steps) {
        if (t < s.at) break;
        v += (s.to - v) * ease(clamp((t - s.at) / s.duration));
      }
      return v;
    }

    el.style.fontVariantNumeric = "tabular-nums";
    el.style.whiteSpace = "nowrap";

    if (!roll) {
      let written = null;
      const draw = (t) => {
        const text = prefix + nf.format(value(t)) + suffix;
        if (text !== written) el.textContent = written = text;
      };
      draw(0);
      return { draw, value };
    }

    // ─── Roll: the number as wheels, built for each step ───

    // Every value written with the same decimals, so wheels line up from step to step.
    const fractionOf = (v) => nf.formatToParts(v).filter((p) => p.type === "fraction").reduce((n, p) => n + p.value.length, 0);
    const decimals = Math.max(...[steps[0].from, ...steps.map((s) => s.to)].map(fractionOf));
    let fixed = nf;
    try {
      fixed = new Intl.NumberFormat(locale, { ...format, minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    } catch {
      // Options that can't take fixed decimals keep the format as given.
    }
    const chars = (v) => fixed.formatToParts(v).flatMap((p) => [...p.value].map((ch) => ({ ch, digit: (p.type === "integer" || p.type === "fraction") && DIGIT.test(ch) })));

    // A plan per step: the end's characters, each digit a wheel. Wheels
    // with no digit at the start are "new" (they open in); digits the start
    // has beyond the end's are "lost" (they close up), so the number on
    // screen when a step begins is exactly where the last one left it.
    const plans = steps.map((s) => {
      const A = chars(s.from);
      const B = chars(s.to);
      const a = A.filter((c) => c.digit).map((c) => Number(c.ch));
      const b = B.filter((c) => c.digit).map((c) => Number(c.ch));
      const up = s.to >= s.from;
      const lost = [];
      if (a.length > b.length) {
        let seen = 0;
        for (let i = A.findIndex((c) => c.digit); i < A.length; i++) {
          if (A[i].digit) {
            if (seen === a.length - b.length) break;
            seen++;
          }
          lost.push(A[i]);
        }
      }
      const from = b.map((_, j) => a[a.length - (b.length - j)]);
      const firstChange = b.findIndex((d, j) => from[j] === undefined || from[j] !== d);
      const lands = (j) => Math.max(0.1, s.duration - (b.length - 1 - j) * stagger);
      const wheels = b.map((d, j) => {
        const start = from[j] ?? 0;
        const turns = firstChange >= 0 && j >= firstChange ? Math.max(0, spins - (b.length - 1 - j)) : 0;
        const extra = turns + (up ? (d < start ? 1 : 0) : d > start ? 1 : 0);
        const stop = d === start && turns === 0 ? d : up ? d + 10 * extra : d - 10 * extra;
        return { start, stop, kind: from[j] === undefined ? "new" : "kept", lands: lands(j) };
      });
      const items = [];
      let w = 0;
      B.forEach((c, i) => {
        if (c.digit && w === 0) for (const l of lost) items.push(l.digit ? { wheel: { start: Number(l.ch), stop: Number(l.ch), kind: "lost", lands: lands(0) } } : { text: l.ch });
        if (c.digit) items.push({ wheel: wheels[w++] });
        else items.push({ text: c.ch });
        if (i === B.length - 1 && w === 0) for (const l of lost) items.push(l.digit ? { wheel: { start: Number(l.ch), stop: Number(l.ch), kind: "lost", lands: lands(0) } } : { text: l.ch });
      });
      return { step: s, items };
    });

    let built = -1;
    let parts = []; // { el, strip?, lo?, wheel?, after }

    function build(i) {
      const kids = [];
      parts = [];
      const box = (text, clip) => {
        const span = document.createElement("span");
        Object.assign(span.style, { display: "inline-block", height: `${CELL}em`, lineHeight: `${CELL}em`, verticalAlign: "top", whiteSpace: "pre" });
        if (clip) span.style.overflow = "hidden";
        span.textContent = text;
        return span;
      };
      if (prefix) kids.push(box(prefix, false));
      let lastWheel = -1;
      for (const item of plans[i].items) {
        if (item.text !== undefined) {
          // A separator opens and closes with the wheel to its left, so "48,200" never starts as ", 0".
          const follows = lastWheel >= 0 ? parts[lastWheel].wheel.kind : "kept";
          const span = box(item.text, follows !== "kept");
          kids.push(span);
          parts.push({ el: span, after: lastWheel });
          continue;
        }
        const wheel = item.wheel;
        const lo = Math.min(wheel.start, wheel.stop);
        const hi = Math.max(wheel.start, wheel.stop);
        const outer = box("", true);
        // The wheel's spare digits sit above and below it, hidden by its edge; the checker can't see that.
        outer.setAttribute("data-layout-allow-overlap", "");
        outer.style.maskImage = outer.style.webkitMaskImage = "linear-gradient(transparent, #000 10%, #000 90%, transparent)";
        const strip = document.createElement("span");
        strip.style.display = "block";
        for (let k = lo; k <= hi; k++) {
          const cell = document.createElement("span");
          Object.assign(cell.style, { display: "block", height: `${CELL}em`, lineHeight: `${CELL}em`, textAlign: "center" });
          cell.textContent = String(((k % 10) + 10) % 10);
          strip.appendChild(cell);
        }
        outer.appendChild(strip);
        kids.push(outer);
        lastWheel = parts.length;
        parts.push({ el: outer, strip, lo, wheel, after: -1 });
      }
      if (suffix) kids.push(box(suffix, false));
      el.replaceChildren(...kids);
      built = i;
    }

    // How open a wheel is (0 shut, 1 its full width) and how visible.
    function presence(kind, p) {
      if (kind === "new") return { open: smooth(clamp(p / 0.5)), shown: clamp(p / 0.4) };
      if (kind === "lost") return { open: 1 - smooth(clamp((p - 0.3) / 0.5)), shown: 1 - clamp(p / 0.5) };
      return { open: 1, shown: 1 };
    }
    const place = (el, { open, shown }) => {
      el.style.opacity = String(shown);
      el.style.maxWidth = open < 1 ? `${open.toFixed(4)}em` : "";
    };

    function draw(t) {
      let i = -1;
      steps.forEach((s, k) => {
        if (t >= s.at) i = k;
      });
      // Before the first step, the first step's wheels wait at their start.
      if (Math.max(0, i) !== built) build(Math.max(0, i));
      const s = plans[built].step;
      const states = parts.map((part) => {
        if (!part.wheel) return null;
        const p = i < 0 ? 0 : ease(clamp((t - s.at) / part.wheel.lands));
        const at = part.wheel.start + (part.wheel.stop - part.wheel.start) * p;
        part.strip.style.transform = `translateY(${(-(at - part.lo) * CELL).toFixed(4)}em)`;
        const state = presence(part.wheel.kind, p);
        place(part.el, state);
        return state;
      });
      parts.forEach((part) => {
        if (!part.wheel) place(part.el, part.after >= 0 ? states[part.after] : { open: 1, shown: 1 });
      });
    }

    draw(0);
    return { draw, value };
  }

  window.filmCounter = filmCounter;
})();
