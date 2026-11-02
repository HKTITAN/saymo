// Renders a studio film written in React (films/<id>/src/Film.jsx) to
// lossless PNG frames, for scripts/studio/render.mjs to encode. Prints a
// JSON line per frame on stdout: {"done":12,"total":240}.
//
// usage: node scripts/film-frames.mjs <film-dir> <out-dir> <spec.json> [--scale 2]
//   spec.json: { width, height, fps, duration, params, video? }
//   With `video` ({ output, draft }), a video film: an encoded MP4 with its
//   sound goes to `output` instead of frames to <out-dir>.
//
// "studio-kit" and "studio-graphics" point at the studio's kit and the
// film's graphics library (scripts/studio/graphics-registry.mjs).
//
// The film lives outside this folder, so its imports of remotion, react and
// any @remotion/* package are pointed here: one copy of each, the ones this
// folder pins.

import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderFrames, renderMedia, selectComposition } from "@remotion/renderer";
import { browser } from "../browser.js";

const [filmDir, outputDir, specFile] = process.argv.slice(2);
const at = process.argv.indexOf("--scale");
const scale = at > 0 ? Number(process.argv[at + 1]) : 1;
if (!filmDir || !outputDir || !specFile) {
  console.error("usage: node scripts/film-frames.mjs <film-dir> <out-dir> <spec.json> [--scale 2]");
  process.exit(1);
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const modules = path.join(root, "node_modules");
const require = createRequire(path.join(root, "package.json"));
const spec = JSON.parse(await readFile(specFile, "utf8"));
const { KIT, registrySource } = await import(path.join(root, "../../scripts/studio/graphics-registry.mjs"));
const graphicsModule = path.join(path.dirname(path.resolve(specFile)), "graphics.js");
await writeFile(graphicsModule, await registrySource(path.resolve(filmDir)));

// The entry: one composition, "film", sized from film.json.
const entry = path.join(path.dirname(path.resolve(specFile)), "entry.jsx");
await writeFile(
  entry,
  `import { Composition, registerRoot } from "remotion";
import Film from ${JSON.stringify(path.join(path.resolve(filmDir), "src/Film.jsx"))};
const Root = () => (
  <Composition id="film" component={Film} width={${spec.width}} height={${spec.height}}
    fps={${spec.fps}} durationInFrames={${Math.round(spec.duration * spec.fps)}}
    defaultProps={${JSON.stringify(spec.params ?? {})}} />
);
registerRoot(Root);
`,
);

await ensureBrowser(browser);
const serveUrl = await bundle({
  entryPoint: entry,
  rootDir: root,
  publicDir: path.join(path.resolve(filmDir), "public"),
  webpackOverride: (config) => ({
    ...config,
    resolve: {
      ...config.resolve,
      modules: [modules, "node_modules"],
      alias: {
        ...(config.resolve?.alias ?? {}),
        react: path.dirname(require.resolve("react/package.json")),
        "react-dom": path.dirname(require.resolve("react-dom/package.json")),
        remotion: path.dirname(require.resolve("remotion/package.json")),
        "studio-kit$": KIT,
        "studio-graphics$": graphicsModule,
      },
    },
  }),
});
// The page's own console goes to stderr, for when a frame fails.
const onBrowserLog = ({ type, text }) => console.error(`[browser ${type}] ${text}`);
const inputProps = spec.params ?? {};
const composition = await selectComposition({ ...browser, serveUrl, id: "film", inputProps, onBrowserLog });
const total = composition.durationInFrames;

const concurrency = Number(process.env.STUDIO_CONCURRENCY) || null;

if (spec.video) {
  // A video film: Remotion encodes the MP4 itself while it draws, sound
  // mixed in, tagged BT.709 like every studio file. Much quicker for
  // footage than lossless frames encoded afterwards.
  await renderMedia({
    ...browser,
    composition,
    serveUrl,
    inputProps,
    codec: "h264",
    crf: spec.video.draft ? 18 : 14,
    x264Preset: spec.video.draft ? "veryfast" : "slow",
    pixelFormat: "yuv420p",
    colorSpace: "bt709",
    audioCodec: "aac",
    audioBitrate: "320k",
    enforceAudioTrack: true,
    scale,
    concurrency,
    outputLocation: spec.video.output,
    onBrowserLog,
    onProgress: ({ renderedFrames, encodedFrames }) =>
      console.log(JSON.stringify({ done: Math.round((renderedFrames + encodedFrames) / 2), total })),
  });
} else {
  await renderFrames({
    ...browser,
    composition,
    serveUrl,
    outputDir,
    inputProps,
    imageFormat: "png",
    concurrency,
    scale,
    onBrowserLog,
    onStart: () => {},
    onFrameUpdate: (done) => console.log(JSON.stringify({ done, total })),
  });
}
