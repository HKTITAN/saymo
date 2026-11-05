// Cursor: a teammate's pointer on a shared canvas (or a system pointer, an
// I-beam or a touch dot) that glides between spots in a film on a slight
// arc, with a hand's faint tremor, and clicks, with a ring at each click, a
// name tag that can open into a cursor chat, and hover and press states set
// on what it points at. Inspired by After Effects SaaS cursors: the idea,
// rebuilt here from scratch for the studio. The canvas pointer, its name
// tag and its chat bubble follow Figma's UI3 kit (Figma Community, CC BY
// 4.0), as in the studio's Config India recap film.
//
// It draws from the film's clock, never on its own:
//
//   const cursor = filmCursor(document.getElementById("pointer"), {
//     label: { text: "maya" },
//     color: filmCursor.colors.pink,
//     keys: [
//       { at: 0, x: 2000, y: 1150 },
//       { at: 0.9, x: 1500, y: 860 },
//       { at: 1.8, to: "#upgrade", click: true },
//       { at: 3, to: "#plan-pro" },
//     ],
//     chats: [{ at: 3.2, text: "this one", duration: 1.8 }],
//   });
//   filmTimeline(sequence, { duration: FILM.duration, parts: [cursor] });
//
// Load it after timeline.js: <script src="assets/parts/cursor.js"></script>
// The container covers the frame above everything the cursor points at
// (position: absolute, inset: 0, a high z-index); the cursor never takes
// clicks or changes layout. For several people, make one part each.
//
//   keys      where the cursor is when: { at, x, y } in container px, or
//             { at, to } to point at an element ("#id" or the element
//             itself), at its middle plus dx, dy px. It glides to each key,
//             arriving exactly at `at`, and waits there until it leaves for
//             the next. Before the first key it sits at the first (start
//             one off frame to bring it in). On a key, each optional:
//               click  true: clicks on arriving
//               hold   seconds the button stays down after the click (for
//                      a drag to the next key)
//               look   the pointer from this key on: "canvas", "arrow",
//                      "text" or "touch"
//   look      "canvas" (default: the kit's multiplayer pointer, a dart in
//             the person's colour on a white rim), "arrow" (the system
//             pointer, near-black), "text" (an I-beam, over fields) or
//             "touch" (a soft dot, for phones)
//   color     the person's colour, for the canvas pointer, its name tag and
//             its chat (default the brand's accent). filmCursor.colors has
//             the kit's seven: purple, pink, green, blue, red, orange, yellow
//   label     a name tag beside it: { text, textColor } (text default white,
//             or near-black on a light colour such as yellow)
//   chats     [{ at, text, duration }]: the name tag opens into a chat
//             bubble and the words type themselves out (duration default 2 s)
//   scale     1 is the kit's size on a 1280 by 720 frame (default: fitted
//             to the frame, so 1.5 at 1080p)
//   shadow    the kit's soft shadows (default on for the canvas pointer,
//             off for the others, as the house looks are flat)
//   drift     px of the hand's faint tremor at scale 1 (default 1.4; 0
//             holds it dead still); seed: another tremor (any number)
//   glide     the longest a move takes, seconds (default 0.55); keys closer
//             together glide faster
//   arc       how much moves bow: 0 is a ruler line (default 1)
//   ring      the ring at a click: { color, size } (default the brand's
//             ink, 20 px out at scale 1)
//   appear    when it fades in (default: there from the start); vanish:
//             when it fades out
//
// An element it points at (a key with `to`) gets data-cursor="over" while
// the cursor rests on it and data-cursor="press" from a click until the
// button comes up, so the film's CSS can light it with a colour change:
//   #upgrade[data-cursor="press"] { background: #e04e00; }
// The attribute flips on the frame, so give it no CSS transition.
//
// The returned part has draw(t), el (the pointer), pointAt(t) (where the
// tip is at any time, tremor and all, for a grid's field to follow) and
// clicks: [{ at, x, y }] (where each click lands; for a key with `to`,
// measured when the part was made), handy for starting a grid's ripple.
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
  // Leaves briskly, arrives softly, like a hand that knows where it's going.
  const glideEase = bezier(0.4, 0, 0.1, 1);
  const ringEase = (p) => 1 - (1 - p) ** 3;
  const RING = 0.5; // seconds a click ring lasts
  const PRESS = 0.18; // seconds the button is down on a plain click

  // The spring a chat bubble opens on: a small overshoot, then still.
  function spring(t) {
    if (t <= 0) return 0;
    const w0 = Math.sqrt(240 / 0.6);
    const zeta = 14 / (2 * Math.sqrt(240 * 0.6));
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  // A hand's faint tremor: three slow waves, the same on every render.
  const tremor = (seed, t) => {
    const f = t * 30;
    return Math.sin(f * 0.071 + seed * 1.7) * 0.55 + Math.sin(f * 0.13 + seed * 4.1) * 0.3 + Math.sin(f * 0.031 + seed * 0.3) * 0.15;
  };

  const rgb = (c) => {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c ?? "").trim());
    if (!m) return null;
    const hex = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
    const n = Number.parseInt(hex, 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  };
  // Tag text: white, or near-black on a light colour (yellow, orange).
  const inkOn = (c) => {
    const v = rgb(c);
    if (!v) return "#ffffff";
    const [r, g, b] = v.map((x) => (x / 255 <= 0.04045 ? x / 255 / 12.92 : ((x / 255 + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? "rgba(0, 0, 0, 0.9)" : "#ffffff";
  };
  // A chat bubble's inside rim, a shade darker than its fill.
  const rimOf = (c) => {
    const v = rgb(c);
    return v ? `rgb(${v.map((x) => Math.round(x * 0.9)).join(", ")})` : c;
  };

  // The kit's multiplayer pointer (Cursors page, cursor-multiplayer): a white rim under a dart.
  const KIT_RIM =
    "M0.439383 0.439383 C0.855314 0.0234519 1.47597 -0.110987 2.02673 0.0955492 L13.0267 4.22055 C13.6416 4.45111 14.035 5.05477 13.9976 5.71034 C13.9603 6.36592 13.5009 6.921 12.8638 7.08026 L8.23697 8.23697 L7.08026 12.8638 C6.921 13.5009 6.36592 13.9603 5.71034 13.9976 C5.05477 14.035 4.45111 13.6416 4.22055 13.0267 L0.0955492 2.02673 C-0.110987 1.47597 0.0234519 0.855314 0.439383 0.439383 Z";
  const KIT_DART =
    "M0.675576 0.0318497 C0.491988 -0.0369956 0.285105 0.0078173 0.146461 0.146461 C0.0078173 0.285105 -0.0369956 0.491988 0.0318497 0.675576 L4.15685 11.6756 C4.2337 11.8805 4.43492 12.0117 4.65345 11.9992 C4.87197 11.9868 5.057 11.8336 5.11009 11.6213 L6.41232 6.41232 L11.6213 5.11009 C11.8336 5.057 11.9868 4.87197 11.9992 4.65345 C12.0117 4.43492 11.8805 4.2337 11.6756 4.15685 L0.675576 0.0318497 Z";
  const I_BEAM = "M9 3.5C10.6 3.5 11.5 4.2 12 5C12.5 4.2 13.4 3.5 15 3.5M12 5V19M9 20.5C10.6 20.5 11.5 19.8 12 19C12.5 19.8 13.4 20.5 15 20.5";

  // Each pointer in its own units: `box` the drawing, `px` its size at
  // scale 1, `tip` the point, `tag` where a name tag (or chat) starts.
  const LOOKS = {
    canvas: {
      box: 32,
      px: 32,
      tip: [3.5, 3.5],
      tag: [16, 16],
      svg: (fill, shadow) =>
        `<path d="${KIT_RIM}" transform="translate(2.5 2.5)" fill="#ffffff"${shadow ? ' style="filter: drop-shadow(0px 1px 1.5px rgba(0, 0, 0, 0.35))"' : ""}/><path d="${KIT_DART}" transform="translate(3.5 3.5)" fill="${fill}"/>`,
    },
    arrow: {
      box: 24,
      px: 26.7,
      tip: [4.5, 2.5],
      tag: [14.6, 18.3],
      svg: (fill) => `<path d="M4.5 2.5V19.8L8.9 15.9L11.8 22.3L14.6 21.1L11.8 14.8H17.6Z" fill="${fill}" stroke="#ffffff" stroke-width="1.4" stroke-linejoin="round"/>`,
    },
    text: {
      box: 24,
      px: 26.7,
      tip: [12, 12],
      tag: [16, 20],
      svg: (fill) => `<path d="${I_BEAM}" fill="none" stroke="#ffffff" stroke-width="3.8" stroke-linecap="round"/><path d="${I_BEAM}" fill="none" stroke="${fill}" stroke-width="1.6" stroke-linecap="round"/>`,
    },
  };
  const TOUCH = 37.3; // the touch dot's width at scale 1

  function filmCursor(container, opts = {}) {
    const brand = window.__brand;
    const roles = brand?.colors?.roles ?? {};
    const textFont = (brand?.fonts?.find((f) => f.role === "text") ?? brand?.fonts?.[0])?.family;
    const keys = (opts.keys ?? []).map((k) => ({ ...k, at: k.at ?? 0 })).sort((a, b) => a.at - b.at);
    const chats = (opts.chats ?? []).map((c) => ({ at: c.at ?? 0, text: String(c.text ?? ""), duration: Math.max(0.4, c.duration ?? 2) }));
    const scale = opts.scale ?? Math.min(container.clientWidth || 1920, container.clientHeight || 1080) / 720;
    const glideMax = opts.glide ?? 0.55;
    const arc = opts.arc ?? 1;
    const drift = (opts.drift ?? 1.4) * scale;
    const seed = opts.seed ?? 1;
    const tint = opts.color ?? opts.label?.color ?? roles.accent ?? COLORS.purple;
    const ink = opts.label?.textColor ?? inkOn(tint);
    const ringColor = opts.ring?.color ?? roles.ink ?? "#111111";
    const ringSize = (opts.ring?.size ?? 20) * scale;
    const shadowFor = (look) => opts.shadow ?? look === "canvas";
    const font = textFont ? `"${textFont}", system-ui, sans-serif` : "system-ui, sans-serif";
    const doc = container.ownerDocument ?? document;
    const px = (v) => `${(v * scale).toFixed(3)}px`;

    const target = (k) => (typeof k.to === "string" ? doc.querySelector(k.to) : (k.to ?? null));

    // Where a key points, in container px (the film may be shown scaled down).
    function spot(k) {
      const el = k.to ? target(k) : null;
      if (!el) return { x: k.x ?? 0, y: k.y ?? 0 };
      const r = el.getBoundingClientRect();
      const base = container.getBoundingClientRect();
      const s = base.width / (container.offsetWidth || base.width || 1) || 1;
      return { x: (r.left + r.width / 2 - base.left) / s + (k.dx ?? 0), y: (r.top + r.height / 2 - base.top) / s + (k.dy ?? 0) };
    }

    // When each glide sets off: as late as it can, so the cursor waits, then moves with purpose.
    const leaves = keys.map((k, i) => (i === 0 ? k.at : k.at - Math.min(glideMax, (k.at - keys[i - 1].at) * 0.85)));

    function position(t) {
      if (!keys.length) return { x: 0, y: 0 };
      if (t <= keys[0].at) return spot(keys[0]);
      for (let i = 1; i < keys.length; i++) {
        if (t >= keys[i].at) continue;
        if (t <= leaves[i]) return spot(keys[i - 1]);
        const a = spot(keys[i - 1]);
        const b = spot(keys[i]);
        const u = (t - leaves[i]) / Math.max(1e-6, keys[i].at - leaves[i]);
        const e = glideEase(u);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        // Bow upward, the way a wrist swings a mouse.
        let nx = dy / len;
        let ny = -dx / len;
        if (ny > 0 || (ny === 0 && nx < 0)) {
          nx = -nx;
          ny = -ny;
        }
        const bow = Math.sin(Math.PI * u) * Math.min(80, len * 0.12) * arc;
        return { x: a.x + dx * e + nx * bow, y: a.y + dy * e + ny * bow };
      }
      return spot(keys[keys.length - 1]);
    }
    const pointAt = (t) => {
      const p = position(t);
      return { x: p.x + tremor(seed, t) * drift, y: p.y + tremor(seed + 9.3, t) * drift };
    };

    // ─── The pointer, its tag, its chat and its rings ───

    const wrap = document.createElement("div");
    wrap.className = "film-cursor";
    wrap.setAttribute("data-layout-allow-overlap", "");
    Object.assign(wrap.style, { position: "absolute", left: "0", top: "0", zIndex: "2", pointerEvents: "none", willChange: "transform, opacity" });
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("overflow", "visible");
    svg.style.position = "absolute";
    svg.style.overflow = "visible";
    const dot = document.createElement("div");
    Object.assign(dot.style, { position: "absolute", borderRadius: "50%", border: `${px(1)} solid rgba(0,0,0,0.16)`, display: "none" });
    wrap.appendChild(svg);
    wrap.appendChild(dot);

    // The kit's name tag: 11 px type at 550, 2 px corners, a hairline of shadow.
    let tag = null;
    if (opts.label?.text) {
      tag = document.createElement("div");
      tag.textContent = opts.label.text;
      Object.assign(tag.style, {
        position: "absolute",
        whiteSpace: "nowrap",
        background: tint,
        color: ink,
        fontFamily: font,
        fontSize: px(11),
        lineHeight: px(16),
        fontWeight: "550",
        letterSpacing: px(0.055),
        padding: `${px(1)} ${px(4)}`,
        borderRadius: px(2),
      });
      wrap.appendChild(tag);
    }

    // The kit's cursor chat: the tag opens into a bubble, rounded but for its corner by the pointer.
    let bubble = null;
    if (chats.length) {
      bubble = document.createElement("div");
      Object.assign(bubble.style, {
        position: "absolute",
        display: "none",
        alignItems: "center",
        whiteSpace: "nowrap",
        background: tint,
        color: ink,
        fontFamily: font,
        fontSize: px(13),
        lineHeight: px(22),
        fontWeight: "550",
        letterSpacing: px(-0.0325),
        padding: `${px(8)} ${px(16)} ${px(8)} ${px(12)}`,
        borderRadius: `${px(2)} ${px(99)} ${px(99)} ${px(19)}`,
        transformOrigin: "0 0",
      });
      wrap.appendChild(bubble);
    }
    container.appendChild(wrap);

    const rings = [0, 1, 2].map(() => {
      const r = document.createElement("div");
      Object.assign(r.style, { position: "absolute", left: "0", top: "0", zIndex: "1", borderRadius: "50%", border: `${Math.max(1, 1.33 * scale).toFixed(2)}px solid ${ringColor}`, pointerEvents: "none", opacity: "0" });
      container.appendChild(r);
      return r;
    });

    let shown = null;
    function setLook(look) {
      if (look === shown) return;
      shown = look;
      const shadow = shadowFor(look);
      let at;
      if (look === "touch") {
        const d = TOUCH * scale;
        svg.style.display = "none";
        Object.assign(dot.style, { display: "block", width: `${d}px`, height: `${d}px`, left: `${-d / 2}px`, top: `${-d / 2}px`, boxShadow: shadow ? `0 ${px(1.5)} ${px(7)} rgba(0,0,0,0.18)` : "none" });
        at = [d * 0.42, d * 0.42];
      } else {
        const L = LOOKS[look] ?? LOOKS.canvas;
        const u = (L.px * scale) / L.box;
        dot.style.display = "none";
        svg.style.display = "block";
        svg.setAttribute("viewBox", `0 0 ${L.box} ${L.box}`);
        svg.setAttribute("width", (L.box * u).toFixed(3));
        svg.setAttribute("height", (L.box * u).toFixed(3));
        svg.style.left = `${(-L.tip[0] * u).toFixed(3)}px`;
        svg.style.top = `${(-L.tip[1] * u).toFixed(3)}px`;
        svg.style.filter = shadow && look !== "canvas" ? "drop-shadow(0 1px 1px rgba(0,0,0,0.28)) drop-shadow(0 3px 7px rgba(0,0,0,0.16))" : "";
        svg.innerHTML = L.svg(look === "canvas" ? tint : "#111111", shadow);
        at = [(L.tag[0] - L.tip[0]) * u, (L.tag[1] - L.tip[1]) * u];
      }
      for (const el of [tag, bubble]) {
        if (el) Object.assign(el.style, { left: `${at[0].toFixed(3)}px`, top: `${at[1].toFixed(3)}px` });
      }
      if (tag) tag.style.boxShadow = shadow ? `0 ${px(1)} ${px(3)} rgba(0, 0, 0, 0.1)` : "none";
      if (bubble) {
        const lift = shadow ? `, 0 ${px(1)} ${px(3)} rgba(0, 0, 0, 0.1), 0 ${px(5)} ${px(12)} rgba(0, 0, 0, 0.13), 0 0 ${px(0.5)} rgba(0, 0, 0, 0.15)` : "";
        bubble.style.boxShadow = `inset 0 0 0 ${px(2)} ${rimOf(tint)}${lift}`;
      }
    }

    const clickKeys = keys.filter((k) => k.click);
    const pressed = (t) => clickKeys.some((k) => t >= k.at && t < k.at + Math.max(PRESS, k.hold ?? 0));

    // What it points at: over while it rests there, pressed from a click until the button comes up.
    const marks = keys.map((k, i) => (k.to ? { k, rest: i + 1 < keys.length ? leaves[i + 1] : Number.POSITIVE_INFINITY, up: k.click ? k.at + Math.max(PRESS, k.hold ?? 0) : -1 } : null)).filter(Boolean);

    let typed = null;
    function draw(t) {
      const p = pointAt(t);
      let look = opts.look ?? "canvas";
      for (const k of keys) if (k.look && t >= k.at) look = k.look;
      setLook(look);

      let o = 1;
      if (opts.appear != null) o *= clamp((t - opts.appear) / 0.2);
      if (opts.vanish != null) o *= 1 - clamp((t - opts.vanish) / 0.2);
      wrap.style.opacity = String(o);
      wrap.style.transform = `translate(${p.x.toFixed(3)}px, ${p.y.toFixed(3)}px)`;
      if (look === "touch") dot.style.background = pressed(t) ? "rgba(40,40,40,0.42)" : "rgba(255,255,255,0.55)";

      // A chat opens on a spring, types itself out, and fades in its last moment.
      const chat = chats.find((c) => t >= c.at && t < c.at + c.duration);
      if (bubble) {
        if (chat) {
          const open = spring(t - chat.at);
          const close = clamp((t - (chat.at + chat.duration - 0.27)) / 0.27);
          const n = chat.text.length;
          const text = chat.text.slice(0, Math.ceil(n * clamp((t - chat.at - 0.13) / Math.max(0.01, n * 0.047))));
          if (text !== typed) bubble.textContent = typed = text;
          Object.assign(bubble.style, { display: "flex", transform: `scale(${(0.55 + 0.45 * open).toFixed(4)})`, opacity: String(clamp(open * 2) * (1 - close)) });
        } else {
          bubble.style.display = "none";
        }
      }
      if (tag) tag.style.display = chat ? "none" : "block";

      // The latest clicks still ringing out, oldest first.
      const ringing = clickKeys.filter((k) => t >= k.at && t < k.at + RING).slice(-rings.length);
      rings.forEach((r, j) => {
        const k = ringing[j];
        if (!k) {
          r.style.opacity = "0";
          return;
        }
        const q = (t - k.at) / RING;
        const c = spot(k);
        const radius = mix(4 * scale, ringSize, ringEase(q));
        Object.assign(r.style, { width: `${radius * 2}px`, height: `${radius * 2}px`, transform: `translate(${c.x - radius}px, ${c.y - radius}px)`, opacity: String(0.5 * (1 - q) * o) });
      });

      const states = new Map();
      for (const m of marks) {
        const el = target(m.k);
        if (!el) continue;
        let s = states.get(el) ?? null;
        if (t >= m.k.at && t < m.up) s = "press";
        else if (s !== "press" && t >= m.k.at && t < m.rest) s = "over";
        states.set(el, s);
      }
      for (const [el, s] of states) {
        if (s) el.setAttribute("data-cursor", s);
        else el.removeAttribute("data-cursor");
      }
    }

    const clicks = clickKeys.map((k) => ({ at: k.at, ...spot(k) }));
    draw(0);
    return { draw, el: wrap, clicks, pointAt };
  }

  // The kit's multiplayer colours.
  const COLORS = { purple: "#9747FF", pink: "#FF24BD", green: "#14AE5C", blue: "#007BE5", red: "#F24822", orange: "#FFA629", yellow: "#FFCD29" };
  filmCursor.colors = COLORS;

  window.filmCursor = filmCursor;
})();
