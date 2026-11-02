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
// A VIDEO film (an edit of footage, kind "video") renders from the original
// files with its sound, and a final is only drawn at twice its size when
// the footage has the pixels for it: every picture on the timeline must
// have at least about twice the detail the frame needs (a 4K clip in a
// 1080p film, say). Otherwise the final is the film's own size alone
// (1080p.mp4), as blowing footage up only makes a bigger, softer file.
//
// A motion film's engine hands over lossless frames (PNGs, or an FFV1
// master from fframes), and one ffmpeg makes the files from them exactly as
// `npm run export` does: H.264 at CRF 14, tagged BT.709, the smaller copy
// being the big frames at half size. A video film is encoded by Remotion
// while it draws (with its sound, the same tags), as footage is long.
//
// Prints `progress <percent>` lines on stdout while it works, then
// `wrote <path>` for each file. Engine output is shown only if it fails.

import { spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync, rmSync } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fontFaces, kitForFilm, tokensForRender } from "../../src/lib/studio/brand-tokens.ts";
import { brandScript, paramValues, prepareHtml } from "../../src/lib/studio/inject.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// One Rust build folder for every film: the engine's dependencies (about
// 2 GB) build once, and a film after that takes seconds.
const CARGO_TARGET = path.join(ROOT, "node_modules/.cache/studio-cargo");

// The same encoding as scripts/export.mjs.
const TO_VIDEO =
  "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p," +
  "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv";
const x264 = (level, draft = false, tune = "animation") => [
  "-c:v", "libx264", "-preset", draft ? "veryfast" : "slow", "-crf", draft ? "18" : "14",
  "-tune", tune, "-level:v", level, "-movflags", "+faststart",
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
      await writeFile(
        spec,
        JSON.stringify({
          width: job.width,
          height: job.height,
          fps: job.fps,
          duration: job.duration,
          params: job.params,
          video: job.footage ? { output: path.join(work, "film.mp4"), draft } : null,
        }),
      );
      await run(process.execPath, ["scripts/film-frames.mjs", job.dir, frames, spec, "--scale", String(job.scale)], {
        cwd: path.join(ROOT, "studio/remotion"),
        onLine: remotionProgress,
      });
    }
    if (job.footage) return { encoded: path.join(work, "film.mp4") };
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
      ...outs.flatMap((f) => [
        "-map", f.label, "-r", String(fps), ...x264(level(f), draft), "-f", "mp4", `${f.path}.part`,
      ]),
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
const SKIP = new Set(["out", ".history", "node_modules", "target", ".hyperframes", "renders", "media", "sound"]);

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
  // The film's brand kit: its fonts and logos copied in beside the film,
  // its tokens handed over as each engine expects (brand.ts).
  const kit = await kitForFilm(ROOT, film.brand);
  const brand = kit ? await tokensForRender(ROOT, kit, film.engine === "react" ? path.join(src, "public") : src) : null;
  if (film.engine === "html") {
    const index = path.join(src, "index.html");
    await writeFile(index, prepareHtml(await readFile(index, "utf8"), film, params, brand ? brandScript(brand, fontFaces(brand)) : ""));
  }
  if (brand && film.engine === "rust") await writeFile(path.join(src, "brand.json"), `${JSON.stringify(brand, null, 2)}\n`);

  const job = {
    dir: src,
    width: film.width,
    height: film.height,
    fps: film.fps,
    duration: film.duration,
    // A React film reads its brand from its props (studio-kit's useBrand()).
    params: film.engine === "react" && brand ? { ...params, brand } : params,
    scale: draft ? 1 : 2,
  };
  let server = null;
  if (film.kind === "video") {
    // The edit and its files, served to the engine from here: the originals
    // (photos as their web-ready copy), never the preview copies.
    const edit = JSON.parse(await readFile(path.join(src, "edit.json"), "utf8"));
    server = await serveMedia(path.join(dir, "media"));
    const media = {};
    for (const mid of await readdir(path.join(dir, "media")).catch(() => [])) {
      const m = JSON.parse(await readFile(path.join(dir, "media", mid, "media.json"), "utf8").catch(() => "null"));
      if (!m || m.status !== "ready") continue;
      const file = m.kind === "image" ? m.proxy : m.original;
      media[mid] = { src: `${server.url}/${mid}/${encodeURIComponent(file)}`, kind: m.kind, width: m.width, height: m.height, name: m.name };
    }
    job.params = { ...job.params, edit, media };
    job.duration = Math.max(1 / film.fps, editEnd(edit));
    job.footage = true;
    if (!draft && !hasDetailFor2x(edit, media, film)) job.scale = 1;
  }
  const engine = ENGINES[ENGINE_OF[film.engine]];
  if (!engine) throw new Error(`No engine for ${film.engine} films`);
  let source;
  try {
    source = await engine(job, work);
  } finally {
    server?.close();
  }

  const files = draft
    ? [{ path: path.join(out, "draft.mp4"), big: true }]
    : job.scale === 2
      ? [
          { path: path.join(out, "4k.mp4"), big: true },
          { path: path.join(out, "1080p.mp4"), big: false },
        ]
      : [{ path: path.join(out, "1080p.mp4"), big: false }];
  // A final at the film's own size replaces any earlier twice-size file.
  if (!draft && job.scale === 1) await rm(path.join(out, "4k.mp4"), { force: true });
  if (source.encoded) await finishEncoded(source.encoded, job, files);
  else await encode(source, job, files);
  await addSound(id, film, job, files);

  // The poster: the film at its "Cover" mark (or halfway; a third in for a
  // video film, past any title card), at its own size.
  const cover = (film.marks ?? []).find((m) => /cover/i.test(m.label))?.t ?? job.duration / (film.kind === "video" ? 3 : 2);
  const small = files.at(-1).path;
  await run("ffmpeg", [
    "-y", "-loglevel", "error", "-ss", String(Math.min(cover, job.duration - 1 / film.fps)), "-i", small,
    "-frames:v", "1", "-vf", `scale=${film.width}:${film.height}:flags=area`, path.join(out, "poster.png.part.png"),
  ]);
  await rename(path.join(out, "poster.png.part.png"), path.join(out, "poster.png"));

  await rm(work, { recursive: true, force: true });
  progress(1);
  for (const f of [...files.map((f) => f.path), path.join(out, "poster.png")]) {
    console.log(`wrote ${path.relative(ROOT, f)}`);
  }
}

// ─── Sound design ───────────────────────────────────────────────────────────

// Mixes the film's sound design (sound/sound.wav, see sound.ts) into each
// file, at film.sound.volume, ending with the film. A motion film is silent
// until then; a video film's own sound (its footage) stays on top, the
// design under it (its music already dips under speech). A sound older
// than its score (or a video film's edit), or of another length, is
// rendered again first.
async function addSound(id, film, job, files) {
  if (!film.sound?.on) return;
  const dir = path.join(ROOT, "films", id, "sound");
  if (!existsSync(path.join(dir, "score.js"))) return;
  const wav = path.join(dir, "sound.wav");
  if (!(await soundIsCurrent(id, film, job.duration))) {
    await run(process.execPath, [path.join(ROOT, "scripts/studio/sound.mjs"), id, "--quiet"]);
  }
  if (!existsSync(wav)) return;
  const volume = Math.max(0, Math.min(1.5, film.sound.volume ?? 1));
  const length = job.duration.toFixed(4);
  for (const f of files) {
    const own = await hasAudio(f.path);
    const graph = own
      ? `[1:a]volume=${volume},apad,atrim=end=${length}[s];[0:a][s]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95:level=false[a]`
      : `[1:a]volume=${volume},apad,atrim=end=${length},alimiter=limit=0.95:level=false[a]`;
    await run("ffmpeg", [
      "-y", "-loglevel", "error", "-i", f.path, "-i", wav,
      "-filter_complex", graph, "-map", "0:v", "-map", "[a]",
      "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-t", length,
      "-movflags", "+faststart", "-f", "mp4", `${f.path}.part`,
    ]);
    await rename(`${f.path}.part`, f.path);
  }
}

async function soundIsCurrent(id, film, duration) {
  const dir = path.join(ROOT, "films", id);
  const time = async (p) => (await stat(p).catch(() => null))?.mtimeMs ?? null;
  const wav = await time(path.join(dir, "sound/sound.wav"));
  const score = await time(path.join(dir, "sound/score.js"));
  if (wav === null || score === null || wav < score) return false;
  // Volume edits saved but not mixed in yet.
  const mix = await time(path.join(dir, "sound/mix.json"));
  if (mix !== null && wav < mix) return false;
  if (film.kind === "video") {
    const edit = await time(path.join(dir, "edit.json"));
    if (edit !== null && wav < edit) return false;
  }
  const status = JSON.parse(await readFile(path.join(dir, "sound/status.json"), "utf8").catch(() => "{}"));
  return status.state === "ready" && Math.abs((status.duration ?? 0) - duration) < 0.01;
}

const hasAudio = (file) =>
  new Promise((resolve) => {
    const p = spawn("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file]);
    let out = "";
    p.stdout.on("data", (c) => (out += c));
    p.on("close", () => resolve(out.trim().length > 0));
    p.on("error", () => resolve(false));
  });

// ─── Video films ────────────────────────────────────────────────────────────

// Remotion has already encoded the film (at the job's scale, with sound):
// the big file is that one; a smaller copy at the film's own size is the
// same frames at half size, sound copied as it is.
async function finishEncoded(file, job, files) {
  for (const f of files) {
    if (f.big || job.scale === 1) {
      await cp(file, `${f.path}.part`);
    } else {
      await run("ffmpeg", [
        "-y", "-loglevel", "error", "-i", file,
        "-vf", `scale=${job.width}:${job.height}:flags=area,${TO_VIDEO}`,
        ...x264("4.2", draft, "film"), "-c:a", "copy", "-f", "mp4", `${f.path}.part`,
      ]);
    }
    await rename(`${f.path}.part`, f.path);
  }
  progress(1);
}

function editEnd(edit) {
  let end = 0;
  for (const track of edit.tracks) {
    for (const item of track.items) {
      const length = item.type === "clip" ? (item.to - item.from) / (item.speed ?? 1) : item.duration;
      end = Math.max(end, item.start + length);
    }
  }
  return end;
}

// Does every picture on the timeline have about twice the detail the frame
// needs? A clip covers the frame, scaled by its zoom; it has enough when
// its source pixels per frame pixel are at least ~1.8 (a touch of upscaling
// at twice the size is invisible; more is not).
function hasDetailFor2x(edit, media, film) {
  for (const track of edit.tracks) {
    if (track.hidden || track.kind === "audio") continue;
    for (const item of track.items) {
      if (item.type !== "clip") continue;
      const m = media[item.media];
      if (!m || m.kind === "audio" || !m.width || !m.height) continue;
      const w = film.width * (item.box?.w ?? 1);
      const h = film.height * (item.box?.h ?? 1);
      const cover = Math.max(w / m.width, h / m.height) * Math.max(1, item.zoom ?? 1);
      if (1 / cover < 1.8) return false;
    }
  }
  return true;
}

// Serves a film's media folder on this Mac only, with byte ranges, for the
// engine to read the originals from while it renders.
function serveMedia(root) {
  const server = http.createServer(async (req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "");
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep) || rel.split("/").some((s) => s.startsWith("."))) {
      res.writeHead(404).end();
      return;
    }
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      res.writeHead(404).end();
      return;
    }
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
      res.writeHead(206, { "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${info.size}`, "Accept-Ranges": "bytes" });
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { "Content-Length": info.size, "Accept-Ranges": "bytes" });
    if (req.method === "HEAD") res.end();
    else createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() });
    });
  });
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
