// Bundles the stage for a React film: the Remotion Player around the film's
// src/Film.jsx, driven by the studio's bridge (window.__studioStage). Run by
// the stage route when the film's code changes; takes a fraction of a second.
//
// usage: node scripts/studio/stage-bundle.mjs <film-dir> <out.js>
//
// The film lives outside studio/remotion, so every bare import (react,
// remotion, @remotion/*) resolves from there: one copy of each.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REMOTION = path.join(ROOT, "studio/remotion");
const require = createRequire(path.join(REMOTION, "package.json"));
const esbuild = require("esbuild");
const { KIT, registrySource } = await import("./graphics-registry.mjs");

const [filmDir, outFile] = process.argv.slice(2);
if (!filmDir || !outFile) {
  console.error("usage: node scripts/studio/stage-bundle.mjs <film-dir> <out.js>");
  process.exit(1);
}

const film = JSON.parse(await readFile(path.join(filmDir, "film.json"), "utf8").catch(() => "{}"));

const motionEntry = `
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

// A video film: the edit and the files come from the page (window.__edit,
// window.__media) and the edit changes live as it's cut. While the studio
// plays (its seeks advance in step with the clock) the Player plays for
// real, so the footage is heard; any jump or stop takes it back to seeking.
const videoEntry = `
import { Player } from "@remotion/player";
import { createElement, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Film from ${JSON.stringify(path.join(path.resolve(filmDir), "src/Film.jsx"))};

const F = window.__film;
const stage = window.__studioStage;
const ID = window.__filmId;

function endOf(edit) {
  let end = 0;
  for (const track of edit?.tracks ?? []) {
    for (const item of track.items) {
      const length = item.type === "clip" ? (item.to - item.from) / (item.speed ?? 1) : item.duration;
      end = Math.max(end, item.start + length);
    }
  }
  return end;
}
const framesOf = (edit) => Math.max(1, Math.round(Math.max(endOf(edit), 1 / F.fps) * F.fps));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function Stage() {
  const player = useRef(null);
  const [params, setParams] = useState(() => ({ ...window.__params }));
  const [edit, setEdit] = useState(() => window.__edit);
  const [media, setMedia] = useState(() => window.__media ?? {});
  const frames = framesOf(edit);
  F.duration = frames / F.fps;

  useEffect(() => {
    let lastWall = 0;
    let lastT = 0;
    let stopTimer = 0;
    const toFrame = (t) => Math.min(framesOf(editRef.current) - 1, Math.max(0, Math.round(t * F.fps)));
    stage.register({
      seek(t) {
        const p = player.current;
        if (!p) return;
        const now = performance.now();
        const wall = (now - lastWall) / 1000;
        const step = t - lastT;
        lastWall = now;
        lastT = t;
        clearTimeout(stopTimer);
        stopTimer = setTimeout(() => {
          if (p.isPlaying()) p.pause();
          p.seekTo(toFrame(lastT));
        }, 150);
        const advancing = wall > 0 && wall < 0.12 && step > 0 && Math.abs(step - wall) < 0.06;
        if (advancing) {
          if (!p.isPlaying()) {
            p.seekTo(toFrame(t));
            p.play();
          } else if (Math.abs(p.getCurrentFrame() / F.fps - t) > 0.25) p.seekTo(toFrame(t));
          return;
        }
        if (p.isPlaying()) p.pause();
        p.seekTo(toFrame(t));
      },
      params: (values) => setParams((p) => (Object.keys(values).every((k) => p[k] === values[k]) ? p : { ...p, ...values })),
      edit: (next) => setEdit((e) => (same(e, next) ? e : next)),
    });
    const fonts = document.fonts ? document.fonts.ready : Promise.resolve();
    fonts.then(() => requestAnimationFrame(() => stage.ready()));
  }, []);
  const editRef = useRef(edit);
  editRef.current = edit;

  // Files the edit uses that the stage doesn't have yet (still coming in):
  // look again until they're ready.
  useEffect(() => {
    // Clips whose file isn't here yet, or whose cutout is still being made.
    const wanted = (edit?.tracks ?? []).flatMap((t) => t.items).filter((i) => i.type === "clip" && (!media[i.media] || (i.cutout && !media[i.media].cutout)));
    if (!wanted.length) return;
    const timer = setInterval(async () => {
      const res = await fetch("/api/studio/films/" + ID + "/media", { cache: "no-store" }).catch(() => null);
      if (!res?.ok) return;
      const next = {};
      for (const m of await res.json()) {
        if (m.status !== "ready" || !m.proxy) continue;
        const at = "/api/studio/films/" + ID + "/media/" + m.id + "/";
        next[m.id] = { src: at + m.proxy, cutout: m.cutout ? at + m.cutout : null, kind: m.kind, width: m.width, height: m.height, name: m.name };
      }
      setMedia((old) => (same(old, next) ? old : next));
    }, 1500);
    return () => clearInterval(timer);
  }, [edit, media]);

  return createElement(Player, {
    ref: player,
    component: Film,
    inputProps: { ...params, edit, media },
    durationInFrames: frames,
    fps: F.fps,
    compositionWidth: F.width,
    compositionHeight: F.height,
    style: { width: F.width, height: F.height },
    controls: false,
    clickToPlay: false,
    doubleClickToFullscreen: false,
    spaceKeyToPlayOrPause: false,
    numberOfSharedAudioTags: 0,
    acknowledgeRemotionLicense: true,
    errorFallback: ({ error }) => {
      stage.error(error?.message ?? "The film stopped with an error.");
      return null;
    },
  });
}

createRoot(document.getElementById("root")).render(createElement(Stage));
`;

const entry = film.kind === "video" ? videoEntry : motionEntry;

// "studio-kit" is the kit; "studio-graphics" the film's graphics library.
const studio = {
  name: "studio",
  setup(build) {
    build.onResolve({ filter: /^studio-kit$/ }, () => ({ path: KIT }));
    build.onResolve({ filter: /^studio-graphics$/ }, () => ({ path: "graphics", namespace: "studio-graphics" }));
    build.onLoad({ filter: /.*/, namespace: "studio-graphics" }, async () => ({
      contents: await registrySource(path.resolve(filmDir)),
      loader: "js",
      resolveDir: ROOT,
    }));
  },
};

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
    plugins: [studio, fromRemotion],
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
