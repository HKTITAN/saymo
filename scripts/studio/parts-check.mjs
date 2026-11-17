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
/* global gridField -- defined by the effect file load() runs below */

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

for (const f of ["grid", "sphere"]) load(path.join(PARTS, `${f}.js`));

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

// ─── The Effects page's preview scenes ───

window.__brand = { colors: { roles: { background: "#141414", surface: "#262626", ink: "#f2f2f2", muted: "#8a8a8a", accent: "#9747FF", onAccent: "#ffffff", line: "#2e2e2e" }, ramps: [] }, fonts: [], logos: [] };
for (const id of ["grid", "sphere"]) {
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
