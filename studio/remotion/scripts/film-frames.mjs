// Renders a studio film written in React (films/<id>/src/Film.jsx) to
// lossless PNG frames, for scripts/studio/render.mjs to encode. Prints a
// JSON line per frame on stdout: {"done":12,"total":240}.
//
// usage: node scripts/film-frames.mjs <film-dir> <out-dir> <spec.json> [--scale 2]
//   spec.json: { width, height, fps, duration, params }
//
// The film lives outside this folder, so its imports of remotion, react and
// any @remotion/* package are pointed here: one copy of each, the ones this
// folder pins.

import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderFrames, selectComposition } from "@remotion/renderer";
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
      },
    },
  }),
});
// The page's own console goes to stderr, for when a frame fails.
const onBrowserLog = ({ type, text }) => console.error(`[browser ${type}] ${text}`);
const inputProps = spec.params ?? {};
const composition = await selectComposition({ ...browser, serveUrl, id: "film", inputProps, onBrowserLog });
const total = composition.durationInFrames;

await renderFrames({
  ...browser,
  composition,
  serveUrl,
  outputDir,
  inputProps,
  imageFormat: "png",
  scale,
  onBrowserLog,
  onStart: () => {},
  onFrameUpdate: (done) => console.log(JSON.stringify({ done, total })),
});
