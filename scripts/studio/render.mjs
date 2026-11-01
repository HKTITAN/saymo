// Renders one composition from studio/compositions.json, in whichever engine
// made it (Remotion, HyperFrames or fframes), into studio/out/.
//
// Every engine hands over lossless frames (PNGs, or an FFV1 master from
// fframes), and one ffmpeg makes both files from them exactly as
// `npm run export` does: H.264 at CRF 14, 60 fps, tagged BT.709, the 1080p
// copy being the 4K frames at half size.
//
// usage: node scripts/studio/render.mjs <id>           studio/out/<id>-4k.mp4
//                                                      and <id>-1080p.mp4
//        node scripts/studio/render.mjs <id> --draft   studio/out/<id>-draft.mp4,
//                                                      1080p and quick
//
// Prints `progress <percent>` lines on stdout while it works, then
// `wrote <path>` for each file. Engine output is shown only if it fails.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "studio/out");
const FPS = 60;

// The same encoding as scripts/export.mjs.
const HALF = "scale=1920:1080:flags=area";
const TO_VIDEO =
  "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p," +
  "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv";
const x264 = (level, draft = false) => [
  "-c:v", "libx264", "-preset", draft ? "veryfast" : "slow", "-crf", draft ? "18" : "14",
  "-tune", "animation", "-level:v", level, "-movflags", "+faststart",
];

const args = process.argv.slice(2);
const draft = args.includes("--draft");
const id = args.find((a) => !a.startsWith("--"));
const manifest = JSON.parse(await readFile(path.join(ROOT, "studio/compositions.json"), "utf8"));
const entry = manifest.find((c) => c.id === id);
if (!entry) {
  console.error(`usage: node scripts/studio/render.mjs <id> [--draft]\nids: ${manifest.map((c) => c.id).join(", ")}`);
  process.exit(1);
}

// Progress: the engine's frames are the first 80%, encoding the rest.
let shown = -1;
const progress = (fraction) => {
  const percent = Math.max(0, Math.min(100, Math.floor(fraction * 100)));
  if (percent > shown) console.log(`progress ${(shown = percent)}`);
};

// Runs a command, handing each line it prints to `onLine`. Keeps the last
// lines to show if it fails.
const run = (cmd, argv, { cwd, env, onLine = () => {}, input } = {}) =>
  new Promise((resolve, reject) => {
    const proc = spawn(cmd, argv, {
      cwd,
      env: { ...process.env, ...env },
      stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
    });
    const tail = [];
    const read = (stream) => {
      let rest = "";
      stream.on("data", (chunk) => {
        const lines = (rest + chunk).split(/\r?\n|\r/);
        rest = lines.pop();
        for (const line of lines) {
          tail.push(line);
          if (tail.length > 40) tail.shift();
          onLine(line);
        }
      });
    };
    read(proc.stdout);
    read(proc.stderr);
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} failed (exit ${code}):\n${tail.join("\n")}`)),
    );
    if (input) input(proc.stdin).catch(reject);
  });

const json = (line) => {
  try {
    return JSON.parse(line.slice(line.indexOf("{")));
  } catch {
    return null;
  }
};

const cargo = () => {
  const own = path.join(homedir(), ".cargo/bin/cargo");
  return existsSync(own) ? own : "cargo";
};

// Each engine renders lossless frames into `work` and says where they are:
// { pngs: [paths] } or { video: path }.
const ENGINES = {
  async remotion(work) {
    const frames = path.join(work, "frames");
    await run("node", ["scripts/frames.mjs", entry.composition, frames, "--scale", draft ? "1" : "2"], {
      cwd: path.join(ROOT, entry.dir),
      onLine: (line) => {
        const p = json(line);
        if (p?.total) progress((0.8 * p.done) / p.total);
      },
    });
    return { pngs: await pngsIn(frames) };
  },

  async hyperframes(work) {
    const frames = path.join(work, "frames");
    // The CLI pinned in studio/hyperframes/package.json.
    const home = path.join(ROOT, "studio/hyperframes");
    const cli = path.join(home, "node_modules/.bin/hyperframes");
    await run(
      cli,
      [
        "render", path.relative(home, path.join(ROOT, entry.dir)),
        "--format", "png-sequence", "--resolution", draft ? "landscape" : "landscape-4k",
        "--fps", String(FPS), "--output", frames,
      ],
      {
        cwd: home,
        env: { HYPERFRAMES_NO_TELEMETRY: "1" },
        onLine: (line) => {
          if (line.startsWith("@hf-progress")) progress((0.8 * (json(line)?.pct ?? 0)) / 100);
        },
      },
    );
    return { pngs: await pngsIn(frames) };
  },

  async fframes(work) {
    const video = path.join(work, "master.mkv");
    await run(
      cargo(),
      ["run", "--release", "--quiet", "--", "render", "--master", "--json", "-o", video, ...(draft ? ["--draft"] : [])],
      {
        cwd: path.join(ROOT, entry.dir),
        onLine: (line) => {
          const p = json(line);
          if (p?.event === "progress") progress((0.8 * p.done) / p.total);
        },
      },
    );
    return { video };
  },
};

const pngsIn = async (dir) =>
  (await readdir(dir))
    .filter((f) => f.endsWith(".png"))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .map((f) => path.join(dir, f));

const work = path.join(OUT, ".work", id);
await rm(work, { recursive: true, force: true });
await mkdir(work, { recursive: true });
progress(0);

const engine = ENGINES[entry.engine];
if (!engine) throw new Error(`No engine called ${entry.engine}`);
const source = await engine(work);

const files = draft
  ? [{ path: path.join(OUT, `${id}-draft.mp4`), map: "[hd]", level: "4.2" }]
  : [
      { path: path.join(OUT, `${id}-4k.mp4`), map: "[uhd]", level: "5.2" },
      { path: path.join(OUT, `${id}-1080p.mp4`), map: "[hd]", level: "4.2" },
    ];
// Frames are timed by their number, as a master's own timestamps can be
// rounded to the millisecond and ffmpeg would drop frames to fix them. A
// draft is already 1080p, so it is only converted.
const retime = `[0:v]setpts=N/${FPS}/TB`;
const graph = draft
  ? `${retime},${TO_VIDEO}[hd]`
  : `${retime},split=2[a][b];[a]${TO_VIDEO}[uhd];[b]${HALF},${TO_VIDEO}[hd]`;
const input = source.video
  ? ["-i", source.video]
  : ["-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-"];
const total = Math.round(entry.duration * FPS);

await run(
  "ffmpeg",
  [
    "-y", "-loglevel", "error", "-progress", "pipe:1", "-nostats", ...input,
    "-filter_complex", graph,
    // Written under a .part name and renamed once complete, as export.mjs does.
    ...files.flatMap((f) => ["-map", f.map, "-r", String(FPS), ...x264(f.level, draft), "-f", "mp4", `${f.path}.part`]),
  ],
  {
    onLine: (line) => {
      if (line.startsWith("frame=")) progress(0.8 + (0.2 * Number(line.slice(6))) / total);
    },
    input: source.pngs
      ? async (stdin) => {
          for (const png of source.pngs) {
            if (!stdin.write(await readFile(png))) await new Promise((r) => stdin.once("drain", r));
          }
          stdin.end();
        }
      : undefined,
  },
);

for (const f of files) await rename(`${f.path}.part`, f.path);
await rm(work, { recursive: true, force: true });
progress(1);
for (const f of files) console.log(`wrote ${path.relative(ROOT, f.path)}`);
