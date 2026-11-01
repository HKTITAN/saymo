// Renders one composition to lossless PNG frames, for
// scripts/studio/render.mjs to encode. Prints a JSON line per frame on
// stdout: {"done":12,"total":240}.
//
// usage: node scripts/frames.mjs <composition> <out-dir> [--scale 2]

import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderFrames, selectComposition } from "@remotion/renderer";
import { browser } from "../browser.js";

const [id, outputDir] = process.argv.slice(2);
const at = process.argv.indexOf("--scale");
const scale = at > 0 ? Number(process.argv[at + 1]) : 1;
if (!id || !outputDir) {
  console.error("usage: node scripts/frames.mjs <composition> <out-dir> [--scale 2]");
  process.exit(1);
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
await ensureBrowser(browser);
const serveUrl = await bundle({
  entryPoint: path.join(root, "src/index.js"),
  rootDir: root,
  publicDir: path.join(root, "public"),
});
// The page's own console goes to stderr, for when a frame fails.
const onBrowserLog = ({ type, text }) => console.error(`[browser ${type}] ${text}`);
const composition = await selectComposition({ ...browser, serveUrl, id, inputProps: {}, onBrowserLog });
const total = composition.durationInFrames;

await renderFrames({
  ...browser,
  composition,
  serveUrl,
  outputDir,
  inputProps: {},
  imageFormat: "png",
  scale,
  onBrowserLog,
  onStart: () => {},
  onFrameUpdate: (done) => console.log(JSON.stringify({ done, total })),
});
