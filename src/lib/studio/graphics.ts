import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { GraphicInfo } from "./edit";
import { filmDir, isId, ROOT } from "./films";

// The motion graphics a video film can use: the studio's library
// (studio/graphics/) and the film's own (films/<id>/graphics/, which win on
// a shared name). Each is <name>.jsx with <name>.json beside it holding its
// label, default length and settings. scripts/studio/graphics-registry.mjs
// is the same list for the bundlers.

const LIBRARY = path.join(ROOT, "studio/graphics");

async function listIn(dir: string): Promise<GraphicInfo[]> {
  const names = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".jsx")).map((f) => f.slice(0, -4));
  const out: GraphicInfo[] = [];
  for (const name of names.sort()) {
    const meta = await readFile(path.join(dir, `${name}.json`), "utf8")
      .then((t) => JSON.parse(t) as Partial<GraphicInfo>)
      .catch(() => ({}) as Partial<GraphicInfo>);
    out.push({ name, label: meta.label ?? name, duration: meta.duration ?? 4, params: meta.params ?? [] });
  }
  return out;
}

export async function listGraphics(id?: string): Promise<GraphicInfo[]> {
  const all = new Map<string, GraphicInfo>();
  for (const g of await listIn(LIBRARY)) all.set(g.name, g);
  if (id && isId(id)) for (const g of await listIn(path.join(filmDir(id), "graphics"))) all.set(g.name, g);
  return [...all.values()];
}

export const graphicNames = async (id?: string) => (await listGraphics(id)).map((g) => g.name);
