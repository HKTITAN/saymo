// Checks sketch on the frame (src/lib/studio/films/sketch.ts) without a
// browser: marks read as the right kind, simplifying keeps their shape, and
// the block Claude gets says what was drawn.
//
//   node scripts/studio/sketch-check.mjs

import { area, classify, describe, inside, pathLength, simplify, smoothPath } from "../../src/lib/studio/films/sketch.ts";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
};
const FRAME = { width: 1920, height: 1080 };
const circle = (cx, cy, r, from = 0, to = Math.PI * 2, n = 80) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / n;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });

// Kinds.
check("a circle is a loop", classify(circle(900, 500, 200), FRAME) === "loop");
check("a lasso that doesn't quite close is a loop", classify(circle(900, 500, 200, 0, Math.PI * 1.93), FRAME) === "loop");
check("a C shape is a line", classify(circle(900, 500, 200, 0, Math.PI * 1.2), FRAME) === "line");
const swoop = Array.from({ length: 50 }, (_, i) => ({ x: 200 + i * 30, y: 300 + Math.sin(i / 8) * 120 }));
check("a curve across the frame is a line", classify(swoop, FRAME) === "line");
const scribble = Array.from({ length: 60 }, (_, i) => ({ x: 800 + (i % 2 ? 60 : -60), y: 400 + i * 2 }));
check("a scribble folded on itself is a mark", classify(scribble, FRAME) === "mark", String(pathLength(scribble)));
check("a dot is a mark", classify([{ x: 10, y: 10 }, { x: 14, y: 12 }], FRAME) === "mark");

// Simplifying.
const corner = [...Array.from({ length: 30 }, (_, i) => ({ x: 100 + i * 10, y: 100 })), ...Array.from({ length: 30 }, (_, i) => ({ x: 400, y: 100 + i * 10 }))];
const s = simplify(corner);
check("simplify keeps a corner", s.length <= 4 && s.some((p) => Math.abs(p.x - 400) < 3 && Math.abs(p.y - 100) < 3), JSON.stringify(s));
check("simplify caps a long wiggle at 24 points", simplify(swoop.concat(swoop.map((p) => ({ x: p.x, y: p.y + 300 })))).length <= 24);
check("simplify rounds to whole pixels", simplify(swoop).every((p) => Number.isInteger(p.x) && Number.isInteger(p.y)));

// Inside and area.
const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
check("inside: the middle of a square", inside({ x: 50, y: 50 }, square));
check("inside: outside a square", !inside({ x: 150, y: 50 }, square));
check("area: a square", area(square) === 10000);
check("smoothPath draws a curve", smoothPath(swoop.slice(0, 5)).startsWith("M200 300 C"));

// What Claude reads.
const title = { x: 0, y: 0, id: "title", tag: "h1", text: "Launch day", rect: null };
const subtitle = { x: 0, y: 0, id: "subtitle", tag: "p", text: "Monday", rect: null };
const logo = { x: 0, y: 0, id: "logo", tag: "img", text: null, rect: null };
const text = describe({
  t: 2.4,
  picture: "refs/sketches/3.png",
  marks: [
    { kind: "loop", points: simplify(circle(900, 500, 200)), hits: { inside: [title, subtitle], start: null, end: null, crosses: [] } },
    { kind: "line", points: [{ x: 310, y: 240 }, { x: 900, y: 500 }, { x: 1520, y: 880 }], hits: { inside: [], start: logo, end: null, crosses: [logo, title] } },
    { kind: "mark", points: [{ x: 40, y: 50 }], hits: { inside: [], start: null, end: null, crosses: [] } },
  ],
});
check("describe: the time, count and picture", text.includes("At 2.40 s they drew 3 marks over the film (picture: refs/sketches/3.png)"), text.split("\n")[0]);
check("describe: a loop names what it circles", text.includes("1. A loop around #title and #subtitle."));
check("describe: a line says where it goes and keeps its points", text.includes("2. A line from #logo, heading right and down, to film pixel (1520, 880), over #title. 3 points") && text.includes("(310,240) (900,500) (1520,880)"));
check("describe: a mark says where it is", text.includes("3. A small mark near film pixel (40, 50)."));
check("describe: one mark is singular", describe({ t: 0, marks: [{ kind: "mark", points: [{ x: 1, y: 1 }], hits: { inside: [], start: null, end: null, crosses: [] } }] }).includes("drew 1 mark over"));

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
