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
// How a final stays crisp: the engine draws lossless frames at twice the
// film's size (PNGs, or an FFV1 master from fframes), and one ffmpeg makes
// both files from them, tagged BT.709 (limited range, 4:2:0, so it plays
// the same everywhere). The 4K file is those frames as they are; the 1080p
// file is the same frames at half size (lanczos), so the two always match
// and nothing is drawn twice or scaled twice. The poster comes from a
// lossless frame too. Sound is AAC at 320 kb/s.
//
// How it stays fast on any Mac (machine.mjs): Chrome draws with as many
// pages as the Mac's cores and memory allow; a final's 4K file is encoded
// by Apple's hardware encoder where it measures as good as x264 (Apple
// silicon), x264 elsewhere; an HTML draft is drawn and encoded in one pass
// by HyperFrames; the sound renders while the frames are drawn. A render
// of a film whose files and sound haven't changed since the last one of
// the same quality is reused, not drawn again (out/render-key.json); if
// only the sound changed, the new sound goes onto the old pictures.
//
// Prints `progress <percent>` lines on stdout while it works, then
// `wrote <path>` for each file. Engine output is shown only if it fails.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, rmSync } from "node:fs";
import { stat, utimes } from "node:fs/promises";
import http from "node:http";
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fontFaces, kitForFilm, tokensForRender } from "../../src/lib/studio/brand-tokens.ts";
import { brandScript, paramValues, prepareHtml } from "../../src/lib/studio/inject.ts";
import { describe, machine, workersFor } from "./machine.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// One Rust build folder for every film: the engine's dependencies (about
// 2 GB) build once, and a film after that takes seconds.
const CARGO_TARGET = path.join(ROOT, "node_modules/.cache/studio-cargo");
// Bumped when the way files are made changes, so older renders aren't
// reused.
const PIPELINE = "2";

// Into video: BT.709, limited range, 4:2:0, tagged so the orange plays back
// as the same orange everywhere (as scripts/export.mjs does).
const TO_VIDEO =
  "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p," +
  "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv";

const args = process.argv.slice(2);
const draft = args.includes("--draft");
const filmAt = args.indexOf("--film");
const filmId = filmAt >= 0 ? args[filmAt + 1] : null;

// ─── Progress ───────────────────────────────────────────────────────────────
//
// The bar is split into the steps a render goes through, each given the
// share of the time it takes (measured, see `shares`), so the percentage
// moves at about the same pace from start to end. `step(from, to)` maps a
// step's own 0..1 onto its part of the bar.

let shown = -1;
const progress = (fraction) => {
  const percent = Math.max(0, Math.min(100, Math.floor(fraction * 100)));
  if (percent > shown) console.log(`progress ${(shown = percent)}`);
};
const step = (from, to) => (fraction) => progress(from + (to - from) * Math.max(0, Math.min(1, fraction)));

// Where drawing ends and encoding ends, as parts of the whole render. On an
// M5 a 29 s film took: final, 4K drawn in 40 s and encoded in 25 s with the
// hardware encoder (65 s with x264); draft, drawn and encoded together by
// HyperFrames in 20 s, or drawn then encoded in a few seconds by the others.
const shares = (m, { engine, scale }) => {
  if (draft && engine === "hyperframes") return { drawn: 0.95, encoded: 0.95 };
  if (draft) return { drawn: 0.85, encoded: 0.96 };
  if (scale === 2 && m.finalVideoToolbox) return { drawn: 0.6, encoded: 0.96 };
  return { drawn: 0.4, encoded: 0.96 };
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
// Each renders a job's frames into `work` and says where they are:
// { pngs: [paths] } or { video: path } (lossless), or { encoded: path } (a
// finished H.264 file). A job is
// { dir, width, height, fps, duration, scale, params, workers, composition? },
// where width and height are the film's own size and scale is 1 or 2. Each
// reports its own 0..1 to `onProgress`.

// HyperFrames' resolution presets that are an exact multiple of a size.
const HF_PRESETS = {
  "1920x1080": "landscape",
  "1080x1920": "portrait",
  "1080x1080": "square",
  "3840x2160": "landscape-4k",
  "2160x3840": "portrait-4k",
  "2160x2160": "square-4k",
};

// HyperFrames' own percentage gives its setup a quarter and its capture
// under half, though capture is nearly all of the time. Its frame count is
// used instead: setup is the first 5%, capture up to 95%, the rest (writing
// the frames out, or finishing the video) after it.
const hfFraction = (p) => {
  if (p.code === "capture" && p.total) return 0.05 + (0.9 * p.done) / p.total;
  const pct = p.pct ?? 0;
  if (pct <= 25) return (0.05 * pct) / 25;
  return 0.95 + 0.05 * Math.max(0, Math.min(1, (pct - 70) / 30));
};

const ENGINES = {
  async hyperframes(job, work, m, onProgress) {
    const home = path.join(ROOT, "studio/hyperframes");
    const cli = path.join(home, "node_modules/.bin/hyperframes");
    const preset = HF_PRESETS[`${job.width * job.scale}x${job.height * job.scale}`];
    // A size HyperFrames has no preset for (4:5, say) at twice its size: the
    // same capture HyperFrames makes, done here at device scale 2.
    if (job.scale !== 1 && !preset) {
      return { pngs: await captureHtml(job, path.join(work, "frames"), onProgress) };
    }
    const hf = (extra) =>
      run(
        cli,
        [
          "render", job.dir, "--fps", String(job.fps), "--workers", String(job.workers),
          // An 8 GB Mac would otherwise be held to one worker; the worker
          // count already leaves it room (machine.mjs).
          ...(job.workers > 1 && m.memoryGb <= 8.5 ? ["--no-low-memory-mode"] : []),
          ...extra,
        ],
        {
          cwd: home,
          env: { HYPERFRAMES_NO_TELEMETRY: "1" },
          onLine: (line) => {
            if (line.startsWith("@hf-progress")) onProgress(hfFraction(json(line) ?? {}));
          },
        },
      );
    if (draft && job.scale === 1) {
      // A draft is drawn and encoded at once by HyperFrames' own video
      // path, on the hardware encoder where there is one. Its sound is
      // left out (the film's sound design goes on afterwards, as for a
      // final) and its H.264 level set right for the size and frame rate.
      const raw = path.join(work, "hyperframes.mp4");
      await hf(["--format", "mp4", "--output", raw, ...(m.draftVideoToolbox ? ["--gpu"] : ["--crf", "18"])]);
      const file = path.join(work, "film.mp4");
      await run("ffmpeg", [
        "-y", "-loglevel", "error", "-i", raw, "-map", "0:v", "-c", "copy",
        "-bsf:v", `h264_metadata=level=${levelFor(job.width, job.height, job.fps)}`,
        "-movflags", "+faststart", "-f", "mp4", file,
      ]);
      return { encoded: file };
    }
    const frames = path.join(work, "frames");
    await hf([
      "--format", "png-sequence", "--output", frames,
      ...(job.scale !== 1 ? ["--resolution", preset] : []),
    ]);
    return { pngs: await pngsIn(frames) };
  },

  async remotion(job, work, m, onProgress) {
    const frames = path.join(work, "frames");
    const onLine = (line) => {
      const p = json(line);
      if (p?.total) onProgress(p.done / p.total);
    };
    // Remotion opens this many Chrome tabs (film-frames.mjs reads it).
    const env = { STUDIO_CONCURRENCY: String(job.workers) };
    if (job.composition) {
      // A sample: its own entry and composition id.
      await run(process.execPath, ["scripts/frames.mjs", job.composition, frames, "--scale", String(job.scale)], {
        cwd: path.join(ROOT, "studio/remotion"),
        env,
        onLine,
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
        env,
        onLine,
      });
    }
    if (job.footage) return { encoded: path.join(work, "film.mp4") };
    return { pngs: await pngsIn(frames) };
  },

  async fframes(job, work, m, onProgress) {
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
          if (p?.event === "progress") onProgress(p.done / p.total);
        },
      },
    );
    return { video };
  },
};

// Captures an HTML film frame by frame in Chrome at the job's scale, by
// seeking its timeline, for sizes HyperFrames has no preset for. The film
// is split into one run of frames per worker, each in its own page.
async function captureHtml(job, frames, onProgress) {
  const { chromium } = await import("playwright");
  await mkdir(frames, { recursive: true });
  const total = Math.round(job.duration * job.fps);
  const workers = Math.max(1, Math.min(job.workers, Math.ceil(total / 30)));
  const browser = await chromium.launch({ channel: "chrome" });
  let done = 0;
  try {
    const capture = async (from, to) => {
      const context = await browser.newContext({
        viewport: { width: job.width, height: job.height },
        deviceScaleFactor: job.scale,
      });
      const page = await context.newPage();
      await page.goto(`file://${path.join(job.dir, "index.html")}`, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      // Polled on a timer: Chrome's frame-by-frame polling never settles on
      // these pages, so the wait used to time out.
      await page.waitForFunction(() => !!window.__timelines?.main, null, { polling: 100 });
      for (let f = from; f < to; f++) {
        // filmTimeline's seek() (Motion) and a GSAP timeline's both draw the
        // frame at once; a bare Motion animation gets its time set, then
        // Motion's frame run.
        await page.evaluate((t) => {
          const tl = window.__timelines.main;
          tl.pause?.();
          if (typeof tl.seek === "function") tl.seek(t, false);
          else {
            tl.time = t;
            window.filmTimeline?.flush?.();
          }
        }, f / job.fps);
        const file = path.join(frames, `frame_${String(f).padStart(5, "0")}.png`);
        await page.screenshot({ path: file, animations: "disabled", caret: "hide" });
        onProgress(++done / total);
      }
      await context.close();
    };
    const per = Math.ceil(total / workers);
    await Promise.all(
      Array.from({ length: workers }, (_, i) => capture(i * per, Math.min(total, (i + 1) * per))),
    );
    return Array.from({ length: total }, (_, f) => path.join(frames, `frame_${String(f).padStart(5, "0")}.png`));
  } finally {
    await browser.close();
  }
}

// ─── Encoding ───────────────────────────────────────────────────────────────

// The H.264 level a size and frame rate need, so every player (QuickTime
// included) takes the file: 4.2 up to 1080p60, 5.2 up to 4K60.
const levelFor = (width, height, fps) => (width * height * fps > 1920 * 1080 * 60 || Math.max(width, height) > 2048 ? "5.2" : "4.2");

// What encodes one file.
//   final, at the frames' own (twice) size: Apple's hardware encoder at
//     quality 90 on Apple silicon; otherwise x264 slow at CRF 14. Both
//     measure visually lossless on flat colour, hairlines and small type.
//   final, at the film's own size: x264 slow, CRF 14, tuned for animation
//     (flat colour and sharp edges), the best quality for its size.
//   draft: the hardware encoder at a generous bit rate where there is
//     one, otherwise x264 veryfast at CRF 18.
function encoderFor(m, file, job, width, height, tune = "animation") {
  const level = levelFor(width, height, job.fps);
  const keyframes = ["-g", String(Math.round(job.fps * 2))];
  if (draft && m.draftVideoToolbox) {
    const rate = Math.max(4, Math.round((width * height * job.fps * 0.08) / 1e6));
    return ["-c:v", "h264_videotoolbox", "-b:v", `${rate}M`, "-profile:v", "high", "-level:v", level, ...keyframes];
  }
  if (draft) return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-tune", tune, "-level:v", level];
  if (file.big && job.scale === 2 && m.finalVideoToolbox) {
    return ["-c:v", "h264_videotoolbox", "-q:v", "90", "-profile:v", "high", "-level:v", level, ...keyframes];
  }
  return ["-c:v", "libx264", "-preset", "slow", "-crf", "14", "-tune", tune, "-level:v", level];
}

// Turns the engine's lossless frames into the job's files in one pass.
// `files` are { path, big }: big ones at the frames' own size, the others
// at the film's own size (half, when the frames are at scale 2).
async function encode(source, job, files, m, onProgress) {
  const half = `scale=${job.width}:${job.height}:flags=lanczos+accurate_rnd`;
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
  const sizeOf = (f) => (f.big ? [job.width * job.scale, job.height * job.scale] : [job.width, job.height]);

  await run(
    "ffmpeg",
    [
      "-y", "-loglevel", "error", "-progress", "pipe:1", "-nostats", ...input,
      "-filter_complex", graph,
      // Written under a .part name and renamed once complete, as export.mjs does.
      ...outs.flatMap((f) => [
        "-map", f.label, "-r", String(fps), ...encoderFor(m, f, job, ...sizeOf(f)),
        "-movflags", "+faststart", "-f", "mp4", `${f.path}.part`,
      ]),
    ],
    {
      onLine: (line) => {
        if (line.startsWith("frame=")) onProgress(Number(line.slice(6)) / total);
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

// The poster: the film at `t`, at its own size, from the lossless frames
// where there are some (so it is as sharp as the film is drawn), else from
// the finished file.
async function writePoster(source, job, t, fallback, to) {
  const scale = `scale=${job.width}:${job.height}:flags=lanczos+accurate_rnd`;
  const part = `${to}.part.png`;
  if (source.pngs?.length) {
    const png = source.pngs[Math.max(0, Math.min(source.pngs.length - 1, Math.round(t * job.fps)))];
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", png, "-vf", scale, part]);
  } else {
    await run("ffmpeg", [
      "-y", "-loglevel", "error", "-ss", String(t), "-i", source.video ?? fallback,
      "-frames:v", "1", "-vf", scale, part,
    ]);
  }
  await rename(part, to);
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
// The edition (src/lib/studio/edition.ts): the studio hands its environment
// to this script, so STUDIO_EDITION is the same here.
const PRODUCT = process.env.STUDIO_EDITION === "product";
const GSAP_SCRIPT = /<script[^>]+src=["'][^"']*gsap[^"']*["']/i;
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
  const m = await machine();

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
    // The product edition doesn't include GSAP (docs/launch/gsap-to-motion.md):
    // only films moved by Motion render there.
    if (PRODUCT && GSAP_SCRIPT.test(await readFile(index, "utf8"))) {
      throw new Error("This film moves with GSAP, which this edition of the studio doesn't include. Ask Claude to move it to Motion.");
    }
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
  let media = null;
  let edit = null;
  if (film.kind === "video") {
    // The edit and its files, served to the engine from here: the originals
    // (photos as their web-ready copy), never the preview copies.
    edit = JSON.parse(await readFile(path.join(src, "edit.json"), "utf8"));
    media = {};
    for (const mid of await readdir(path.join(dir, "media")).catch(() => [])) {
      const info = JSON.parse(await readFile(path.join(dir, "media", mid, "media.json"), "utf8").catch(() => "null"));
      if (!info || info.status !== "ready") continue;
      const file = info.kind === "image" ? info.proxy : info.original;
      media[mid] = { file, kind: info.kind, width: info.width, height: info.height, name: info.name };
    }
    job.duration = Math.max(1 / film.fps, editEnd(edit));
    job.footage = true;
    if (!draft && !hasDetailFor2x(edit, media, film)) job.scale = 1;
  }
  const engineName = ENGINE_OF[film.engine];
  const engine = ENGINES[engineName];
  if (!engine) throw new Error(`No engine for ${film.engine} films`);
  job.workers = workersFor(m, job.scale);
  console.error(describe(m, job.workers));

  const files = draft
    ? [{ path: path.join(out, "draft.mp4"), big: true }]
    : job.scale === 2
      ? [
          { path: path.join(out, "4k.mp4"), big: true },
          { path: path.join(out, "1080p.mp4"), big: false },
        ]
      : [{ path: path.join(out, "1080p.mp4"), big: false }];
  const poster = path.join(out, "poster.png");
  // The poster: the film at its "Cover" mark (or halfway; a third in for a
  // video film, past any title card).
  const cover = (film.marks ?? []).find((mk) => /cover/i.test(mk.label))?.t ?? job.duration / (film.kind === "video" ? 3 : 2);
  const coverAt = Math.min(cover, job.duration - 1 / film.fps);

  // The sound renders (if it needs to) while the frames are drawn.
  const sound = soundFor(id, film, job.duration);
  sound.catch(() => {});

  // The same film, drawn the same way, as last time? Then its files are
  // reused; if only its sound changed, the new sound goes on them.
  const keys = path.join(out, "render-key.json");
  const saved = JSON.parse(await readFile(keys, "utf8").catch(() => "{}"));
  const pictures = await picturesKey(src, film, job, m, media && path.join(dir, "media"));
  const before = saved[quality];
  const kept = before?.pictures === pictures && [...files, { path: poster }].every((f) => existsSync(f.path));
  if (kept) {
    const wav = await sound;
    const heard = await soundKey(wav, film);
    // A video film's own sound is already mixed with the old design, so a
    // new design means drawing it again.
    if (heard === before.sound || film.kind !== "video") {
      if (heard !== before.sound) {
        console.error("reusing the last render's pictures with the new sound");
        await addSound(film, job, files, wav, { replace: true });
      } else {
        console.error("nothing changed since the last render; reusing it");
      }
      // Newer than the film's files, as a fresh render would be (the stage
      // of a Rust film compares these times).
      const now = new Date();
      for (const f of [...files.map((f) => f.path), poster]) await utimes(f, now, now);
      await saveKey(keys, quality, { pictures, sound: heard });
      await rm(work, { recursive: true, force: true });
      progress(1);
      for (const f of [...files.map((f) => f.path), poster]) console.log(`wrote ${path.relative(ROOT, f)}`);
      return;
    }
  }
  // Forgotten until this render finishes, so a failed one is never reused.
  await saveKey(keys, quality, null);

  const share = shares(m, { engine: engineName, scale: job.scale });
  let server = null;
  if (media) {
    server = await serveMedia(path.join(dir, "media"));
    const served = {};
    for (const [mid, info] of Object.entries(media)) {
      const { file, ...rest } = info;
      served[mid] = { src: `${server.url}/${mid}/${encodeURIComponent(file)}`, ...rest };
    }
    job.params = { ...job.params, edit, media: served };
  }
  let source;
  try {
    source = await engine(job, work, m, step(0, share.drawn));
  } finally {
    server?.close();
  }

  // A final at the film's own size replaces any earlier twice-size file.
  if (!draft && job.scale === 1) await rm(path.join(out, "4k.mp4"), { force: true });
  if (source.encoded) await finishEncoded(source.encoded, job, files, m, step(share.drawn, share.encoded));
  else await encode(source, job, files, m, step(share.drawn, share.encoded));
  const wav = await sound;
  await addSound(film, job, files, wav);
  progress(0.98);
  await writePoster(source, job, coverAt, files.at(-1).path, poster);
  await saveKey(keys, quality, { pictures, sound: await soundKey(wav, film) });

  await rm(work, { recursive: true, force: true });
  progress(1);
  for (const f of [...files.map((f) => f.path), poster]) console.log(`wrote ${path.relative(ROOT, f)}`);
}

// ─── Reuse ──────────────────────────────────────────────────────────────────

// A fingerprint of everything that decides a render's pictures: the film's
// files as the engine gets them (brand kit and settings already in), its
// settings minus the ones that don't change a frame (its name, its sound,
// when it was edited), the size, frame rate and length, the footage it
// uses (by size and time, as footage is large), and how the files are made.
async function picturesKey(src, film, job, m, mediaDir) {
  const hash = createHash("sha256");
  const { updatedAt, createdAt, session, title, sound, id, ...look } = film;
  void [updatedAt, createdAt, session, title, sound, id];
  // Not the folder or the number of workers: neither changes a frame.
  const { dir, workers, ...shape } = job;
  void [dir, workers];
  hash.update(JSON.stringify({
    PIPELINE, draft, look, shape,
    finalVideoToolbox: m.finalVideoToolbox,
    draftVideoToolbox: m.draftVideoToolbox,
  }));
  await hashTree(hash, src, src, (rel) => rel !== "film.json");
  if (mediaDir) await hashTree(hash, mediaDir, mediaDir, () => true, true);
  return hash.digest("hex");
}

async function hashTree(hash, root, dir, keep, byStat = false) {
  const entries = (await readdir(dir, { withFileTypes: true }).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const p = path.join(dir, e.name);
    const rel = path.relative(root, p);
    if (e.name === ".DS_Store" || !keep(rel)) continue;
    if (e.isDirectory()) {
      await hashTree(hash, root, p, keep, byStat);
      continue;
    }
    const info = await stat(p);
    hash.update(`\0${rel}\0${info.size}\0`);
    // Footage, and anything over 64 MB, by size and time; the rest by content.
    if (byStat || info.size > 64 * 2 ** 20) hash.update(String(info.mtimeMs));
    else hash.update(await readFile(p));
  }
}

// The sound as it will be mixed in: the file and its volume, or "none".
async function soundKey(wav, film) {
  if (!wav) return "none";
  const volume = Math.max(0, Math.min(1.5, film.sound?.volume ?? 1));
  return createHash("sha256").update(String(volume)).update(await readFile(wav)).digest("hex");
}

async function saveKey(file, quality, value) {
  const all = JSON.parse(await readFile(file, "utf8").catch(() => "{}"));
  if (value) all[quality] = value;
  else delete all[quality];
  await writeFile(`${file}.tmp`, JSON.stringify(all, null, 2));
  await rename(`${file}.tmp`, file);
}

// ─── Sound design ───────────────────────────────────────────────────────────

// The film's sound design (sound/sound.wav, see sound.ts), made current: a
// sound older than its score, its volume edits (or a video film's edit),
// or of another length, is rendered again first. Null when the film has
// no sound.
async function soundFor(id, film, duration) {
  if (!film.sound?.on) return null;
  const dir = path.join(ROOT, "films", id, "sound");
  // A score, or a voiceover (a film made from slides).
  if (!existsSync(path.join(dir, "score.js")) && !existsSync(path.join(dir, "voice.json"))) return null;
  const wav = path.join(dir, "sound.wav");
  if (!(await soundIsCurrent(id, film, duration))) {
    await run(process.execPath, [path.join(ROOT, "scripts/studio/sound.mjs"), id, "--quiet"]);
  }
  return existsSync(wav) ? wav : null;
}

// Mixes the sound design into each file, at film.sound.volume, ending with
// the film. A motion film is silent until then; a video film's own sound
// (its footage) stays on top, the design under it (its music already dips
// under speech). With `replace`, a file that already has the design (a
// reused render) gets the new one in place of the old, or none.
async function addSound(film, job, files, wav, { replace = false } = {}) {
  if (!wav && !replace) return;
  const volume = Math.max(0, Math.min(1.5, film.sound?.volume ?? 1));
  const length = job.duration.toFixed(4);
  for (const f of files) {
    const own = !replace && film.kind === "video" && (await hasAudio(f.path));
    const graph = own
      ? `[1:a]volume=${volume},apad,atrim=end=${length}[s];[0:a][s]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95:level=false[a]`
      : `[1:a]volume=${volume},apad,atrim=end=${length},alimiter=limit=0.95:level=false[a]`;
    await run("ffmpeg", [
      "-y", "-loglevel", "error", "-i", f.path,
      ...(wav
        ? ["-i", wav, "-filter_complex", graph, "-map", "0:v", "-map", "[a]", "-c:a", "aac", "-b:a", "320k", "-ar", "48000"]
        : ["-map", "0:v"]),
      "-c:v", "copy", "-t", length, "-movflags", "+faststart", "-f", "mp4", `${f.path}.part`,
    ]);
    await rename(`${f.path}.part`, f.path);
  }
}

async function soundIsCurrent(id, film, duration) {
  const dir = path.join(ROOT, "films", id);
  const time = async (p) => (await stat(p).catch(() => null))?.mtimeMs ?? null;
  const wav = await time(path.join(dir, "sound/sound.wav"));
  const score = await time(path.join(dir, "sound/score.js"));
  const voice = await time(path.join(dir, "sound/voice.json"));
  if (wav === null || (score === null && voice === null) || wav < (score ?? 0) || wav < (voice ?? 0)) return false;
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

// ─── Encoded films ──────────────────────────────────────────────────────────

// The engine has already encoded the film (a video film by Remotion, at the
// job's scale, with its sound; an HTML draft by HyperFrames): the big file
// is that one; a smaller copy at the film's own size is the same frames at
// half size, sound copied as it is.
async function finishEncoded(file, job, files, m, onProgress) {
  for (const f of files) {
    if (f.big || job.scale === 1) {
      await cp(file, `${f.path}.part`);
    } else {
      const total = Math.round(job.duration * job.fps);
      await run(
        "ffmpeg",
        [
          "-y", "-loglevel", "error", "-progress", "pipe:1", "-nostats", "-i", file,
          "-vf", `scale=${job.width}:${job.height}:flags=lanczos+accurate_rnd,${TO_VIDEO}`,
          // Footage, so x264 is tuned for film rather than flat colour.
          ...encoderFor(m, f, job, job.width, job.height, "film"),
          "-c:a", "copy", "-movflags", "+faststart", "-f", "mp4", `${f.path}.part`,
        ],
        { onLine: (line) => line.startsWith("frame=") && onProgress(Number(line.slice(6)) / total) },
      );
    }
    await rename(`${f.path}.part`, f.path);
  }
  onProgress(1);
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
  const m = await machine();
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
  job.workers = workersFor(m, job.scale);
  const share = shares(m, { engine: entry.engine, scale: job.scale });
  const source = await ENGINES[entry.engine](job, work, m, step(0, share.drawn));
  const files = draft
    ? [{ path: path.join(OUT, `${id}-draft.mp4`), big: true }]
    : [
        { path: path.join(OUT, `${id}-4k.mp4`), big: true },
        { path: path.join(OUT, `${id}-1080p.mp4`), big: false },
      ];
  if (source.encoded) await finishEncoded(source.encoded, job, files, m, step(share.drawn, 1));
  else await encode(source, job, files, m, step(share.drawn, 1));
  await rm(work, { recursive: true, force: true });
  progress(1);
  for (const f of files) console.log(`wrote ${path.relative(ROOT, f.path)}`);
}

if (filmId) await renderFilm(filmId);
else await renderSample(args.find((a) => !a.startsWith("--")));
