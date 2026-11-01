// The motion graphics a video film can place on its timeline: the studio's
// own (studio/graphics/) and any the film has of its own (films/<id>/
// graphics/, which win on a shared name). Each is <name>.jsx (the default
// export is the component, given { values, duration }) beside <name>.json
// ({ label, duration, params }).
//
// The stage bundler and the renderer both point the import "studio-graphics"
// at a module made here, and "studio-kit" at studio/kit/index.jsx.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const LIBRARY = path.join(ROOT, "studio/graphics");
export const KIT = path.join(ROOT, "studio/kit/index.jsx");

async function listIn(dir) {
  const names = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".jsx")).map((f) => f.slice(0, -4));
  const out = [];
  for (const name of names.sort()) {
    const json = path.join(dir, `${name}.json`);
    let meta = { label: name, duration: 4, params: [] };
    if (existsSync(json)) {
      try {
        meta = { ...meta, ...JSON.parse(await readFile(json, "utf8")) };
      } catch {}
    }
    out.push({ name, file: path.join(dir, `${name}.jsx`), meta });
  }
  return out;
}

export async function graphicsOf(filmDir) {
  const all = new Map();
  for (const g of await listIn(LIBRARY)) all.set(g.name, g);
  if (filmDir) for (const g of await listIn(path.join(filmDir, "graphics"))) all.set(g.name, g);
  return [...all.values()];
}

// The module's source: { [name]: { Component, meta } }.
export async function registrySource(filmDir) {
  const graphics = await graphicsOf(filmDir);
  const imports = graphics.map((g, i) => `import G${i} from ${JSON.stringify(g.file)};`).join("\n");
  const entries = graphics.map((g, i) => `  ${JSON.stringify(g.name)}: { Component: G${i}, meta: ${JSON.stringify(g.meta)} },`).join("\n");
  return `${imports}\nexport default {\n${entries}\n};\n`;
}
