// The picture that goes with a sketch: the frame at the moment it was drawn,
// with the marks on top, saved in the film as refs/sketches/<n>.png so
// Claude can look at it (sketch.ts, docs/plans/sketch-on-the-frame.md).

import { spawn } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Film } from "./contract";
import { filmDir, ROOT } from "./films";
import { type SketchContext, smoothPath } from "./sketch";

const INK = "#ec79a9"; // the studio's accent, as the marks are drawn on the stage

const run = (args: string[]) =>
  new Promise<boolean>((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: "ignore" });
    const timer = setTimeout(() => child.kill(), 45_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
    child.on("error", () => resolve(false));
  });

// The marks as SVG at the film's size: a smooth line each, an arrowhead on
// lines, and loops closed.
function marksSvg(sketch: SketchContext, width: number, height: number) {
  const w = Math.max(4, Math.round(Math.min(width, height) / 160));
  const paths = sketch.marks.map((m) => {
    const pts = m.kind === "loop" ? [...m.points, m.points[0]] : m.points;
    let d = smoothPath(pts);
    if (m.kind === "line" && pts.length >= 2) {
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const head = w * 4;
      const p1 = { x: b.x - head * Math.cos(angle - 0.5), y: b.y - head * Math.sin(angle - 0.5) };
      const p2 = { x: b.x - head * Math.cos(angle + 0.5), y: b.y - head * Math.sin(angle + 0.5) };
      d += ` M${p1.x.toFixed(1)} ${p1.y.toFixed(1)} L${b.x} ${b.y} L${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${paths.join("")}</svg>`;
}

// Makes the picture and returns its path inside the film, or null if the
// frame couldn't be taken (the sketch still goes, as words).
export async function sketchPicture(film: Film, sketch: SketchContext, studioUrl: string): Promise<string | null> {
  const dir = path.join(filmDir(film.id), "refs", "sketches");
  await mkdir(dir, { recursive: true });
  const taken = (await readdir(dir).catch(() => [] as string[])).map((f) => Number(/^(\d+)\.png$/.exec(f)?.[1])).filter(Number.isFinite);
  const n = (taken.length ? Math.max(...taken) : 0) + 1;
  const frame = path.join(dir, `.frame-${n}.png`);
  const out = path.join(dir, `${n}.png`);
  const ok = await run(["scripts/studio/still.mjs", film.id, String(sketch.t), frame, studioUrl]);
  const width = Math.round(film.width);
  const height = Math.round(film.height);
  try {
    const base = ok ? sharp(frame) : sharp({ create: { width, height, channels: 3, background: "#141414" } });
    await base
      .composite([{ input: Buffer.from(marksSvg(sketch, width, height)) }])
      .png()
      .toFile(out);
    return `refs/sketches/${n}.png`;
  } catch {
    return null;
  } finally {
    await rm(frame, { force: true });
  }
}
