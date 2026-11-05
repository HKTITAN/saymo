// Text reveal: type that arrives by line, word or letter: rising from
// behind its own edge, fading up, sharpening out of a blur, flying in from
// all over (and blowing apart again), typed on behind a caret, typed with a
// glow, or flickering through random letters before it lands. Inspired by
// After Effects SaaS text animators: the ideas, rebuilt here from scratch.
//
// It draws from the film's clock, never on its own:
//
//   const title = textReveal(document.getElementById("title"), { by: "words", at: 0.4 });
//   filmTimeline(sequence, { duration: FILM.duration, parts: [title] });
//
// Load it after timeline.js: <script src="assets/parts/reveal.js"></script>
// The element keeps its own font, colour and wrapping, and any markup
// inside it (an accent <span>, an <em>, a <br>) stays where it was.
//
//   effect    "rise" (default: each piece rises from behind its own edge,
//             crisp the whole way), "fade" (fades in, drifting up a
//             little), "blur" (fades in out of a soft blur), "explode"
//             (pieces fly in from all over and settle; leaving, they blow
//             apart), "type" (letters appear one at a time behind a caret,
//             like a typewriter), "colour" (typing whose newest letters
//             glow in a colour, then settle) or "scramble" (each letter
//             flickers through random letters before it lands)
//   by        "lines" (default), "words" or "letters" (type, colour and
//             scramble: always letters; explode by lines moves each line as
//             one piece)
//   at        when it starts (s, default 0)
//   duration  each piece's move (s, default 0.75); scramble: how long each
//             letter flickers (default 0.5)
//   stagger   seconds between pieces (default: lines 0.12, words 0.07,
//             letters 0.03)
//   speed     type: seconds a letter (default 0.05), in a human rhythm: a
//             little uneven, a beat between words, a pause after . , ! ?
//   caret     type: false for none, or { color, blink: false, hold } (hold:
//             seconds it stays once typing ends, default 1.2)
//   tint      colour: the glow (default the brand's accent); settle:
//             seconds a letter takes to lose it (default 0.5)
//   seed      type: another rhythm; explode: another spray (any number)
//   leave     { at, duration, stagger, effect }: out again; rise leaves
//             upward behind the same edge, explode blows apart, type and
//             colour delete from the end, scramble flickers out
//
// The returned part has draw(t), pieces (the elements that move) and end
// (when the last piece lands, s).
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
  const ARRIVE = bezier(0.16, 1, 0.3, 1); // fast, then a long soft landing
  // A small hash for flickering letters: the same letter at the same moment, every render.
  const hash = (n) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const POOLS = [
    [/[A-Z]/, "ABCDEFGHIJKLMNOPQRSTUVWXYZ"],
    [/[a-z]/, "abcdefghijklmnopqrstuvwxyz"],
    [/[0-9]/, "0123456789"],
  ];
  // How far exploded pieces fly (em), and how far they turn (degrees).
  const SPRAY = { letters: [3, 8, 120], words: [2, 5, 40], lines: [1.5, 3, 12] };
  const DEPART = bezier(0.7, 0, 0.84, 0); // eases off, then away

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

  function textReveal(el, opts = {}) {
    const effect = opts.effect ?? "rise";
    const typing = effect === "type" || effect === "colour";
    const scrambling = effect === "scramble";
    const by = typing || scrambling ? "letters" : (opts.by ?? "lines");
    const tint = effect === "colour" ? (opts.tint ?? window.__brand?.colors?.roles?.accent ?? "#3d63ff") : opts.tint;
    const settle = Math.max(0.01, opts.settle ?? 0.5);
    const at = opts.at ?? 0;
    const duration = Math.max(0.01, opts.duration ?? (scrambling ? 0.5 : 0.75));
    const stagger = opts.stagger ?? { lines: 0.12, words: 0.07, letters: 0.03 }[by] ?? 0.07;
    const speed = opts.speed ?? 0.05;
    const leave = opts.leave ? { at: opts.leave.at ?? 0, duration: Math.max(0.01, opts.leave.duration ?? 0.5), stagger: opts.leave.stagger ?? stagger * 0.6, effect: opts.leave.effect ?? effect } : null;
    const clips = !typing && (effect === "rise" || leave?.effect === "rise");

    // ─── Split the text into pieces, leaving any markup in place ───

    const pieces = []; // { mask, piece, word }
    const letters = []; // type: { span, word }
    let words = 0;

    // Each piece sits in a mask a little taller than its line, so rising
    // pieces clip at an edge without cutting accents or descenders.
    const maskStyle = { display: "inline-block", verticalAlign: "top", padding: "0.1em 0.04em 0.16em", margin: "-0.1em -0.04em -0.16em" };
    if (clips) maskStyle.overflow = "hidden";

    function piece(text, word) {
      const mask = document.createElement("span");
      mask.className = "reveal-mask";
      Object.assign(mask.style, maskStyle);
      const inner = document.createElement("span");
      inner.style.display = "inline-block";
      inner.textContent = text;
      mask.appendChild(inner);
      let glyph = null;
      if (scrambling) {
        // The real letter keeps its room, unseen, while a stand-in flickers over it.
        inner.style.position = "relative";
        glyph = document.createElement("span");
        Object.assign(glyph.style, { position: "absolute", left: "0", top: "0", width: "100%", textAlign: "center", webkitTextFillColor: "currentColor", display: "none" });
        inner.appendChild(glyph);
      }
      pieces.push({ mask, piece: inner, word, glyph, char: text });
      return mask;
    }

    function letter(ch, word) {
      const span = document.createElement("span");
      span.textContent = ch;
      span.style.visibility = "hidden";
      letters.push({ span, word });
      return span;
    }

    function wordNode(text) {
      const w = words++;
      if (by !== "letters") return piece(text, w);
      const holder = document.createElement("span");
      Object.assign(holder.style, { display: "inline-block", whiteSpace: "nowrap" });
      for (const ch of [...text]) holder.appendChild(typing ? letter(ch, w) : piece(ch, w));
      return holder;
    }

    function split(node) {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === 3) {
          for (const part of child.data.split(/(\s+)/)) {
            if (!part) continue;
            node.insertBefore(/^\s+$/.test(part) ? document.createTextNode(part) : wordNode(part), child);
          }
          child.remove();
        } else if (child.nodeType === 1) {
          split(child);
        }
      }
    }
    split(el);

    // Lines, read from where the words landed (again once the fonts are in).
    let lineOf = null;
    function measure() {
      lineOf = [];
      let line = -1;
      let top = Number.NEGATIVE_INFINITY;
      for (const p of pieces) {
        const y = p.mask.offsetTop || 0;
        if (y > top + 4) {
          line++;
          top = y;
        }
        lineOf.push(line);
      }
    }
    const rankOf = (i) => (by === "lines" ? lineOf[i] : by === "words" ? pieces[i].word : i);

    const moving = (mask, on) => {
      if (on) mask.setAttribute("data-layout-allow-overlap", "");
      else mask.removeAttribute("data-layout-allow-overlap");
    };

    // Each exploding piece's own direction, distance, turn and size, the same every render.
    const sprays = new Map();
    const sprayOf = (rank) => {
      if (!sprays.has(rank)) {
        const next = seeded((opts.seed ?? 5) * 1000 + rank * 7 + 1);
        const [near, far, turn] = SPRAY[by] ?? SPRAY.words;
        const a = next() * Math.PI * 2;
        const d = near + (far - near) * next();
        sprays.set(rank, { x: Math.cos(a) * d, y: Math.sin(a) * d, r: (next() - 0.5) * 2 * turn, s: 0.6 + 0.7 * next() });
      }
      return sprays.get(rank);
    };

    function paint(inner, kind, e, out, rank) {
      if (kind === "explode") {
        const v = sprayOf(rank);
        const k = 1 - e;
        inner.style.opacity = String(clamp(e * 1.6));
        inner.style.transform = k > 0 ? `translate(${(v.x * k).toFixed(3)}em, ${(v.y * k).toFixed(3)}em) rotate(${(v.r * k).toFixed(2)}deg) scale(${(1 + (v.s - 1) * k).toFixed(3)})` : "";
        inner.style.filter = "";
      } else if (kind === "fade") {
        inner.style.opacity = String(e);
        inner.style.transform = e < 1 ? `translateY(${((1 - e) * (out ? -0.25 : 0.35)).toFixed(4)}em)` : "";
        inner.style.filter = "";
      } else if (kind === "blur") {
        inner.style.opacity = String(e);
        inner.style.transform = "";
        inner.style.filter = e < 1 ? `blur(${((1 - e) * 0.22).toFixed(4)}em)` : "";
      } else {
        inner.style.opacity = "1";
        inner.style.transform = e < 1 ? `translateY(${((1 - e) * (out ? -106 : 106)).toFixed(3)}%)` : "";
        inner.style.filter = "";
      }
    }

    // ─── Typing: when each letter lands and, leaving, when it's deleted ───

    const times = [];
    const gone = [];
    const deleting = speed * 0.45;
    if (typing) {
      const next = seeded(opts.seed ?? 3);
      let clock = at;
      letters.forEach((l, i) => {
        times.push(clock);
        const lastOfWord = letters[i + 1]?.word !== l.word;
        let gap = speed * (0.6 + 0.8 * next());
        if (lastOfWord) gap += speed * 0.9;
        if (lastOfWord && /[.,!?;:]/.test(l.span.textContent)) gap += speed * 4;
        clock += gap;
      });
      letters.forEach((_, i) => gone.push(leave ? leave.at + (letters.length - 1 - i) * deleting : Number.POSITIVE_INFINITY));
    }

    let caret = null;
    if (typing && opts.caret !== false) {
      caret = document.createElement("span");
      caret.className = "reveal-caret";
      Object.assign(caret.style, { display: "inline-block", width: "0.07em", height: "1.02em", marginRight: "-0.07em", verticalAlign: "-0.14em", borderRadius: "0.04em", background: opts.caret?.color ?? tint ?? "currentColor" });
    }
    let caretAfter = -1;

    function type(t) {
      let shown = 0;
      letters.forEach((l, i) => {
        const on = t >= times[i] && t < gone[i];
        l.span.style.visibility = on ? "visible" : "hidden";
        if (on) shown = i + 1;
        if (tint) {
          // The newest letters glow in the tint and settle into the text's own colour.
          const k = on ? 1 - clamp((t - times[i]) / settle) : 0;
          l.span.style.color = k > 0.001 ? `color-mix(in oklab, ${tint} ${(k * 100).toFixed(1)}%, currentColor)` : "";
        }
      });
      if (!caret || !letters.length) return;
      if (shown !== caretAfter) {
        const ref = letters[Math.max(0, shown - 1)].span;
        ref.parentNode.insertBefore(caret, shown > 0 ? ref.nextSibling : ref);
        caretAfter = shown;
      }
      const hold = opts.caret?.hold ?? 1.2;
      const typed = times[times.length - 1];
      const cleared = leave ? leave.at + letters.length * deleting : Number.POSITIVE_INFINITY;
      const busy = (t >= at && t <= typed + 0.08) || (leave && t >= leave.at && t <= cleared);
      const there = (t >= at - 0.6 && t <= typed + hold) || (leave && t >= leave.at - 0.6 && t <= cleared + hold);
      const lit = busy || opts.caret?.blink === false || Math.floor((t - at) * 2) % 2 === 0;
      caret.style.opacity = there && lit ? "1" : "0";
    }

    // ─── Drawing ───

    // Scramble: each letter flickers through random letters of its own kind
    // (capitals, small letters, digits; anything else shows as itself), 18
    // times a second, then lands; leaving, the last letters go first.
    function scramble(t) {
      const n = pieces.length;
      pieces.forEach((p, i) => {
        const start = at + i * stagger;
        const out = leave ? leave.at + (n - 1 - i) * leave.stagger : Number.POSITIVE_INFINITY;
        const pool = POOLS.find(([re]) => re.test(p.char))?.[1] ?? null;
        const hidden = t < start || (leave && t >= out + leave.duration * 0.5);
        const noise = !hidden && pool && (t < start + duration || t >= out);
        p.piece.style.opacity = hidden ? "0" : "1";
        p.piece.style.webkitTextFillColor = noise ? "transparent" : "";
        p.glyph.style.display = noise ? "block" : "none";
        if (noise) p.glyph.textContent = pool[Math.floor(hash(i * 977 + Math.floor(t * 18)) * pool.length)];
        moving(p.mask, hidden || noise);
      });
    }

    let last = null;
    function draw(t) {
      last = t;
      if (typing) return type(t);
      if (scrambling) return scramble(t);
      if (by === "lines" && !lineOf) measure();
      pieces.forEach((p, i) => {
        const rank = rankOf(i);
        const x = leave ? clamp((t - leave.at - rank * leave.stagger) / leave.duration) : 0;
        const e = x > 0 ? 1 - DEPART(x) : ARRIVE(clamp((t - at - rank * stagger) / duration));
        paint(p.piece, x > 0 ? leave.effect : effect, e, x > 0, rank);
        // Settled text is checked for overlaps as usual; a piece on the move, or waiting behind its edge, isn't.
        moving(p.mask, e < 1);
      });
    }

    document.fonts?.addEventListener?.("loadingdone", () => {
      lineOf = null;
      if (last !== null) draw(last);
    });

    draw(0);
    return {
      draw,
      pieces: typing ? letters.map((l) => l.span) : pieces.map((p) => p.piece),
      get end() {
        if (typing) return times.length ? times[times.length - 1] : at;
        if (by === "lines" && !lineOf) measure();
        const most = pieces.reduce((m, _, i) => Math.max(m, rankOf(i)), 0);
        return at + most * stagger + duration;
      },
    };
  }

  window.textReveal = textReveal;
})();
