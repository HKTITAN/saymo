// Checks the HTML film parts (studio/starters/html/assets/parts) and the
// Effects page's preview scenes (studio/effects) without a browser. Each
// part runs on a small stand-in for the page (no layout, no painting), and
// the checks read back what it set: positions, sizes, colours, text, masks.
// What only a browser can show (how it looks) still needs a look.
//
//   node scripts/studio/parts-check.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PARTS = path.join(ROOT, "studio/starters/html/assets/parts");
const SCENES = path.join(ROOT, "studio/effects");

// ─── A stand-in page ───

const polyline = (d) => {
  const nums = (d.match(/-?\d*\.?\d+/g) || []).map(Number);
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  return pts;
};
const styleObject = () => {
  const st = {};
  Object.defineProperties(st, {
    setProperty: { value: (k, v) => (st[k] = String(v)) },
    removeProperty: { value: (k) => delete st[k] },
    getPropertyValue: { value: (k) => st[k] ?? "" },
  });
  return st;
};
const text = (v) => {
  const t = {
    nodeType: 3,
    data: String(v),
    parentNode: null,
    get textContent() {
      return t.data;
    },
    set textContent(x) {
      t.data = String(x);
    },
    remove() {
      const p = t.parentNode;
      if (p) {
        p.childNodes = p.childNodes.filter((x) => x !== t);
        t.parentNode = null;
      }
    },
    get nextSibling() {
      const p = t.parentNode;
      return p ? (p.childNodes[p.childNodes.indexOf(t) + 1] ?? null) : null;
    },
  };
  return t;
};
const make = (tag, ns) => {
  const e = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    namespaceURI: ns,
    style: styleObject(),
    childNodes: [],
    dataset: {},
    attrs: {},
    parentNode: null,
    offsetTop: 0,
    offsetLeft: 0,
    offsetWidth: 0,
    offsetHeight: 0,
    clientWidth: 0,
    clientHeight: 0,
    className: "",
    classList: {
      set: new Set(),
      add(...c) {
        for (const x of c) this.set.add(x);
      },
      remove(...c) {
        for (const x of c) this.set.delete(x);
      },
      contains(c) {
        return this.set.has(c);
      },
      toggle(c, on) {
        if (on ?? !this.set.has(c)) this.set.add(c);
        else this.set.delete(c);
      },
    },
    get children() {
      return e.childNodes.filter((c) => c.nodeType === 1);
    },
    get firstChild() {
      return e.childNodes[0] ?? null;
    },
    get parentElement() {
      return e.parentNode?.nodeType === 1 ? e.parentNode : null;
    },
    querySelectorAll(list) {
      const tags = list.split(",").map((x) => x.trim().toUpperCase());
      const out = [];
      const walk = (n) => {
        for (const c of n.childNodes) {
          if (c.nodeType !== 1) continue;
          if (tags.includes(c.tagName)) out.push(c);
          walk(c);
        }
      };
      walk(e);
      return out;
    },
    get nextSibling() {
      const p = e.parentNode;
      return p ? (p.childNodes[p.childNodes.indexOf(e) + 1] ?? null) : null;
    },
    appendChild(c) {
      if (c.parentNode) c.remove();
      c.parentNode = e;
      e.childNodes.push(c);
      return c;
    },
    append(...cs) {
      for (const c of cs) e.appendChild(typeof c === "string" ? text(c) : c);
    },
    insertBefore(c, ref) {
      if (c.parentNode) c.remove();
      c.parentNode = e;
      const i = ref ? e.childNodes.indexOf(ref) : -1;
      if (i < 0) e.childNodes.push(c);
      else e.childNodes.splice(i, 0, c);
      return c;
    },
    replaceChildren(...cs) {
      for (const c of [...e.childNodes]) c.remove();
      e.append(...cs);
    },
    remove() {
      const p = e.parentNode;
      if (p) {
        p.childNodes = p.childNodes.filter((x) => x !== e);
        e.parentNode = null;
      }
    },
    setAttribute(k, v) {
      e.attrs[k] = String(v);
    },
    getAttribute(k) {
      return e.attrs[k] ?? null;
    },
    removeAttribute(k) {
      delete e.attrs[k];
    },
    hasAttribute(k) {
      return k in e.attrs;
    },
    get textContent() {
      return e.childNodes.map((c) => c.textContent).join("");
    },
    set textContent(v) {
      for (const c of [...e.childNodes]) c.remove();
      if (v !== "") e.appendChild(text(String(v)));
    },
    set innerHTML(v) {
      e._html = v;
      for (const c of [...e.childNodes]) c.remove();
    },
    get innerHTML() {
      return e._html ?? "";
    },
    getBoundingClientRect() {
      return { left: e.offsetLeft, top: e.offsetTop, width: e.offsetWidth, height: e.offsetHeight, right: e.offsetLeft + e.offsetWidth, bottom: e.offsetTop + e.offsetHeight, x: e.offsetLeft, y: e.offsetTop };
    },
    querySelector: () => null,
  };
  if (tag === "path") {
    const segs = () => {
      const p = polyline(e.attrs.d);
      return p.slice(1).map((b, i) => ({ a: p[i], b, l: Math.hypot(b[0] - p[i][0], b[1] - p[i][1]) }));
    };
    e.getTotalLength = () => segs().reduce((n, s) => n + s.l, 0);
    e.getPointAtLength = (at) => {
      let left = at;
      const list = segs();
      for (const [i, s] of list.entries()) {
        if (left <= s.l || i === list.length - 1) {
          const k = s.l ? Math.min(1, left / s.l) : 0;
          return { x: s.a[0] + (s.b[0] - s.a[0]) * k, y: s.a[1] + (s.b[1] - s.a[1]) * k };
        }
        left -= s.l;
      }
      return { x: 0, y: 0 };
    };
  }
  return e;
};

globalThis.window = globalThis;
globalThis.document = { createElement: (t) => make(t), createElementNS: (ns, t) => make(t, ns), createTextNode: text, body: make("body"), querySelector: () => null };
globalThis.getComputedStyle = (el) => ({ position: el.style.position || "static", color: el.style.color || "rgb(17, 17, 17)", fontSize: "100px", stroke: el.attrs?.stroke ?? "none", fill: el.attrs?.fill ?? "rgb(0, 0, 0)", fillOpacity: el.attrs?.["fill-opacity"] ?? "1" });
globalThis.Element = class {
  static [Symbol.hasInstance](x) {
    return Boolean(x) && x.nodeType === 1;
  }
};
const load = (file) => new Function(readFileSync(file, "utf8"))();
const container = (w = 1920, h = 1080) => {
  const c = make("div");
  Object.assign(c, { clientWidth: w, clientHeight: h, offsetWidth: w, offsetHeight: h });
  document.body.appendChild(c);
  return c;
};

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
};

for (const f of ["grid", "cursor", "counter", "reveal", "wipe", "gradient", "sphere", "stagger", "carousel", "glass", "rig", "svg", "liquid"]) load(path.join(PARTS, `${f}.js`));

// ─── Grid field ───

const read = (el) => {
  const m = /translate\((-?[\d.e-]+)px, (-?[\d.e-]+)px\) rotate\((-?[\d.e-]+)deg\) scale\((-?[\d.e-]+)\)/.exec(el.style.transform);
  if (!m) return null;
  const card = Number.parseFloat(el.style.width);
  return { x: +m[1] + card / 2, y: +m[2] + card / 2, r: +m[3], s: +m[4], o: +el.style.opacity, z: +el.style.zIndex };
};
const snap = (g) => g.cards.map(read);
const finite = (list) => list.every((p) => p && [p.x, p.y, p.r, p.s, p.o].every(Number.isFinite));
const same = (a, b, eps = 1e-6) => a.every((p, i) => ["x", "y", "r", "s", "o"].every((k) => Math.abs(p[k] - b[i][k]) < eps));

{
  const p = snap(gridField(container(), { items: 12 }));
  const mid = (k) => (Math.min(...p.map((q) => q[k])) + Math.max(...p.map((q) => q[k]))) / 2;
  check("grid: numbers are finite", finite(p));
  check("grid: centred", Math.abs(mid("x") - 960) < 0.01 && Math.abs(mid("y") - 540) < 0.01);
  check("grid: 12 cards make 4 by 3", new Set(p.map((q) => q.y.toFixed(3))).size === 3 && new Set(p.map((q) => q.x.toFixed(3))).size === 4);
}
{
  const g = gridField(container(), { items: 12, morphs: [{ at: 1, duration: 1.2, to: "ring" }] });
  const a = (g.draw(0), snap(g));
  const b = (g.draw(0.99), snap(g));
  const c = (g.draw(2.3), snap(g));
  check("morph: nothing moves before it starts", same(a, b));
  check("morph: lands on the ring", c.every((q) => Math.abs(Math.hypot(q.x - 960, q.y - 540) - 388.8) < 0.01));
}
{
  const opts = {
    items: 20,
    morphs: [
      { at: 1, duration: 1, to: "sphere", from: "random" },
      { at: 3, duration: 1, to: { type: "scatter", seed: 3 } },
    ],
    enter: { at: 0, duration: 0.8 },
    leave: { at: 5, duration: 0.8, from: "random" },
    field: { keys: [{ at: 0, x: 0, y: 0 }, { at: 6, x: 1920, y: 1080 }], scale: [1.6, 1], aim: "near" },
  };
  const A = gridField(container(), opts);
  const B = gridField(container(), opts);
  const times = [0.3, 1.4, 2.2, 3.5, 5.3, 5.9];
  const fromA = times.map((t) => (A.draw(t), snap(A)));
  const fromB = [...times].reverse().map((t) => (B.draw(t), snap(B))).reverse();
  check("seek order: same frames forwards and backwards", fromA.every((s, i) => same(s, fromB[i])) && fromA.every(finite));
  check("enter and leave: hidden at the start, gone at the end", (A.draw(0), snap(A)).every((q) => q.s === 0) && (A.draw(5.81), snap(A)).every((q) => q.o === 0));
}
{
  const p = snap(gridField(container(), { items: 40, layout: "sphere" }));
  check("sphere layout: depth fades the back", finite(p) && Math.min(...p.map((q) => q.o)) < 0.5 && Math.max(...p.map((q) => q.o)) > 0.95);
}
{
  const g = gridField(container(), { items: 16, layout: { type: "path", shape: "loop", travel: 200 } });
  const a = (g.draw(2), snap(g));
  const b = (g.draw(2 + 1 / 60), snap(g));
  const most = Math.max(...a.map((q, i) => Math.hypot(q.x - b[i].x, q.y - b[i].y)));
  check("path: a travelling loop moves a few px a frame", most > 0.5 && most < 8, `${most.toFixed(2)} px`);
  const d = snap(gridField(container(), { items: 10, layout: { type: "path", d: "M100 540 L1820 540" } }));
  check("path: evenly along a drawn path", d.every((q, i) => Math.abs(q.x - (100 + i * (1720 / 9))) < 0.01 && Math.abs(q.y - 540) < 0.01));
}
{
  const g = gridField(container(), { items: 35, field: { keys: [{ at: 0, x: 700, y: 400 }], radius: 400, scale: [1.8, 1], color: { near: "#ff0000", far: "#0000ff" } } });
  const p = snap(g);
  const dist = p.map((q) => Math.hypot(q.x - 700, q.y - 400));
  const nearest = dist.indexOf(Math.min(...dist));
  check("field: the nearest card is biggest, far ones untouched", p[nearest].s === Math.max(...p.map((q) => q.s)) && p.filter((_, i) => dist[i] > 400).every((q) => q.s === 1));
  check("field: colour mixes by closeness", /^rgb\(\d+, 0, \d+\)$/.test(g.cards[nearest].style.background));
}
{
  const g = gridField(container(), { items: 35, waves: [{ at: 1, x: 960, y: 540, speed: 800, scale: 1.5 }] });
  const first = (g.draw(0.99), snap(g))[0];
  g.draw(1 + Math.hypot(first.x - 960, first.y - 540) / 800);
  check("waves: the crest lifts the card it reaches", Math.abs(read(g.cards[0]).s - 1.5) < 1e-9 && Number(g.cards[0].style["--wave"]) === 1);
}
{
  const a = snap(gridField(container(), { items: 18, layout: { type: "scatter", seed: 4 } }));
  const b = snap(gridField(container(), { items: 18, layout: { type: "scatter", seed: 4 } }));
  const c = snap(gridField(container(), { items: 18, layout: { type: "scatter", seed: 5 } }));
  check("scatter: same seed same scatter, another seed another", same(a, b) && !same(a, c));
}
{
  const seen = [];
  const g = gridField(container(), {
    items: 40,
    fields: [
      { name: "glow", points: [{ keys: [{ at: 0, x: 300, y: 300 }] }, { keys: [{ at: 0, x: 1600, y: 800 }] }], radius: 300, scale: [2, 1] },
      { name: "tint", keys: [{ at: 0, x: 960, y: 540 }], radius: 200, color: { near: "#ff0000", far: "#0000ff" }, apply: (el, near, i) => seen.push(i) },
    ],
  });
  const p = snap(g);
  const closest = (x, y) => {
    const d = p.map((q) => Math.hypot(q.x - x, q.y - y));
    return d.indexOf(Math.min(...d));
  };
  const a = closest(300, 300);
  const b = closest(1600, 800);
  check("groups: both points of one field work", p[a].s > 1.3 && p[b].s > 1.3, `${p[a].s.toFixed(2)}, ${p[b].s.toFixed(2)}`);
  check("groups: a custom map sets a CSS variable on each card", Number(g.cards[a].style["--glow"]) > 0.5 && g.cards.some((el) => el.style["--glow"] === "0.000"));
  check("groups: a second field does its own thing", g.cards.some((el) => Number(/^rgb\((\d+), 0, \d+\)$/.exec(el.style.background ?? "")?.[1] ?? 0) > 100) && g.cards[a].style["--tint"] === "0.000");
  check("groups: apply runs for every card", seen.length === 40);
  const counts = (layout) => {
    const r = snap(gridField(container(), { items: 30, layout }));
    return [120, 240, 360].map((rr) => r.filter((q) => Math.round(Math.hypot(q.x - 960, q.y - 540)) === rr).length).join();
  };
  check("radial: a polar grid, outer rings hold more", counts({ type: "ring", rings: 3, radius: 360 }) === "5,10,15", counts({ type: "ring", rings: 3, radius: 360 }));
  check("radial: even when asked", counts({ type: "ring", rings: 3, radius: 360, fill: "even" }) === "10,10,10");
}

// ─── Cursor ───

{
  const c = container();
  const button = make("button");
  Object.assign(button, { offsetLeft: 900, offsetTop: 500, offsetWidth: 200, offsetHeight: 60 });
  document.querySelector = (sel) => (sel === "#buy" ? button : null);
  const cur = filmCursor(c, { drift: 0, label: { text: "maya" }, keys: [{ at: 0, x: 2000, y: 1200 }, { at: 1, x: 1500, y: 800 }, { at: 2, to: "#buy", click: true }, { at: 3.2, x: 300, y: 300, look: "text" }] });
  const pos = () => {
    const m = /translate\((-?[\d.e-]+)px, (-?[\d.e-]+)px\)/.exec(cur.el.style.transform);
    return { x: +m[1], y: +m[2] };
  };
  cur.draw(1);
  check("cursor: exactly on a key when it arrives", pos().x === 1500 && pos().y === 800);
  cur.draw(2);
  check("cursor: points at the middle of an element", pos().x === 1000 && pos().y === 530);
  let most = 0;
  let prev = null;
  for (let t = 1.4; t <= 2; t += 1 / 120) {
    cur.draw(t);
    const p = pos();
    if (prev) most = Math.max(most, Math.hypot(p.x - prev.x, p.y - prev.y));
    prev = p;
  }
  check("cursor: glides without jumps", most < 40, `${most.toFixed(1)} px a step`);
  cur.draw(2.05);
  check("cursor: press, then over, then clear on what it points at", button.getAttribute("data-cursor") === "press" && (cur.draw(2.5), button.getAttribute("data-cursor") === "over") && (cur.draw(3.15), button.getAttribute("data-cursor") === null));
  cur.draw(3.3);
  check("cursor: look changes at its key", cur.el.childNodes[0].innerHTML.includes("M9 3.5"));
  const team = filmCursor(container(), { keys: [{ at: 0, x: 10, y: 10 }], label: { text: "ana", color: "#ff5a1f" } });
  check("cursor: the kit pointer by default, in the person's colour", team.el.childNodes[0].innerHTML.includes("M0.675576") && team.el.childNodes[2].style.background === "#ff5a1f");
  const talk = filmCursor(container(), { keys: [{ at: 0, x: 500, y: 500 }], label: { text: "maya" }, chats: [{ at: 1, text: "love this", duration: 2 }] });
  const [tagEl, bubbleEl] = [talk.el.childNodes[2], talk.el.childNodes[3]];
  talk.draw(1.3);
  const half = bubbleEl.textContent;
  talk.draw(2.2);
  check("chat: opens, types itself out, hides the tag", half.length > 0 && half.length < 9 && bubbleEl.textContent === "love this" && tagEl.style.display === "none");
  const still = filmCursor(container(), { keys: [{ at: 0, x: 500, y: 500 }] });
  const a = still.pointAt(2);
  check("tremor: faint and the same every render", Math.hypot(a.x - 500, a.y - 500) < 4 && still.pointAt(2).x === a.x);
}

// ─── Counter ───

const wheels = (el) => el.childNodes.filter((c) => c.childNodes[0]?.childNodes?.length);
const landed = (el) =>
  wheels(el)
    .map((w) => {
      const strip = w.childNodes[0];
      const y = -Number.parseFloat(/translateY\((-?[\d.]+)em\)/.exec(strip.style.transform)[1]) / 1.15;
      return strip.childNodes[Math.round(y)].textContent;
    })
    .join("");
{
  const el = make("div");
  const n = filmCounter(el, { to: 48200, at: 1, duration: 1.5, format: { style: "currency", currency: "USD", maximumFractionDigits: 0 } });
  n.draw(0.5);
  check("counter: a wheel per digit, new ones shut at the start", wheels(el).length === 5 && wheels(el)[0].style.maxWidth === "0.0000em");
  n.draw(2.6);
  check("counter: the wheels land on 48200", landed(el) === "48200", landed(el));
  const loss = make("div");
  filmCounter(loss, { to: 1000, at: 0, duration: 1, format: { style: "currency", currency: "USD", maximumFractionDigits: 0 }, steps: [{ at: 2, to: 950, duration: 1 }] }).draw(3.01);
  const shown = loss.childNodes.filter((c) => +c.style.opacity > 0.001 && c.style.maxWidth !== "0.0000em").length;
  check("counter: lost digits close up", shown === 4, `${shown} shown`);
  const plain = make("div");
  const d = filmCounter(plain, { from: 120, to: 95, at: 0, duration: 1, style: "count", suffix: " ms" });
  d.draw(1);
  check("counter: count style", plain.textContent === "95 ms");
}

// ─── Text reveal ───

{
  const el = make("h1");
  el.append("Spend less ");
  const accent = make("span");
  accent.append("on every");
  el.append(accent, " order.");
  const r = textReveal(el, { by: "words", at: 0.5, stagger: 0.1, duration: 0.6 });
  check("reveal: text and markup kept", el.textContent === "Spend less on every order." && accent.childNodes.some((c) => c.className === "reveal-mask"));
  r.draw(0);
  check("reveal: hidden behind its edge first", r.pieces.every((p) => p.style.transform === "translateY(106.000%)"));
  r.draw(r.end + 0.01);
  check("reveal: in place at its end", r.pieces.every((p) => p.style.transform === ""));
  const t = make("p");
  t.append("Hi, team.");
  const ty = textReveal(t, { effect: "type", at: 1, leave: { at: 4 } });
  const visible = () => ty.pieces.filter((s) => s.style.visibility === "visible").map((s) => s.textContent).join("");
  ty.draw(ty.end);
  const all = visible();
  ty.draw(4.05);
  check("type: every letter by its end, deleted from the end on leaving", all === "Hi,team." && visible().length < 8 && "Hi,team.".startsWith(visible()));
}

{
  const c = make("p");
  c.append("Ship it");
  const ty = textReveal(c, { effect: "colour", at: 0, tint: "#ff5a1f", settle: 0.1 });
  ty.draw(ty.end + 0.01);
  const glow = ty.pieces.map((sp) => sp.style.color);
  check("colour: the newest letter glows in the tint, settled ones don't", glow.at(-1).startsWith("color-mix(in oklab, #ff5a1f") && glow[0] === "");
  const sc = make("p");
  sc.append("Go 2026!");
  const r = textReveal(sc, { effect: "scramble", at: 1, stagger: 0.05, duration: 0.5, leave: { at: 4 } });
  const glyphs = () => r.pieces.map((pc) => (pc.childNodes[1].style.display === "block" ? pc.childNodes[1].textContent : null));
  r.draw(0.5);
  check("scramble: hidden before it starts", r.pieces.every((pc) => pc.style.opacity === "0"));
  r.draw(1.2);
  const g1 = glyphs();
  r.draw(1.26);
  const g2 = glyphs();
  check("scramble: letters flicker in their own kind", /^[A-Z]$/.test(g1[0]) && /^[a-z]$/.test(g1[1]) && /^[0-9]$/.test(g1[2]) && g1.join() !== g2.join(), g1.join(""));
  check("scramble: punctuation stays itself", g1[6] === null);
  r.draw(1.2);
  check("scramble: the same flicker every render", glyphs().join() === g1.join());
  r.draw(3);
  check("scramble: every letter lands", glyphs().every((x) => x === null) && r.pieces.every((pc) => pc.style.opacity === "1" && pc.style.webkitTextFillColor === ""));
  r.draw(6);
  check("scramble: gone after leaving", r.pieces.every((pc) => pc.style.opacity === "0"));
  const ex = make("h1");
  ex.append("Blow it up");
  const x = textReveal(ex, { effect: "explode", by: "letters", at: 0, leave: { at: 3 } });
  x.draw(0);
  check("explode: pieces start scattered and unseen", x.pieces.every((pc) => /translate\(-?[\d.]+em, -?[\d.]+em\) rotate/.test(pc.style.transform) && pc.style.opacity === "0"));
  x.draw(x.end + 0.01);
  check("explode: they settle in place", x.pieces.every((pc) => pc.style.transform === "" && pc.style.opacity === "1"));
  x.draw(5);
  check("explode: they blow apart on leaving", x.pieces.every((pc) => pc.style.transform !== "" && pc.style.opacity === "0"));
  const lines = make("h1");
  lines.append("Two lines here");
  const l = textReveal(lines, { effect: "explode", by: "lines", at: 0 });
  l.draw(0.1);
  check("explode: by lines, a line's words fly as one", new Set(l.pieces.map((pc) => pc.style.transform)).size === 1);
}

// ─── Stagger and bounce ───

{
  const els = [0, 1, 2, 3, 4].map(() => make("div"));
  const st = staggerIn(els, { at: 0, stagger: 0.1, duration: 0.6, leave: { at: 3 } });
  st.draw(0);
  check("stagger: every piece waits below, unseen", els.every((el) => el.style.transform.startsWith("translate(0.00px, 40.00px)") && el.style.opacity === "0"));
  st.draw(0.35);
  check("stagger: the first moves while the last still waits", els[0].style.transform !== els[4].style.transform && els[4].style.transform.startsWith("translate(0.00px, 40.00px)"));
  check("stagger: moving pieces are allowed to overlap", els[0].getAttribute("data-layout-allow-overlap") === "");
  st.draw(1.1);
  check("stagger: landed pieces are given back their own styles", els.every((el) => el.style.transform === "" && el.style.opacity === "" && el.getAttribute("data-layout-allow-overlap") === null));
  st.draw(4);
  check("stagger: gone after leaving", els.every((el) => el.style.opacity === "0"));
  const rev = [0, 1, 2].map(() => make("div"));
  staggerIn(rev, { order: "end", stagger: 0.2, duration: 0.3 }).draw(0.35);
  check("stagger: order end starts with the last", rev[2].style.transform === "" && rev[0].style.transform.startsWith("translate(0.00px, 40.00px)"));
  const b = make("div");
  const bi = bounceIn(b, { at: 0 });
  let most = 0;
  for (let t = 0; t <= 0.9; t += 1 / 60) {
    bi.draw(t);
    most = Math.max(most, Number(/scale\(([\d.]+)\)/.exec(b.style.transform || "scale(1)")[1]));
  }
  bi.draw(0.95);
  check("bounce: overshoots, then lands exactly", most > 1.03 && b.style.transform === "", `peak scale ${most.toFixed(3)}`);
}

// ─── Wipe ───

{
  const el = make("div");
  Object.assign(el, { offsetWidth: 1200, offsetHeight: 800 });
  const w = wipeReveal(el, { at: 1, duration: 1, band: true, leave: { at: 4, duration: 1 } });
  w.draw(0.5);
  check("wipe: clipped to nothing before it starts", el.style.clipPath === "inset(50%)");
  w.draw(1.5);
  check("wipe: a band rides the edge", el.style.maskImage.includes("linear-gradient(90deg, #000") && el.childNodes[0].style.backgroundImage.includes("transparent"));
  w.draw(2.5);
  check("wipe: nothing on it once shown", el.style.maskImage === "" && el.style.clipPath === "");
  w.draw(5);
  check("wipe: gone after leaving", el.style.clipPath === "inset(50%)");
  const c = make("div");
  Object.assign(c, { offsetWidth: 1000, offsetHeight: 1000 });
  wipeReveal(c, { from: "circle", at: 0, duration: 1 }).draw(0.5);
  check("wipe: a circle opens", /circle\([\d.]+px at 50\.000% 50\.000%\)/.test(c.style.clipPath));
}

{
  const el = make("div");
  const w = wipeReveal(el, { at: 0, duration: 1, style: "soft", softness: 0.2 });
  w.draw(0.5);
  const m = /#000 (-?[\d.]+)%, transparent (-?[\d.]+)%/.exec(el.style.maskImage);
  check("soft wipe: a feathered edge", Boolean(m) && Math.abs(Number(m[2]) - Number(m[1]) - 20) < 0.01, el.style.maskImage);
  w.draw(1.01);
  check("soft wipe: nothing on it once shown", el.style.maskImage === "");
  const g = make("div");
  g.style.filter = "saturate(1.2)";
  const gl = wipeReveal(g, { at: 0, duration: 1, style: "glitch" });
  gl.draw(0.5);
  const layers = g.style.maskImage.split("linear-gradient").length - 1;
  const edges = new Set([...g.style.maskImage.matchAll(/#000 ([\d.]+)%/g)].map((x) => x[1]));
  check("glitch wipe: 14 slices, each with its own edge", layers === 14 && edges.size > 5, `${edges.size} edges`);
  check("glitch wipe: a colour split and a shake mid-move, keeping its own filter", g.style.filter.startsWith("saturate(1.2) drop-shadow(") && /px 0px$/.test(g.style.translate));
  const before = g.style.maskImage;
  gl.draw(0.5);
  check("glitch wipe: the same jitter every render", g.style.maskImage === before);
  gl.draw(1.01);
  check("glitch wipe: calm and its own again once shown", g.style.filter === "saturate(1.2)" && g.style.maskImage === "");
}

// ─── Carousel ───

{
  const xOf = (el) => Number(/translate\((-?[\d.]+)px/.exec(el.style.transform)[1]) + 220;
  const c = carousel(container(), { items: 6, every: 1, duration: 0.6 });
  check("carousel: steps one card at a time and wraps round", c.index(0) === 0 && c.index(0.3) > 0 && c.index(0.3) < 1 && c.index(0.7) === 1 && c.index(5.65) === 6);
  c.draw(0);
  check("carousel: the middle card centred, its neighbours either side", Math.abs(xOf(c.cards[0]) - 960) < 0.01 && Math.abs(xOf(c.cards[1]) - 1432) < 0.01 && Math.abs(xOf(c.cards[5]) - 488) < 0.01);
  check("carousel: cards away from the middle are smaller and fainter", Number(c.cards[1].style.opacity) < 1 && /scale\(0\.88/.test(c.cards[1].style.transform));
  const cf = carousel(container(), { items: 5, style: "coverflow" });
  cf.draw(0);
  check("coverflow: the middle faces you, the sides turn away", /rotateY\(-?0\.00deg\)/.test(cf.cards[0].style.transform) && /rotateY\(-52\.00deg\)/.test(cf.cards[1].style.transform) && /rotateY\(52\.00deg\)/.test(cf.cards[4].style.transform));
  const mq = carousel(container(), { items: 8, style: "marquee", speed: 120 });
  mq.draw(1);
  const a = mq.cards.map(xOf);
  mq.draw(1 + 1 / 60);
  const b = mq.cards.map(xOf);
  check("marquee: flows left at its speed", a.every((x, i) => Math.abs(x - 2 - b[i]) < 0.01 || Math.abs(x - b[i]) > 1000));
}

// ─── Glass, rig and SVG draw ───

{
  const g = make("div");
  const gp = glassPanel(g, { at: 1, duration: 0.5, sheen: { at: 2, duration: 1 }, leave: { at: 4, duration: 0.5 } });
  const glaze = g.childNodes[0];
  gp.draw(0.5);
  check("glass: clear and unseen before it arrives", g.style.backdropFilter === "" && g.style.opacity === "0.000");
  gp.draw(1.6);
  check("glass: frosted, tinted and settled once in", g.style.backdropFilter === "blur(24.000px) saturate(1.600)" && glaze.style.opacity === "1.000" && g.style.translate === "0px 0.000px");
  check("glass: no lit rim unless asked", !glaze.style.boxShadow);
  gp.draw(2.5);
  check("glass: a sheen crosses mid-way", g.childNodes.at(-1).style.opacity === "1");
  gp.draw(4.6);
  check("glass: clears on leaving", g.style.backdropFilter === "" && g.style.opacity === "0.000");

  const home = container();
  const card = make("div");
  Object.assign(card, { offsetLeft: 900, offsetTop: 500, offsetWidth: 200, offsetHeight: 60 });
  home.appendChild(card);
  const tag = make("div");
  Object.assign(tag, { offsetWidth: 100, offsetHeight: 40 });
  home.appendChild(tag);
  const pin = attachTo(tag, card, { anchor: "top right", align: "bottom left", offset: { x: -16, y: 16 } });
  check("attach: pinned to its spot on the target", tag.style.transform === "translate(1084.000px, 476.000px)", tag.style.transform);
  card.offsetLeft = 1000;
  pin.draw(1);
  check("attach: follows when the target moves", tag.style.transform === "translate(1184.000px, 476.000px)");
  const adj = adjustment(container(), { keys: [{ at: 0, blur: 12, saturate: 0 }, { at: 0.8 }] });
  check("adjustment: blur and grey to start", adj.el.style.backdropFilter === "blur(12.000px) saturate(0.000)", adj.el.style.backdropFilter);
  adj.draw(0.8);
  check("adjustment: as is once its keys end", adj.el.style.backdropFilter === "");
  const flash = solid(container(), { color: "#ffffff", keys: [{ at: 2, opacity: 0 }, { at: 2.1, opacity: 1 }] });
  flash.draw(2.1);
  check("solid: a sheet of colour that fades", flash.el.style.opacity === "1.000" && (flash.draw(1), flash.el.style.opacity === "0.000"));

  const svgEl = make("svg");
  const line = make("path");
  line.setAttribute("d", "M0 0 L100 0");
  line.setAttribute("stroke", "#000000");
  const box = make("rect");
  box.setAttribute("fill", "#ff0000");
  svgEl.append(line, box);
  const sd = svgDraw(svgEl, { at: 0, duration: 1, stagger: 0.2, leave: { at: 3 } });
  check("svg: lines start undrawn", line.style.strokeDashoffset === "100.000" && box.style.strokeDashoffset === "1.000");
  check("svg: a shape with no line borrows its fill to draw with", box.style.stroke === "#ff0000" && box.style.strokeWidth === "2");
  sd.draw(sd.end + 0.01);
  check("svg: drawn, filled, and the borrowed line gone", line.style.strokeDashoffset === "0.000" && box.style.fillOpacity === "1.000" && box.style.strokeOpacity === "0.000");
  sd.draw(4);
  check("svg: draws off on leaving", line.style.strokeDashoffset === "100.000");
}

{
  const pill = make("div");
  Object.assign(pill, { offsetWidth: 400, offsetHeight: 160 });
  const lg = liquidGlass(pill, { at: 0.5, keys: [{ at: 1, x: 0 }, { at: 2, x: 300 }] });
  lg.draw(0.2);
  check("liquid glass: nothing before it arrives", pill.style.backdropFilter === "" && pill.style.opacity === "0.000");
  lg.draw(2);
  check("liquid glass: frost, light and its glide (frosted where it can't bend)", pill.style.backdropFilter.startsWith("blur(1.500px)") && pill.style.boxShadow.includes("inset 0 1px 1px") && pill.style.translate === "300.000px 0.000px");
}

// ─── Mesh gradient ───

{
  window.__film = { duration: 6 };
  const g = meshGradient(container(), { grain: 0.4 });
  const at = (t) => (g.draw(t), g.blobs.map((b) => b.style.transform).join("|"));
  check("gradient: loops exactly at the film's end and moves between", at(0) === at(6) && at(0) !== at(2));
  for (const name of ["aurora", "dusk", "mint", "peach", "ocean", "lilac", "ember"]) {
    const c = container();
    const pg = meshGradient(c, { preset: name });
    check(`gradient preset ${name}: its own ground and three colours`, c.style.background.startsWith("#") && pg.blobs.length === 3);
  }
  const sc = container();
  const star = meshGradient(sc, { preset: "star", period: 6 });
  const rays = sc.childNodes.find((n) => n.className === "mesh-rays");
  star.draw(6);
  check("gradient star: rays turn one ray's width a period, so it loops", Boolean(rays) && rays.style.background.includes("repeating-conic-gradient") && rays.style.transform.startsWith("rotate(15.000deg)"), rays?.style.transform);
}

// ─── The Effects page's preview scenes ───

window.__brand = { colors: { roles: { background: "#141414", surface: "#262626", ink: "#f2f2f2", muted: "#8a8a8a", accent: "#9747FF", onAccent: "#ffffff", line: "#2e2e2e" }, ramps: [] }, fonts: [], logos: [] };
for (const id of ["grid", "magnet", "gradient", "sphere", "carousel"]) {
  load(path.join(SCENES, `${id}.js`));
  let ok = true;
  let why = "";
  try {
    const { duration, still, parts } = window.preview(container());
    ok = duration > 0 && still >= 0 && still < duration && parts.length > 0;
    for (let t = 0; t <= duration; t += 0.25) for (const p of parts) p.draw(t);
  } catch (e) {
    ok = false;
    why = e.message;
  }
  check(`scene ${id}: builds and draws through its length`, ok, why);
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
