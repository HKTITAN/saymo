// The sound engine's page, shared by the sound renderer (sound.mjs) and the
// score converter (convert-score.mjs): bundles studio/sound with esbuild,
// serves it from this Mac and opens it in headless Chrome.
//
// Two builds:
//   product    studio/sound/engine.js: Tone.js and the studio's own music
//              bed only. Never includes Strudel (AGPL-3.0).
//   in-house   studio/sound/inhouse.js: the same plus Strudel, so films
//              scored in Strudel before the bed still play. Used when the
//              edition is in-house (the default) and studio/sound/strudel
//              is installed; otherwise the product build is used.
//
// The edition comes from STUDIO_EDITION, as in src/lib/studio/server/edition.ts.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ENGINE_DIR = path.join(ROOT, "studio/sound");
const STRUDEL_DIR = path.join(ENGINE_DIR, "strudel");
const CACHE = path.join(ROOT, "node_modules/.cache/studio-sound");

export const IS_PRODUCT = process.env.STUDIO_EDITION === "product";

// Can this build play old Strudel scores? Strudel is installed in
// studio/sound/strudel; a Mac set up before it moved there still has it in
// studio/sound/node_modules, which the bundler finds just as well.
export const hasStrudel = () =>
  !IS_PRODUCT &&
  (existsSync(path.join(STRUDEL_DIR, "node_modules/@strudel/core")) || existsSync(path.join(ENGINE_DIR, "node_modules/@strudel/core")));

// Strudel's published build carries its audio worklets inline, as base64
// modules. Worklets keep their own Math.random (the supersaw's starting
// phases), so each one gets the same seeded generator as the page.
const SEEDED = `Math.random=(()=>{let s=7;return()=>{s|=0;s=(s+0x6d2b79f5)|0;let t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296}})();\n`;
const seedWorklets = {
  name: "seed-worklets",
  setup(build) {
    build.onLoad({ filter: /(superdough|supradough)[\\/]dist[\\/]index\.mjs$/ }, async (a) => {
      const text = await readFile(a.path, "utf8");
      const contents = text.replace(/data:text\/javascript;base64,([A-Za-z0-9+/=]{200,})/g, (_, b64) => {
        const source = Buffer.from(b64, "base64").toString("utf8");
        return `data:text/javascript;base64,${Buffer.from(SEEDED + source).toString("base64")}`;
      });
      return { contents, loader: "js" };
    });
  },
};

// The product build refuses Strudel outright, so a stray import can't
// slip AGPL code into it.
const noStrudel = {
  name: "no-strudel",
  setup(build) {
    build.onResolve({ filter: /^(@strudel|@kabelsalat|superdough|supradough)(\/|$)|[\\/]strudel[\\/]/ }, (a) => ({
      errors: [{ text: `The product build of the sound engine can't include Strudel (${a.path}, from ${a.importer}).` }],
    }));
  },
};

// Bundled once per build and kept until the engine or its packages change.
// Returns the script and the files that went into it.
export async function engineBundle() {
  const strudel = hasStrudel();
  const entry = path.join(ENGINE_DIR, strudel ? "inhouse.js" : "engine.js");
  const sources = [
    entry,
    path.join(ENGINE_DIR, "engine.js"),
    path.join(ENGINE_DIR, "bed.js"),
    path.join(ENGINE_DIR, "package-lock.json"),
    fileURLToPath(import.meta.url),
    ...(strudel ? [path.join(STRUDEL_DIR, "music.js"), path.join(STRUDEL_DIR, "package-lock.json")] : []),
  ];
  const stamp = createHash("sha1");
  for (const f of sources) stamp.update(`${f}:${(await stat(f).catch(() => ({ mtimeMs: 0 }))).mtimeMs}`);
  const name = `engine-${strudel ? "inhouse" : "product"}-${stamp.digest("hex").slice(0, 12)}`;
  const file = path.join(CACHE, `${name}.js`);
  const meta = path.join(CACHE, `${name}.inputs.json`);
  if (existsSync(file) && existsSync(meta)) {
    return { script: await readFile(file, "utf8"), inputs: JSON.parse(await readFile(meta, "utf8")), strudel };
  }
  if (!existsSync(path.join(ENGINE_DIR, "node_modules"))) {
    throw new Error("The sound engine isn't installed. Run: npm ci --prefix studio/sound");
  }
  const { build } = await import(path.join(ENGINE_DIR, "node_modules/esbuild/lib/main.js"));
  await mkdir(CACHE, { recursive: true });
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "chrome120",
    outfile: file,
    absWorkingDir: ENGINE_DIR,
    nodePaths: [path.join(ENGINE_DIR, "node_modules")],
    logLevel: "silent",
    legalComments: "none",
    metafile: true,
    plugins: strudel ? [seedWorklets] : [noStrudel],
  });
  const inputs = Object.keys(result.metafile.inputs);
  await writeFile(meta, JSON.stringify(inputs));
  return { script: await readFile(file, "utf8"), inputs, strudel };
}

// The page is served from this Mac (a real origin, so worklets and module
// imports behave as they do in the studio).
export function servePage(script) {
  const html = `<!doctype html><meta charset="utf-8"><title>sound</title><script type="module" src="/engine.js"></script>`;
  const server = http.createServer((req, res) => {
    if (req.url === "/engine.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(script);
    } else {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    }
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() })),
  );
}

// Opens the engine page in headless Chrome. Call close() when done.
export async function openEngine() {
  const { script, inputs, strudel } = await engineBundle();
  const server = await servePage(script);
  const { chromium } = await import(path.join(ROOT, "node_modules/playwright/index.mjs"));
  const browser = await chromium.launch({ channel: "chrome", args: ["--autoplay-policy=no-user-gesture-required"] });
  const logs = [];
  try {
    const page = await browser.newPage();
    page.on("console", (m) => {
      if (m.type() === "warning" || m.type() === "error") logs.push(m.text());
    });
    page.on("pageerror", (e) => logs.push(String(e)));
    await page.goto(server.url, { waitUntil: "load" });
    await page.waitForFunction(() => window.__sound, null, { timeout: 30000 });
    return {
      page,
      logs,
      inputs,
      strudel,
      close: async () => {
        await browser.close();
        server.close();
      },
    };
  } catch (e) {
    await browser.close();
    server.close();
    throw e;
  }
}
