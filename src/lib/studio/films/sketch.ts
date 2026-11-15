// Sketch on the frame: marks drawn over the paused film, read as loops
// (which select what they circle), lines (paths things can move along) or
// plain marks, and written up for Claude. Plain TypeScript with no `@/`
// imports, shared by the studio page, the stage bridge's caller and the
// checks (scripts/studio/sketch-check.mjs). The plan is
// docs/plans/sketch-on-the-frame.md.

import type { Picked } from "./contract.ts";

export type Pt = { x: number; y: number }; // film pixels
export type MarkKind = "loop" | "line" | "mark";

// What the stage found under a mark: for a loop, the parts mostly inside
// it; for a line, the parts at its two ends and the ones it crosses.
export type MarkHits = { inside: Picked[]; start: Picked | null; end: Picked | null; crosses: Picked[] };

export type SketchMark = { kind: MarkKind; points: Pt[]; hits: MarkHits };

// A sketch as it goes with a message: when it was drawn, its marks, and the
// picture of the frame with the marks on it (a path inside the film).
export type SketchContext = { t: number; marks: SketchMark[]; picture?: string };

export const MAX_POINTS = 24;

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function pathLength(points: Pt[]): number {
  let n = 0;
  for (let i = 1; i < points.length; i++) n += dist(points[i - 1], points[i]);
  return n;
}

// Area enclosed by a closed path (shoelace), always positive.
export function area(points: Pt[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

const lineDistance = (p: Pt, a: Pt, b: Pt) => {
  const l = dist(a, b);
  if (l === 0) return dist(p, a);
  return Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / l;
};

function rdp(points: Pt[], tolerance: number): Pt[] {
  if (points.length < 3) return points;
  let worst = 0;
  let at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = lineDistance(points[i], points[0], points[points.length - 1]);
    if (d > worst) {
      worst = d;
      at = i;
    }
  }
  if (worst <= tolerance) return [points[0], points[points.length - 1]];
  return [...rdp(points.slice(0, at + 1), tolerance).slice(0, -1), ...rdp(points.slice(at), tolerance)];
}

// The fewest points that keep the shape (corners stay), at most `max`,
// rounded to whole film pixels.
export function simplify(points: Pt[], max = MAX_POINTS): Pt[] {
  if (points.length <= 2) return points.map(roundPt);
  let tolerance = 1.5;
  let out = rdp(points, tolerance);
  while (out.length > max) {
    tolerance *= 1.5;
    out = rdp(points, tolerance);
  }
  return out.map(roundPt);
}
const roundPt = (p: Pt): Pt => ({ x: Math.round(p.x), y: Math.round(p.y) });

// What a mark is, from its shape alone:
//   loop  its ends meet and it encloses real area (a circle, a lasso)
//   mark  too small to mean anything, or a scribble folded on itself
//   line  anything else: a stroke from somewhere to somewhere
export function classify(points: Pt[], frame: { width: number; height: number }): MarkKind {
  const length = pathLength(points);
  const diagonal = Math.hypot(frame.width, frame.height);
  if (points.length < 2 || length < diagonal * 0.02) return "mark";
  const gap = dist(points[0], points[points.length - 1]);
  const closed = gap <= Math.max(12, length * 0.12);
  // A circle encloses length² / 4π; a lasso a fair share of that.
  if (closed && area(points) >= (0.25 * length * length) / (4 * Math.PI)) return "loop";
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const box = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (box < length * 0.25) return "mark";
  return "line";
}

// Whether a point is inside a closed path (ray casting).
export function inside(p: Pt, polygon: Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

// A smooth path through the points (Catmull-Rom), for drawing a mark.
export function smoothPath(points: Pt[]): string {
  if (!points.length) return "";
  if (points.length < 3) return `M${points.map((p) => `${p.x} ${p.y}`).join(" L")}`;
  let d = `M${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

// ─── For Claude ──────────────────────────────────────────────────────────────

const part = (p: Picked) => (p.id ? `#${p.id}` : p.tag ? `a <${p.tag}>` : "a part") + (p.text && !p.id ? ` showing "${p.text}"` : "");
const list = (ps: Picked[]) => {
  const names = ps.map(part);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};
const heading = (a: Pt, b: Pt) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const h = Math.abs(dx) < Math.abs(dy) * 0.4 ? "" : dx > 0 ? "right" : "left";
  const v = Math.abs(dy) < Math.abs(dx) * 0.4 ? "" : dy > 0 ? "down" : "up";
  return [h, v].filter(Boolean).join(" and ") || "in place";
};

// The <sketch> block that goes with the message.
export function describe(sketch: SketchContext): string {
  const lines = sketch.marks.map((m, i) => {
    const n = `${i + 1}.`;
    if (m.kind === "loop") {
      return m.hits.inside.length
        ? `${n} A loop around ${list(m.hits.inside)}.`
        : `${n} A loop around an empty area, about (${box(m.points)}).`;
    }
    if (m.kind === "mark") return `${n} A small mark near film pixel (${m.points[0]?.x ?? 0}, ${m.points[0]?.y ?? 0}).`;
    const a = m.points[0];
    const b = m.points[m.points.length - 1];
    const from = m.hits.start ? `from ${part(m.hits.start)}` : `from film pixel (${a.x}, ${a.y})`;
    const to = m.hits.end ? `to ${part(m.hits.end)}` : `to film pixel (${b.x}, ${b.y})`;
    const over = m.hits.crosses.filter((c) => c.id !== m.hits.start?.id && c.id !== m.hits.end?.id);
    return `${n} A line ${from}, heading ${heading(a, b)}, ${to}${over.length ? `, over ${list(over)}` : ""}. ${m.points.length} points in film pixels, in order: ${m.points.map((p) => `(${p.x},${p.y})`).join(" ")}`;
  });
  const count = `${sketch.marks.length} mark${sketch.marks.length === 1 ? "" : "s"}`;
  const pic = sketch.picture ? ` (picture: ${sketch.picture})` : "";
  return `<sketch>At ${sketch.t.toFixed(2)} s they drew ${count} over the film${pic}.\n${lines.join("\n")}\n"This", "these" and "here" mean the marked parts and places. A line is a path: keep its shape and direction if something should move along it.</sketch>`;
}

function box(points: Pt[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return `x ${Math.min(...xs)} to ${Math.max(...xs)}, y ${Math.min(...ys)} to ${Math.max(...ys)}`;
}

// ─── Checking what the page sends ────────────────────────────────────────────

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) || null : null);

function cleanPicked(raw: unknown): Picked | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const r = p.rect as Record<string, unknown> | null | undefined;
  return {
    x: num(p.x) ?? 0,
    y: num(p.y) ?? 0,
    id: str(p.id, 80),
    tag: str(p.tag, 20),
    text: str(p.text, 80),
    rect: r && typeof r === "object" ? { x: num(r.x) ?? 0, y: num(r.y) ?? 0, width: num(r.width) ?? 0, height: num(r.height) ?? 0 } : null,
  };
}

// Only what's expected, so nothing odd reaches the prompt: up to 20 marks
// of up to 24 points, each inside the frame give or take a margin.
export function cleanSketch(raw: unknown, frame: { width: number; height: number }): SketchContext | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const t = num(s.t);
  if (t === null || !Array.isArray(s.marks)) return null;
  const margin = Math.max(frame.width, frame.height);
  const marks: SketchMark[] = [];
  for (const m of s.marks.slice(0, 20)) {
    if (!m || typeof m !== "object") continue;
    const mk = m as Record<string, unknown>;
    if (mk.kind !== "loop" && mk.kind !== "line" && mk.kind !== "mark") continue;
    const points = (Array.isArray(mk.points) ? mk.points : [])
      .slice(0, MAX_POINTS)
      .map((p) => ({ x: num((p as Pt)?.x), y: num((p as Pt)?.y) }))
      .filter((p): p is Pt => p.x !== null && p.y !== null && Math.abs(p.x) <= margin * 2 && Math.abs(p.y) <= margin * 2)
      .map(roundPt);
    if (!points.length) continue;
    const h = (mk.hits ?? {}) as Record<string, unknown>;
    const many = (v: unknown) => (Array.isArray(v) ? v.slice(0, 12).map(cleanPicked).filter((p): p is Picked => p !== null) : []);
    marks.push({ kind: mk.kind, points, hits: { inside: many(h.inside), start: cleanPicked(h.start), end: cleanPicked(h.end), crosses: many(h.crosses) } });
  }
  return marks.length ? { t: Math.max(0, t), marks } : null;
}
