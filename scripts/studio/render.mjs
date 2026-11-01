// Renders a motion film in whichever engine wrote it, under the hood of the
// studio: HyperFrames for HTML films, Remotion for React films, fframes for
// Rust films. Two ways in:
//
//   node scripts/studio/render.mjs --film <id> [--draft]
//     A studio film (films/<id>/film.json). Final: films/<id>/out/4k.mp4
//     (twice the film's size) and 1080p.mp4 (its own size); draft:
//     out/draft.mp4 at its own size, quickly. Both also write out/poster.png.
//
//   node scripts/studio/render.mjs <id> [--draft]
//     A sample from studio/compositions.json into studio/out/.
//
// Every engine hands over lossless frames (PNGs, or an FFV1 master from
// fframes), and one ffmpeg makes the files from them exactly as
// `npm run export` does: H.264 at CRF 14, tagged BT.709, the smaller copy
// being the big frames at half size.
//
// Prints `progress <percent>` lines on stdout while it works, then
// `wrote <path>` for each file. Engine output is shown only if it fails.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { paramValues, prepareHtml } from "../../src/lib/studio/inject.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// One Rust build folder for every film: the engine's dependencies (about
// 2 GB) build once, and a film after that takes seconds.
const CARGO_TARGET = path.join(ROOT, "node_modules/.cache/studio-cargo");

// The same encoding as scripts/export.mjs.
const TO_VIDEO =
  "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p," +
  "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv";
const x264 = (level, draft = false) => [
  "-c:v", "libx264", "-preset", draft ? "veryfast" : "slow", "-crf", draft ? "18" : "14",
  "-tune", "animation", "-level:v", level, "-movflags", "+faststart",
];

const args = process.argv.slice(2);
const draft = args.includes("--draft");
const filmAt = args.indexOf("--film");
const filmId = filmAt >= 0 ? args[filmAt + 1] : null;

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
      code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} failed (exit ${code}):\n${tail.join("\n")}`)),
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

const pngsIn = async (dir) =>
  (await readdir(dir))
    .filter((f) => f.endsWith(".png"))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .map((f) => path.join(dir, f));

// ─── Engines ────────────────────────────────────────────────────────────────
//
// Each renders a job's lossless frames into `work` and says where they are:
// { pngs: [paths] } or { video: path }. A job is
// { dir, width, height, fps, duration, scale, params, composition? }, where
// width and height are the film's own size and scale is 1 or 2.

// HyperFrames' resolution presets that are an exact multiple of a size.
const HF_PRESETS = {
  "1920x1080": "landscape",
  "1080x1920": "portrait",
  "1080x1080": "square",
  "3840x2160": "landscape-4k",
  "2160x3840": "portrait-4k",
  "2160x2160": "square-4k",
};

const ENGINES = {
  async hyperframes(job, work) {
    const frames = path.join(work, "frames");
    const preset = HF_PRESETS[`${job.width * job.scale}x${job.height * job.scale}`];
    // A size HyperFrames has no preset for (4:5, say) at twice its size: the
    // same capture HyperFrames makes, done here at device scale 2.
    if (job.scale !== 1 && !preset) return { pngs: await captureHtml(job, frames) };
    const home = path.join(ROOT, "studio/hyperframes");
    const cli = path.join(home, "node_modules/.bin/hyperframes");
    await run(
      cli,
      [
        "render", job.dir,
        "--format", "png-sequence",
        ...(job.scale !== 1 ? ["--resolution", preset] : []),
        "--fps", String(job.fps), "--output", frames,
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

  async remotion(job, work) {
    const frames = path.join(work, "frames");
    if (job.composition) {
      // A sample: its own entry and composition id.
      await run(process.execPath, ["scripts/frames.mjs", job.composition, frames, "--scale", String(job.scale)], {
        cwd: path.join(ROOT, "studio/remotion"),
        onLine: remotionProgress,
      });
    } else {
      const spec = path.join(work, "spec.json");
      await writeFile(spec, JSON.stringify({ width: job.width, height: job.height, fps: job.fps, duration: job.duration, params: job.params }));
      await run(process.execPath, ["scripts/film-frames.mjs", job.dir, frames, spec, "--scale", String(job.scale)], {
        cwd: path.join(ROOT, "studio/remotion"),
        onLine: remotionProgress,
      });
    }
    return { pngs: await pngsIn(frames) };
  },

  async fframes(job, work) {
    const video = path.join(work, "master.mkv");
    if (job.params) await writeFile(path.join(job.dir, "params.json"), `${JSON.stringify(job.params, null, 2)}\n`);
    await run(
      cargo(),
      [
        "run", "--release", "--quiet", "--",
        // Films are drawn at twice their size; --draft renders half of that.
        "render", "--master", "--json", "-o", video, ...(job.scale === 1 ? ["--draft"] : []),
      ],
      {
        cwd: job.dir,
        env: job.composition ? {} : { CARGO_TARGET_DIR: CARGO_TARGET },
        onLine: (line) => {
          const p = json(line);
          if (p?.event === "progress") progress((0.8 * p.done) / p.total);
        },
      },
    );
    return { video };
  },
};

const remotionProgress = (line) => {
  const p = json(line);
  if (p?.total) progress((0.8 * p.done) / p.total);
};

// Captures an HTML film frame by frame in Chrome at the job's scale, by
// seeking its timeline, for sizes HyperFrames has no preset for.
async function captureHtml(job, frames) {
  const { chromium } = await import("playwright");
  await mkdir(frames, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: job.width, height: job.height }, deviceScaleFactor: job.scale });
    await page.goto(`file://${path.join(job.dir, "index.html")}`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => window.__timelines?.main);
    const total = Math.round(job.duration * job.fps);
    const pngs = [];
    for (let f = 0; f < total; f++) {
      await page.evaluate((t) => {
        const tl = window.__timelines.main;
        tl.pause();
        tl.seek(t, false);
      }, f / job.fps);
      const file = path.join(frames, `frame_${String(f).padStart(5, "0")}.png`);
      await page.screenshot({ path: file, animations: "disabled", caret: "hide" });
      pngs.push(file);
      progress((0.8 * (f + 1)) / total);
    }
    return pngs;
  } finally {
    await browser.close();
  }
}

// ─── Encoding ───────────────────────────────────────────────────────────────

// Turns the engine's frames into the job's files. `files` are
// { path, big } : big ones at the frames' own size, the others at the
// film's own size (half, when the frames are at scale 2).
async function encode(source, job, files) {
  const half = `scale=${job.width}:${job.height}:flags=area`;
  const fps = job.fps;
  // Frames are timed by their number, as a master's own timestamps can be
  // rounded to the millisecond and ffmpeg would drop frames to fix them.
  const retime = `[0:v]setpts=N/${fps}/TB`;
  const outs = files.map((f, i) => ({ ...f, label: `[o${i}]` }));
  const branches = outs.map((f, i) => `[s${i}]${f.big || job.scale === 1 ? "" : `${half},`}${TO_VIDEO}${f.label}`);
  const graph = `${retime},split=${outs.length}${outs.map((_, i) => `[s${i}]`).join("")};${branches.join(";")}`;
  const input = source.video
    ? ["-i", source.video]
    : ["-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-"];
  const total = Math.round(job.duration * fps);
  const level = (f) => ((f.big ? job.scale : 1) * Math.max(job.width, job.height) > 2048 ? "5.2" : "4.2");

  await run(
    "ffmpeg",
    [
      "-y", "-loglevel", "error", "-progress", "pipe:1", "-nostats", ...input,
      "-filter_complex", graph,
      // Written under a .part name and renamed once complete, as export.mjs does.
      ...outs.flatMap((f) => ["-map", f.label, "-r", String(fps), ...x264(level(f), draft), "-f", "mp4", `${f.path}.part`]),
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
  for (const f of outs) await rename(`${f.path}.part`, f.path);
}

// ─── A studio film ──────────────────────────────────────────────────────────

// Holds `file` for as long as this process runs: made exclusively, with our
// process id in it. One left by a process that has since ended is taken over.
async function lock(file) {
  await mkdir(path.dirname(file), { recursive: true });
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  for (;;) {
    try {
      await writeFile(file, String(process.pid), { flag: "wx" });
      break;
    } catch {
      const holder = Number(await readFile(file, "utf8").catch(() => "0"));
      if (!holder || !alive(holder)) await rm(file, { force: true });
      else await new Promise((r) => setTimeout(r, 400));
    }
  }
  const release = () => {
    try {
      if (readFileSync(file, "utf8") === String(process.pid)) rmSync(file, { force: true });
    } catch {}
  };
  process.on("exit", release);
}

const ENGINE_OF = { html: "hyperframes", react: "remotion", rust: "fframes" };
// What a render copies: the film's own files, not its renders or history.
const SKIP = new Set(["out", ".history", "node_modules", "target", ".hyperframes", "renders"]);

async function renderFilm(id) {
  if (!/^[a-z0-9]{8}$/.test(id)) throw new Error(`No film called ${id}`);
  const dir = path.join(ROOT, "films", id);
  const film = JSON.parse(await readFile(path.join(dir, "film.json"), "utf8"));
  const out = path.join(dir, "out");
  // Beside the films, not inside this one: a folder can't be copied into
  // itself. The studio's list skips names that aren't film ids.
  const quality = draft ? "draft" : "final";
  const work = path.join(ROOT, "films", ".work", id, quality);
  // The studio's queue and the chat can both ask for a draft of the same
  // film; the second waits for the first rather than sharing its folder.
  await lock(path.join(ROOT, "films", ".work", id, `${quality}.lock`));
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  progress(0);

  // The film as it is now, copied aside, so the chat can keep editing it
  // while this renders. Times are kept, so a Rust film only rebuilds what
  // changed.
  const src = path.join(work, "src");
  await cp(dir, src, {
    recursive: true,
    preserveTimestamps: true,
    filter: (p) => path.dirname(p) !== dir || !SKIP.has(path.basename(p)),
  });
  await mkdir(out, { recursive: true });
  const params = paramValues(film);
  if (film.engine === "html") {
    const index = path.join(src, "index.html");
    await writeFile(index, prepareHtml(await readFile(index, "utf8"), film, params));
  }

  const job = {
    dir: src,
    width: film.width,
    height: film.height,
    fps: film.fps,
    duration: film.duration,
    params,
    scale: draft ? 1 : 2,
  };
  const engine = ENGINES[ENGINE_OF[film.engine]];
  if (!engine) throw new Error(`No engine for ${film.engine} films`);
  const source = await engine(job, work);

  const files = draft
    ? [{ path: path.join(out, "draft.mp4"), big: true }]
    : [
        { path: path.join(out, "4k.mp4"), big: true },
        { path: path.join(out, "1080p.mp4"), big: false },
      ];
  await encode(source, job, files);

  // The poster: the film at its "Cover" mark (or halfway), at its own size.
  const cover = (film.marks ?? []).find((m) => /cover/i.test(m.label))?.t ?? film.duration / 2;
  const small = files.at(-1).path;
  await run("ffmpeg", [
    "-y", "-loglevel", "error", "-ss", String(Math.min(cover, film.duration - 1 / film.fps)), "-i", small,
    "-frames:v", "1", "-vf", `scale=${film.width}:${film.height}:flags=area`, path.join(out, "poster.png.part.png"),
  ]);
  await rename(path.join(out, "poster.png.part.png"), path.join(out, "poster.png"));

  await rm(work, { recursive: true, force: true });
  progress(1);
  for (const f of [...files.map((f) => f.path), path.join(out, "poster.png")]) {
    console.log(`wrote ${path.relative(ROOT, f)}`);
  }
}

// ─── A sample from studio/compositions.json ─────────────────────────────────

async function renderSample(id) {
  const OUT = path.join(ROOT, "studio/out");
  const manifest = JSON.parse(await readFile(path.join(ROOT, "studio/compositions.json"), "utf8"));
  const entry = manifest.find((c) => c.id === id);
  if (!entry) {
    console.error(
      `usage: node scripts/studio/render.mjs --film <id> [--draft]\n       node scripts/studio/render.mjs <sample> [--draft]\nsamples: ${manifest.map((c) => c.id).join(", ")}`,
    );
    process.exit(1);
  }
  const work = path.join(OUT, ".work", id);
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  progress(0);
  // The samples are 1920x1080 at 60 fps; a final is drawn at 4K.
  const job = {
    dir: path.join(ROOT, entry.dir),
    width: 1920,
    height: 1080,
    fps: 60,
    duration: entry.duration,
    scale: draft ? 1 : 2,
    composition: entry.composition ?? entry.id,
  };
  const source = await ENGINES[entry.engine](job, work);
  const files = draft
    ? [{ path: path.join(OUT, `${id}-draft.mp4`), big: true }]
    : [
        { path: path.join(OUT, `${id}-4k.mp4`), big: true },
        { path: path.join(OUT, `${id}-1080p.mp4`), big: false },
      ];
  await encode(source, job, files);
  await rm(work, { recursive: true, force: true });
  progress(1);
  for (const f of files) console.log(`wrote ${path.relative(ROOT, f.path)}`);
}

if (filmId) await renderFilm(filmId);
else await renderSample(args.find((a) => !a.startsWith("--")));
