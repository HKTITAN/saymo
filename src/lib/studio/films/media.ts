import { spawn } from "node:child_process";
import { createWriteStream, existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import sharp from "sharp";
import type { Edit, Media, MediaKind } from "./edit";
import { filmDir, isId, newId, ROOT } from "./films";
import { heicToJpeg } from "../server/convert";
import { IS_MAC } from "../server/platform";

// Footage brought into a video film. Each file gets its own folder,
// films/<id>/media/<mid>/, holding the original (never changed), a record
// (media.json) and what the studio makes from it once it's in: a smooth
// preview copy, a strip of frames for the timeline, the loudness of its
// sound and, when asked, what's said in it.
//
// Uploads are streamed straight to disk (footage can run to gigabytes) and
// the rest is done in the background, two files at a time.

export const mediaRoot = (id: string) => path.join(filmDir(id), "media");
export const mediaDir = (id: string, mid: string) => path.join(mediaRoot(id), mid);
const recordFile = (id: string, mid: string) => path.join(mediaDir(id, mid), "media.json");

const EXTS: Record<MediaKind, string[]> = {
  video: ["mp4", "mov", "m4v", "mkv", "webm", "avi", "mts", "m2ts", "3gp", "mxf", "mpg", "mpeg"],
  image: ["jpg", "jpeg", "png", "webp", "heic", "heif", "gif", "tif", "tiff", "avif", "bmp"],
  audio: ["mp3", "wav", "m4a", "aac", "aif", "aiff", "flac", "ogg", "opus", "caf"],
};
const kindOf = (ext: string): MediaKind | null =>
  (Object.keys(EXTS) as MediaKind[]).find((k) => EXTS[k].includes(ext)) ?? null;
export const ACCEPTED = Object.values(EXTS).flat();

export async function readMedia(id: string, mid: string): Promise<Media | null> {
  if (!isId(id) || !isId(mid)) return null;
  try {
    return JSON.parse(await readFile(recordFile(id, mid), "utf8")) as Media;
  } catch {
    return null;
  }
}

async function writeMedia(id: string, media: Media) {
  const file = recordFile(id, media.id);
  await writeFile(`${file}.tmp`, `${JSON.stringify(media, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
}

// Changes a record in place (one change at a time per file).
const g = globalThis as {
  __mediaLocks?: Map<string, Promise<unknown>>;
  __mediaJobs?: { queue: Job[]; running: Set<string> };
  __transcribing?: { queue: Job[]; running: string | null };
  __cutting?: { queue: Job[]; running: string | null };
};
const locks = (g.__mediaLocks ??= new Map());
function update(id: string, mid: string, change: (m: Media) => Partial<Media>) {
  const key = `${id}/${mid}`;
  const run = (locks.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const m = await readMedia(id, mid);
      if (!m) return null;
      const next = { ...m, ...change(m) };
      await writeMedia(id, next);
      return next;
    });
  locks.set(key, run);
  return run;
}

// Every file in the film, oldest first (the order they came in). Files left
// half made by a server restart are picked up again.
export async function listMedia(id: string): Promise<Media[]> {
  if (!isId(id)) return [];
  const mids = (await readdir(mediaRoot(id)).catch(() => [])).filter(isId);
  const all = (await Promise.all(mids.map((mid) => readMedia(id, mid)))).filter((m): m is Media => m !== null);
  for (const m of all) {
    const key = `${id}/${m.id}`;
    if (m.status === "importing" && !jobs.running.has(key) && !jobs.queue.some((j) => `${j.id}/${j.mid}` === key)) {
      enqueue({ id, mid: m.id });
    }
    if (m.transcribing && transcribing.running !== key && !transcribing.queue.some((j) => `${j.id}/${j.mid}` === key)) {
      transcribing.queue.push({ id, mid: m.id });
      nextTranscription();
    }
    if (m.cutting && cutting.running !== key && !cutting.queue.some((j) => `${j.id}/${j.mid}` === key)) {
      cutting.queue.push({ id, mid: m.id });
      nextCutout();
    }
  }
  const at = async (m: Media) => (await stat(mediaDir(id, m.id)).catch(() => null))?.birthtimeMs ?? 0;
  const times = new Map(await Promise.all(all.map(async (m) => [m.id, await at(m)] as const)));
  return all.sort((a, b) => (times.get(a.id) ?? 0) - (times.get(b.id) ?? 0));
}

// ─── Bringing a file in ───────────────────────────────────────────────────────

export class MediaError extends Error {}

export async function importMedia(id: string, name: string, body: ReadableStream<Uint8Array>): Promise<Media> {
  const clean = path.basename(name).replace(/[\u0000-\u001f]/g, "").trim().slice(0, 200) || "Untitled";
  const ext = (path.extname(clean).slice(1) || "").toLowerCase();
  const kind = kindOf(ext);
  if (!kind) throw new MediaError(`The studio can't use .${ext || "?"} files. Bring in a video, photo or sound file.`);
  const mid = newId();
  const dir = mediaDir(id, mid);
  await mkdir(dir, { recursive: true });
  const original = `original.${ext}`;
  // Streamed to disk as it arrives; a dropped connection leaves nothing.
  try {
    await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream), createWriteStream(path.join(dir, `${original}.part`)));
    await rename(path.join(dir, `${original}.part`), path.join(dir, original));
  } catch {
    await rm(dir, { recursive: true, force: true });
    throw new MediaError("The file didn't arrive in full. Try bringing it in again.");
  }
  const media: Media = {
    id: mid,
    kind,
    name: clean,
    original,
    proxy: null,
    thumbs: null,
    thumbEvery: null,
    peaks: null,
    transcript: null,
    cutout: null,
    width: null,
    height: null,
    duration: null,
    fps: null,
    hasAudio: kind !== "image",
    status: "importing",
    step: "Waiting to start",
  };
  await writeMedia(id, media);
  enqueue({ id, mid });
  return media;
}

// Removes a file the edit doesn't use.
export async function deleteMedia(id: string, mid: string): Promise<"gone" | "in use" | "missing"> {
  const media = await readMedia(id, mid);
  if (!media) return "missing";
  const edit = await readFile(path.join(filmDir(id), "edit.json"), "utf8")
    .then((t) => JSON.parse(t) as Edit)
    .catch(() => null);
  const used = edit?.tracks.some((t) => t.items.some((i) => i.type === "clip" && i.media === mid));
  if (used) return "in use";
  await rm(mediaDir(id, mid), { recursive: true, force: true });
  return "gone";
}

// ─── The background work ─────────────────────────────────────────────────────

type Job = { id: string; mid: string };
const jobs = (g.__mediaJobs ??= { queue: [], running: new Set() });
const AT_ONCE = 2;

function enqueue(job: Job) {
  jobs.queue.push(job);
  pump();
}

function pump() {
  while (jobs.running.size < AT_ONCE && jobs.queue.length) {
    const job = jobs.queue.shift()!;
    const key = `${job.id}/${job.mid}`;
    jobs.running.add(key);
    prepare(job)
      .catch(async (error) => {
        await update(job.id, job.mid, () => ({
          status: "failed",
          step: undefined,
          error: error instanceof MediaError ? error.message : "The studio couldn't read this file. It may be damaged or in a format it doesn't know. Try another file.",
        }));
        console.error(`[studio media] ${key}:`, error);
      })
      .finally(() => {
        jobs.running.delete(key);
        pump();
      });
  }
}

// Runs a command; resolves with what it printed. `onLine` sees each line.
function run(cmd: string, args: string[], onLine?: (line: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let rest = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
      if (!onLine) return;
      const lines = (rest + chunk).split(/\r?\n/);
      rest = lines.pop() ?? "";
      lines.forEach(onLine);
    });
    child.stderr.on("data", (chunk) => (err = (err + chunk).slice(-4000)));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${code}: ${err.trim().split("\n").slice(-3).join(" ")}`))));
  });
}

type Probe = {
  streams?: {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    r_frame_rate?: string;
    duration?: string;
    disposition?: { attached_pic?: number };
    side_data_list?: { rotation?: number }[];
    tags?: { rotate?: string };
  }[];
  format?: { duration?: string };
};

const rate = (r?: string) => {
  const [a, b] = (r ?? "0/1").split("/").map(Number);
  return b ? a / b : 0;
};

async function probe(file: string): Promise<Probe> {
  const out = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file]);
  return JSON.parse(out) as Probe;
}

async function prepare({ id, mid }: Job) {
  const media = await readMedia(id, mid);
  if (!media) return;
  const dir = mediaDir(id, mid);
  const original = path.join(dir, media.original);
  const step = (text: string) => update(id, mid, () => ({ step: text }));

  if (media.kind === "image") return prepareImage(id, media, dir, original, step);

  await step("Reading the file");
  const info = await probe(original);
  const video = info.streams?.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const audio = info.streams?.find((s) => s.codec_type === "audio");
  const duration = Number(info.format?.duration ?? video?.duration ?? audio?.duration ?? 0);
  if (media.kind === "video" && !video) throw new MediaError("This file has no picture in it. Bring it in as sound, or try another file.");
  if (!duration) throw new MediaError("The studio couldn't tell how long this file is. Try another file.");

  if (media.kind === "video" && video) {
    const turned = Math.abs(video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? Number(video.tags?.rotate ?? 0)) % 180 === 90;
    const width = turned ? video.height! : video.width!;
    const height = turned ? video.width! : video.height!;
    const fps = Math.round(rate(video.avg_frame_rate) || rate(video.r_frame_rate) || 30);
    await update(id, mid, () => ({ width, height, duration, fps, hasAudio: !!audio }));

    // The preview copy: at most 1920 on its long side and 1080 on its short
    // one, a keyframe every 15 frames so scrubbing lands quickly, and the
    // sound as AAC.
    await step("Making a smooth preview copy");
    const fit = Math.min(1, 1920 / Math.max(width, height), 1080 / Math.min(width, height));
    const w = Math.max(2, Math.round((width * fit) / 2) * 2);
    const h = Math.max(2, Math.round((height * fit) / 2) * 2);
    const total = Math.round(duration * Math.min(fps, 60));
    let last = 0;
    await run(
      "ffmpeg",
      [
        "-y", "-loglevel", "error", "-progress", "pipe:1", "-nostats", "-i", original,
        "-map", "0:v:0", ...(audio ? ["-map", "0:a:0"] : []),
        "-vf", `scale=${w}:${h}:flags=bicubic,format=yuv420p`,
        "-r", String(Math.min(fps, 60)),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-g", "15", "-keyint_min", "15", "-sc_threshold", "0",
        ...(audio ? ["-c:a", "aac", "-b:a", "160k", "-ac", "2"] : []),
        "-movflags", "+faststart", "-f", "mp4", path.join(dir, "proxy.mp4.part"),
      ],
      (line) => {
        if (!line.startsWith("frame=")) return;
        const pct = Math.min(99, Math.floor((100 * Number(line.slice(6))) / Math.max(1, total)));
        if (pct >= last + 10) {
          last = pct;
          void step(`Making a smooth preview copy (${pct}%)`);
        }
      },
    );
    await rename(path.join(dir, "proxy.mp4.part"), path.join(dir, "proxy.mp4"));
    await update(id, mid, () => ({ proxy: "proxy.mp4" }));

    await step("Drawing the timeline strip");
    const every = stripEvery(duration);
    await thumbStrip(path.join(dir, "proxy.mp4"), path.join(dir, "thumbs.jpg"), duration, every);
    await update(id, mid, () => ({ thumbs: "thumbs.jpg", thumbEvery: every }));
  } else {
    await update(id, mid, () => ({ duration, hasAudio: true }));
    await step("Making a preview copy of the sound");
    await run("ffmpeg", [
      "-y", "-loglevel", "error", "-i", original, "-vn", "-c:a", "aac", "-b:a", "192k", "-ac", "2",
      "-movflags", "+faststart", "-f", "mp4", path.join(dir, "proxy.m4a.part"),
    ]);
    await rename(path.join(dir, "proxy.m4a.part"), path.join(dir, "proxy.m4a"));
    await update(id, mid, () => ({ proxy: "proxy.m4a" }));
  }

  if (audio || media.kind === "audio") {
    await step("Measuring the sound");
    await writeFile(path.join(dir, "peaks.json"), JSON.stringify(await peaks(original)));
    await update(id, mid, () => ({ peaks: "peaks.json" }));
  }
  await update(id, mid, () => ({ status: "ready", step: undefined, error: undefined }));
}

// Seconds between frames in the timeline strip: about a frame a second for
// short clips, never more than 240 frames for long ones.
const stripEvery = (duration: number) => (duration <= 30 ? 0.5 : duration <= 240 ? 1 : Math.ceil(duration / 240));

async function thumbStrip(video: string, out: string, duration: number, every: number) {
  const count = Math.max(1, Math.ceil(duration / every));
  await run("ffmpeg", [
    "-y", "-loglevel", "error", "-i", video,
    "-vf", `fps=1/${every},scale=-2:90:flags=bicubic,tile=${count}x1`,
    "-frames:v", "1", "-q:v", "5", `${out}.part.jpg`,
  ]);
  await rename(`${out}.part.jpg`, out);
}

// Loudness, 100 values a second, each the peak of its hundredth (0..1).
function peaks(file: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-loglevel", "error", "-i", file, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    const out: number[] = [];
    let peak = 0;
    let n = 0;
    let carry: Buffer | null = null;
    child.stdout.on("data", (chunk: Buffer) => {
      const buf = carry ? Buffer.concat([carry, chunk]) : chunk;
      const even = buf.length - (buf.length % 2);
      for (let i = 0; i < even; i += 2) {
        peak = Math.max(peak, Math.abs(buf.readInt16LE(i)));
        if (++n === 80) {
          out.push(Math.round((peak / 32768) * 1000) / 1000);
          peak = 0;
          n = 0;
        }
      }
      carry = even < buf.length ? buf.subarray(even) : null;
    });
    child.on("error", reject);
    child.on("close", () => {
      if (n) out.push(Math.round((peak / 32768) * 1000) / 1000);
      resolve(out);
    });
  });
}

// A photo: a web-ready copy (PNG when it has see-through parts, JPEG when
// not) at most 4096 on its long side, and a small one for the timeline.
async function prepareImage(id: string, media: Media, dir: string, original: string, step: (t: string) => Promise<unknown>) {
  await step("Reading the photo");
  let source = original;
  const ext = path.extname(original).slice(1).toLowerCase();
  if (ext === "heic" || ext === "heif") {
    source = path.join(dir, "converted.jpg");
    await heicToJpeg(original, source);
  }
  const image = sharp(source, { animated: false }).rotate();
  const meta = await image.metadata();
  const alpha = !!meta.hasAlpha;
  const name = alpha ? "image.png" : "image.jpg";
  await step("Making a preview copy");
  const resized = image.resize({ width: 4096, height: 4096, fit: "inside", withoutEnlargement: true });
  const info = alpha
    ? await resized.png().toFile(path.join(dir, name))
    : await resized.jpeg({ quality: 92, mozjpeg: true }).toFile(path.join(dir, name));
  await sharp(path.join(dir, name)).resize({ height: 90 }).jpeg({ quality: 80 }).toFile(path.join(dir, "thumbs.jpg"));
  if (source !== original) await rm(source, { force: true });
  await update(id, media.id, () => ({
    proxy: name,
    thumbs: "thumbs.jpg",
    width: info.width,
    height: info.height,
    hasAudio: false,
    status: "ready",
    step: undefined,
  }));
}

// ─── What's said ──────────────────────────────────────────────────────────────

const transcribing = (g.__transcribing ??= { queue: [], running: null });

// Starts listening to a file's speech (one file at a time across the
// studio; it uses the whole machine). Returns the record, or null.
export async function startTranscription(id: string, mid: string): Promise<Media | null | "no sound" | "not ready"> {
  const media = await readMedia(id, mid);
  if (!media) return null;
  if (media.status !== "ready") return "not ready";
  if (!media.hasAudio) return "no sound";
  if (media.transcribing) return media;
  const next = await update(id, mid, () => ({ transcribing: true, step: "Waiting to listen", error: undefined }));
  transcribing.queue.push({ id, mid });
  nextTranscription();
  return next;
}

function nextTranscription() {
  if (transcribing.running || !transcribing.queue.length) return;
  const { id, mid } = transcribing.queue.shift()!;
  transcribing.running = `${id}/${mid}`;
  const finish = (change: Partial<Media>) =>
    update(id, mid, () => ({ transcribing: false, step: undefined, ...change })).finally(() => {
      transcribing.running = null;
      nextTranscription();
    });
  readMedia(id, mid).then((media) => {
    if (!media) return finish({});
    const child = spawn(
      process.execPath,
      ["scripts/studio/transcribe.mjs", path.join(mediaDir(id, mid), media.original), path.join(mediaDir(id, mid), "transcript.json")],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );
    let rest = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      const lines = (rest + chunk).split(/\r?\n/);
      rest = lines.pop() ?? "";
      for (const line of lines) if (line.startsWith("step ")) void update(id, mid, () => ({ step: line.slice(5) }));
    });
    child.stderr.on("data", (chunk) => (err = (err + chunk).slice(-4000)));
    child.on("close", (code) => {
      if (code === 0) return void finish({ transcript: "transcript.json" });
      console.error(`[studio transcribe] ${id}/${mid}: ${err}`);
      const said = err.trim().split("\n").at(-1) ?? "";
      void finish({
        error: said.startsWith("! ") ? said.slice(2) : "The studio couldn't listen to this file. Try again in a moment.",
      });
    });
    child.on("error", () => void finish({ error: "The studio couldn't start listening. Try again in a moment." }));
  });
}

// ─── Cutting the person out ───────────────────────────────────────────────────

// For layouts where someone stands in front of the graphics (the reel's
// pop-out): macOS's own person finder (scripts/native/vision.swift, the face
// finder's binary, compiled once) draws a mask of them in every frame of
// the preview copy, following them from frame to frame so the edge holds;
// ffmpeg folds the masks in as transparency and writes cutout.webm, VP9
// with the sound kept, which the browser plays see-through. Nothing leaves
// the Mac. One at a time across the studio: it uses the whole machine.
const cutting = (g.__cutting ??= { queue: [], running: null });

export async function startCutout(id: string, mid: string): Promise<Media | null | "not ready" | "not video"> {
  const media = await readMedia(id, mid);
  if (!media) return null;
  if (media.kind !== "video") return "not video";
  if (media.status !== "ready" || !media.proxy) return "not ready";
  // Made already with the crisp edge: nothing to do. An older, softer one
  // is made again, playing until the new one is ready.
  if (media.cutting || (media.cutout && media.cutoutCrisp)) return media;
  const next = await update(id, mid, () => ({ cutting: true, step: "Waiting to cut you out", error: undefined }));
  cutting.queue.push({ id, mid });
  nextCutout();
  return next;
}

function nextCutout() {
  if (cutting.running || !cutting.queue.length) return;
  const { id, mid } = cutting.queue.shift()!;
  cutting.running = `${id}/${mid}`;
  const finish = (change: Partial<Media>) =>
    update(id, mid, () => ({ cutting: false, step: undefined, ...change })).finally(() => {
      cutting.running = null;
      nextCutout();
    });
  cutOut(id, mid).then(
    () => finish({ cutout: "cutout.webm", cutoutCrisp: true }),
    (error) => {
      console.error(`[studio cutout] ${id}/${mid}:`, error);
      return finish({ error: "The studio couldn't cut the person out of this clip. Try a clip where they're closer to the camera." });
    },
  );
}

// The person finder as [program, arguments before the job's own]: macOS's
// Vision on a Mac; elsewhere the same jobs run with MediaPipe in Chrome
// (scripts/native/vision.mjs).
async function vision(): Promise<[string, string[]]> {
  if (!IS_MAC) return [process.execPath, [path.join(ROOT, "scripts/native/vision.mjs")]];
  const source = path.join(ROOT, "scripts/native/vision.swift");
  const binary = path.join(ROOT, "node_modules/.cache/speaker-post/vision");
  if (existsSync(binary) && statSync(binary).mtimeMs >= statSync(source).mtimeMs) return [binary, []];
  await mkdir(path.dirname(binary), { recursive: true });
  // eslint-disable-next-line no-restricted-syntax -- Mac only; elsewhere vision.mjs, above
  await run("swiftc", ["-O", source, "-o", binary]);
  return [binary, []];
}

async function cutOut(id: string, mid: string) {
  const media = await readMedia(id, mid);
  if (!media?.proxy) throw new Error("no preview copy");
  const dir = mediaDir(id, mid);
  const proxy = path.join(dir, media.proxy);
  const masks = await mkdtemp(path.join(tmpdir(), "studio-cutout-"));
  try {
    await update(id, mid, () => ({ step: "Finding you in each frame" }));
    const [finder, before] = await vision();
    const frames = Number((await run(finder, [...before, "matte", proxy, masks])).trim());
    if (!frames) throw new Error("no frames");
    // The masks come one per frame of the preview copy, which runs at a steady rate (see prepare).
    const fps = Math.min(media.fps ?? 30, 60);
    await update(id, mid, () => ({ step: "Making the cutout" }));
    await run("ffmpeg", [
      "-y", "-loglevel", "error", "-i", proxy, "-framerate", String(fps), "-i", path.join(masks, "m%05d.png"),
      "-filter_complex", "[1:v]format=gray[a];[0:v][a]alphamerge,format=yuva420p[v]",
      "-map", "[v]", ...(media.hasAudio ? ["-map", "0:a:0", "-c:a", "libopus", "-b:a", "128k"] : []),
      "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "22", "-row-mt", "1", "-deadline", "good", "-cpu-used", "5",
      "-shortest", "-f", "webm", path.join(dir, "cutout.webm.part"),
    ]);
    await rename(path.join(dir, "cutout.webm.part"), path.join(dir, "cutout.webm"));
  } finally {
    await rm(masks, { recursive: true, force: true });
  }
}
