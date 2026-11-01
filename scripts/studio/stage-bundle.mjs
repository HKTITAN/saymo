// Bundles the stage for a React film: the Remotion Player around the film's
// src/Film.jsx, driven by the studio's bridge (window.__studioStage). Run by
// the stage route when the film's code changes; takes a fraction of a second.
//
// usage: node scripts/studio/stage-bundle.mjs <film-dir> <out.js>
//
// The film lives outside studio/remotion, so every bare import (react,
// remotion, @remotion/*) resolves from there: one copy of each.

import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REMOTION = path.join(ROOT, "studio/remotion");
const require = createRequire(path.join(REMOTION, "package.json"));
const esbuild = require("esbuild");

const [filmDir, outFile] = process.argv.slice(2);
if (!filmDir || !outFile) {
  console.error("usage: node scripts/studio/stage-bundle.mjs <film-dir> <out.js>");
  process.exit(1);
}

const entry = `
import { Player } from "@remotion/player";
import { createElement, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Film from ${JSON.stringify(path.join(path.resolve(filmDir), "src/Film.jsx"))};

const F = window.__film;
const stage = window.__studioStage;
const frames = Math.max(1, Math.round(F.duration * F.fps));

function Stage() {
  const player = useRef(null);
  const [params, setParams] = useState(() => ({ ...window.__params }));
  useEffect(() => {
    stage.register({
      seek: (t) => player.current?.seekTo(Math.min(frames - 1, Math.round(t * F.fps))),
      params: (values) => setParams((p) => ({ ...p, ...values })),
    });
    const fonts = document.fonts ? document.fonts.ready : Promise.resolve();
    fonts.then(() => requestAnimationFrame(() => stage.ready()));
  }, []);
  return createElement(Player, {
    ref: player,
    component: Film,
    inputProps: params,
    durationInFrames: frames,
    fps: F.fps,
    compositionWidth: F.width,
    compositionHeight: F.height,
    style: { width: F.width, height: F.height },
    controls: false,
    clickToPlay: false,
    doubleClickToFullscreen: false,
    spaceKeyToPlayOrPause: false,
    acknowledgeRemotionLicense: true,
    errorFallback: ({ error }) => {
      stage.error(error?.message ?? "The film stopped with an error.");
      return null;
    },
  });
}

createRoot(document.getElementById("root")).render(createElement(Stage));
`;

// Bare imports resolve from studio/remotion, relative ones from the film.
const fromRemotion = {
  name: "from-remotion",
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, async (args) => {
      if (args.pluginData === "inner") return undefined;
      const result = await build.resolve(args.path, { resolveDir: REMOTION, kind: args.kind, pluginData: "inner" });
      return result.errors.length ? { errors: result.errors } : result;
    });
  },
};

try {
  const result = await esbuild.build({
    stdin: { contents: entry, resolveDir: path.resolve(filmDir), sourcefile: "stage.jsx", loader: "jsx" },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    jsx: "automatic",
    loader: { ".js": "jsx", ".jsx": "jsx", ".png": "dataurl", ".svg": "dataurl", ".json": "json" },
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [fromRemotion],
    logLevel: "silent",
  });
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, result.outputFiles[0].contents);
} catch (error) {
  const first = error.errors?.[0];
  const where = first?.location ? ` (${path.basename(first.location.file)} line ${first.location.line})` : "";
  console.error(`${first?.text ?? error.message}${where}`);
  process.exit(1);
}
