// The studio Claude's eyes and ears on a video film's footage. Claude can't
// open the big original files; it runs this instead and gets short, plain
// answers (and small still frames it can look at).
//
// usage (from films/<id>/):
//   node <project>/scripts/studio/media-tool.mjs <id> list
//   node … <id> words <media> [from] [to]   what's said, as timed lines (source seconds),
//                                          each word with its number
//   node … <id> cut <media> <numbers…> [--keep-pause]
//                                          cuts those words from the edit, in the quiet
//                                          around them, and closes the gap
//   node … <id> fillers [--cut]            um, uh and the like in the edit (and cuts them)
//   node … <id> pauses [seconds] [--cut]   pauses longer than that (0.8) (and shortens them)
//   node … <id> silences <media> [min-seconds] [threshold-dB]
//   node … <id> scenes <media> [sensitivity 0..1]
//   node … <id> frames <media> <t> [t …]    small JPEGs to Read, in films/.work/<id>/frames/
//   node … <id> faces <media> [every-seconds] where the main face sits over time
//   node … <id> cutout <media>             the person cut out of their background,
//                                          for clips with "cutout": true (waits until made)
//
// It only ever looks at the film it is run from: the id must be that
// folder's, and media ids are checked against films/<id>/media/. Every
// argument is checked before anything runs, and nothing goes through a
// shell, so a command can't be bent into doing something else.

import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readToken, STUDIO_URL } from "./client.mjs";
import { resolveEdit } from "../../src/lib/studio/films/anchors.ts";
import { cutPauses, cutWords, fillers, filmEnd } from "../../src/lib/studio/films/cuts.ts";
import { readTranscriptsSync } from "../../src/lib/studio/films/edit-file.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const exec = promisify(execFile);

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const [id, command, ...rest] = process.argv.slice(2);
const dir = process.cwd();
if (!/^[a-z0-9]{8}$/.test(id ?? "") || dir !== path.join(ROOT, "films", id)) {
  fail("Run this from the film's own folder, with that film's id: node …/media-tool.mjs <id> <command>.");
}
const mediaDir = path.join(dir, "media");
const workDir = path.join(ROOT, "films/.work", id);

// ─── Footage ────────────────────────────────────────────────────────────────

const VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi|mts)$/i;
const AUDIO = /\.(wav|mp3|m4a|aac|aif|aiff|flac|ogg|opus)$/i;
const IMAGE = /\.(jpe?g|png|webp|gif|heic|tiff?)$/i;

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

// What's known about one media item: media.json if the import wrote one,
// filled in from the files themselves otherwise.
function media(mid) {
  if (!/^[a-z0-9]{8}$/.test(mid ?? "")) fail(`"${mid}" isn't a media id. Run \`list\` to see the footage and its ids.`);
  const folder = path.join(mediaDir, mid);
  if (!existsSync(folder)) fail(`There's no media "${mid}" in this film. Run \`list\` to see what there is.`);
  const meta = readJson(path.join(folder, "media.json")) ?? {};
  const files = readdirSync(folder);
  const original = meta.original && files.includes(meta.original) ? meta.original : files.find((f) => f.startsWith("original."));
  const kind = meta.kind ?? (original && VIDEO.test(original) ? "video" : original && AUDIO.test(original) ? "audio" : original && IMAGE.test(original) ? "image" : null);
  // The proxy is lighter to read and has the same timing.
  const source = files.includes("proxy.mp4") ? path.join(folder, "proxy.mp4") : original ? path.join(folder, original) : null;
  return { mid, folder, meta, files, original, kind, source };
}

const listMedia = () =>
  existsSync(mediaDir) ? readdirSync(mediaDir).filter((m) => /^[a-z0-9]{8}$/.test(m)).sort() : [];

async function probe(file) {
  try {
    const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,r_frame_rate", "-of", "json", file]);
    const j = JSON.parse(stdout);
    const v = j.streams?.find((s) => s.codec_type === "video");
    const [n, d] = String(v?.r_frame_rate ?? "0/1").split("/").map(Number);
    return {
      duration: Number(j.format?.duration) || null,
      width: v?.width ?? null,
      height: v?.height ?? null,
      fps: d ? Math.round((n / d) * 100) / 100 : null,
      hasAudio: j.streams?.some((s) => s.codec_type === "audio") ?? false,
    };
  } catch {
    return {};
  }
}

const secs = (t) => (t == null ? "?" : `${Number(t).toFixed(2)}`);
const words = (m) => {
  const file = path.join(m.folder, "transcript.json");
  const w = readJson(file);
  return Array.isArray(w) ? w : null;
};
const number = (raw, name, { min = -Infinity, max = Infinity } = {}) => {
  const v = Number(raw);
  if (raw === undefined || !Number.isFinite(v) || v < min || v > max) fail(`${name} must be a number${Number.isFinite(min) ? ` from ${min}` : ""}${Number.isFinite(max) ? ` to ${max}` : ""}.`);
  return v;
};
const needsMoving = (m) => {
  if (!m.source || m.kind === "image" || m.kind === "audio") fail(`"${m.meta.name ?? m.mid}" isn't video.`);
};

// ─── Commands ───────────────────────────────────────────────────────────────

async function list() {
  const ids = listMedia();
  if (!ids.length) return console.log("This film has no footage yet. The person adds it by dropping files on the studio.");
  for (const mid of ids) {
    const m = media(mid);
    const p = { ...(m.source && m.kind !== "image" ? await probe(m.source) : {}), ...Object.fromEntries(Object.entries(m.meta).filter(([, v]) => v != null)) };
    const bits = [
      m.kind ?? "unknown",
      p.duration ? `${secs(p.duration)} s` : null,
      p.width ? `${p.width}x${p.height}` : null,
      p.fps ? `${p.fps} fps` : null,
      m.kind === "image" ? null : p.hasAudio ? "has sound" : "no sound",
      words(m) ? `transcript (${words(m).length} words)` : "no transcript",
      m.meta.status && m.meta.status !== "ready" ? `status ${m.meta.status}` : null,
    ].filter(Boolean);
    console.log(`${mid}  "${m.meta.name ?? m.original ?? mid}"  ${bits.join(", ")}`);
  }
}

// The transcript as lines: a new line after a pause, a full stop or ~12 words.
function said(mid, fromRaw, toRaw) {
  const m = media(mid);
  const all = words(m);
  if (!all) fail(`"${m.meta.name ?? mid}" has no transcript yet. It can be made from the studio (Transcribe), or use \`silences\` to find where speech is.`);
  const from = fromRaw === undefined ? 0 : number(fromRaw, "from", { min: 0 });
  const to = toRaw === undefined ? Infinity : number(toRaw, "to", { min: from });
  const picked = all.map((w, n) => ({ ...w, n })).filter((w) => w.end > from && w.start < to);
  if (!picked.length) return console.log(`Nothing is said between ${secs(from)} and ${toRaw === undefined ? "the end" : secs(to)} s.`);
  console.log(`Times are seconds in the source. Each word has its number (12:machine): cut words by number with \`cut ${mid} 12-14\`, and fix things to a word with "${mid}:12". A word marked (?) was heard with low confidence.`);
  let line = [];
  const flush = () => {
    if (!line.length) return;
    const text = line.map((w) => `${w.n}:${w.text}${w.confidence != null && w.confidence < 0.6 ? "(?)" : ""}`).join(" ");
    console.log(`${secs(line[0].start)}-${secs(line.at(-1).end)}  ${text}`);
    line = [];
  };
  for (const [i, w] of picked.entries()) {
    const prev = picked[i - 1];
    if (prev && (w.start - prev.end > 0.6 || /[.!?]$/.test(prev.text) || line.length >= 12)) {
      if (w.start - prev.end > 0.6) {
        flush();
        console.log(`          (pause ${secs(w.start - prev.end)} s)`);
      } else flush();
    }
    line.push(w);
  }
  flush();
}

async function silences(mid, minRaw, dbRaw) {
  const m = media(mid);
  if (!m.source || m.kind === "image") fail(`"${m.meta.name ?? mid}" has no sound to look at.`);
  const min = minRaw === undefined ? 0.4 : number(minRaw, "min-seconds", { min: 0.1, max: 10 });
  const db = dbRaw === undefined ? -32 : number(dbRaw, "threshold-dB", { min: -80, max: -5 });
  const out = await ffmpegLog(["-i", m.source, "-vn", "-af", `silencedetect=noise=${db}dB:d=${min}`, "-f", "null", "-"]);
  const starts = [...out.matchAll(/silence_start: (-?[\d.]+)/g)].map((x) => Math.max(0, Number(x[1])));
  const ends = [...out.matchAll(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g)].map((x) => Number(x[1]));
  if (!starts.length) return console.log(`No silences of ${min} s or more (quieter than ${db} dB).`);
  console.log(`Silences of ${min} s or more, quieter than ${db} dB (source seconds):`);
  for (const [i, s] of starts.entries()) {
    const e = ends[i];
    console.log(e === undefined ? `${secs(s)}-end` : `${secs(s)}-${secs(e)}  (${secs(e - s)} s)`);
  }
}

async function scenes(mid, sensRaw) {
  const m = media(mid);
  needsMoving(m);
  const sens = sensRaw === undefined ? 0.3 : number(sensRaw, "sensitivity", { min: 0.05, max: 0.95 });
  const out = await ffmpegLog(["-i", m.source, "-an", "-vf", `select='gt(scene,${sens})',showinfo`, "-f", "null", "-"]);
  const times = [...out.matchAll(/pts_time:([\d.]+)/g)].map((x) => Number(x[1]));
  if (!times.length) return console.log(`No cuts or big changes found (sensitivity ${sens}; lower finds more).`);
  console.log(`Cuts or big changes at (source seconds): ${times.map(secs).join(", ")}`);
}

async function frames(mid, raw) {
  const m = media(mid);
  if (!raw.length) fail("Give one or more times in seconds: frames <media> 1.5 4 10.");
  if (raw.length > 12) fail("At most 12 frames at a time.");
  const times = raw.map((t) => number(t, "Each time", { min: 0 }));
  const out = path.join(workDir, "frames");
  mkdirSync(out, { recursive: true });
  // Old frames go, so the folder never grows.
  for (const f of readdirSync(out)) rmSync(path.join(out, f), { force: true });
  if (m.kind === "image") {
    const file = path.join(out, `${mid}-still.jpg`);
    await exec("ffmpeg", ["-v", "error", "-y", "-i", path.join(m.folder, m.original), "-vf", "scale='min(640,iw)':-2", "-frames:v", "1", "-q:v", "4", file]);
    return console.log(`Read this file to see it: ${file}`);
  }
  needsMoving(m);
  for (const t of times) {
    const file = path.join(out, `${mid}-${t.toFixed(2)}s.jpg`);
    await exec("ffmpeg", ["-v", "error", "-y", "-ss", String(t), "-i", m.source, "-vf", "scale='min(640,iw)':-2", "-frames:v", "1", "-q:v", "4", file]);
    if (!existsSync(file)) console.log(`${secs(t)} s: past the end of the footage.`);
    else console.log(`${secs(t)} s: ${file}`);
  }
  console.log("Read these files to see the frames.");
}

async function faces(mid, everyRaw) {
  const m = media(mid);
  const bin = await vision();
  if (m.kind === "image") {
    const p = await probeImage(path.join(m.folder, m.original));
    const face = await faceIn(bin, path.join(m.folder, m.original));
    return console.log(face && p ? describe(face, p.width, p.height) : "No face found in this photo.");
  }
  needsMoving(m);
  const info = await probe(m.source);
  if (!info.duration || !info.width) fail("Can't read this footage's size or length.");
  const every = everyRaw === undefined ? Math.max(0.5, Math.min(5, info.duration / 40)) : number(everyRaw, "every-seconds", { min: 0.25, max: 30 });
  const tmp = path.join(tmpdir(), `studio-faces-${id}-${process.pid}`);
  mkdirSync(tmp, { recursive: true });
  try {
    await exec("ffmpeg", ["-v", "error", "-y", "-i", m.source, "-vf", `fps=1/${every},scale=${Math.min(960, info.width)}:-2`, "-q:v", "4", path.join(tmp, "f%05d.jpg")]);
    const shots = readdirSync(tmp).filter((f) => f.endsWith(".jpg")).sort();
    const scale = info.width / Math.min(960, info.width);
    console.log(`Main face, sampled every ${secs(every)} s; a line only when it moves. x and y are the face centre as 0..1 of the source frame (${info.width}x${info.height}); size is the face height as a share of the frame height.`);
    let last = null;
    for (const [i, shot] of shots.entries()) {
      const t = i * every + every / 2;
      const f = await faceIn(bin, path.join(tmp, shot));
      const line = f
        ? `x ${((f.x + f.width / 2) * scale / info.width).toFixed(2)}, y ${((f.y + f.height / 2) * scale / info.height).toFixed(2)}, size ${(f.height * scale / info.height).toFixed(2)}`
        : "no face";
      if (line !== last) console.log(`${secs(t)} s  ${line}`);
      last = line;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const describe = (f, w, h) =>
  `Face centre x ${((f.x + f.width / 2) / w).toFixed(3)}, y ${((f.y + f.height / 2) / h).toFixed(3)} (0..1 of the photo), height ${(f.height / h).toFixed(2)} of the photo.`;

async function probeImage(file) {
  const p = await probe(file);
  return p.width ? p : null;
}

// The Mac's own face finder (scripts/native/vision.swift), compiled once.
async function vision() {
  const source = path.join(ROOT, "scripts/native/vision.swift");
  const binary = path.join(ROOT, "node_modules/.cache/speaker-post/vision");
  if (existsSync(binary) && statSync(binary).mtimeMs >= statSync(source).mtimeMs) return binary;
  try {
    mkdirSync(path.dirname(binary), { recursive: true });
    await exec("swiftc", ["-O", source, "-o", binary], { timeout: 180_000 });
    return binary;
  } catch {
    fail("The face finder couldn't be built on this Mac (it needs Swift).");
  }
}

async function faceIn(bin, image) {
  try {
    const { stdout } = await exec(bin, ["face", image], { timeout: 30_000 });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

// ffmpeg prints filter reports on stderr.
const ffmpegLog = (args) =>
  new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-hide_banner", "-nostats", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let log = "";
    proc.stderr.on("data", (d) => (log += d));
    proc.on("error", reject);
    proc.on("close", () => resolve(log));
  });

// The person cut out of a video's background (cutout.webm), made by the
// studio itself (media.ts startCutout), for clips set "cutout": true: the
// reel's pop-out, a speaker standing in front of the graphics. Waits until
// it's made, saying how far along it is.
async function cutout(mid) {
  const m = media(mid);
  if (m.kind !== "video") fail("Only a video can be cut out.");
  const made = () => readJson(path.join(m.folder, "media.json")) ?? {};
  if (made().cutout && existsSync(path.join(m.folder, made().cutout))) {
    return console.log(`"${m.meta.name ?? mid}" is already cut out. Set "cutout": true on its clips to show the person alone.`);
  }
  let token;
  try {
    token = await readToken({ create: false });
  } catch {
    token = null;
  }
  const res = await fetch(`${STUDIO_URL}/api/studio/films/${id}/media/${mid}/cutout`, { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} }).catch(() => null);
  if (!res) fail("The studio isn't answering, so the cutout can't start. Try again in a moment.");
  if (!res.ok) fail((await res.json().catch(() => null))?.error ?? "The studio couldn't start the cutout.");
  let said = "";
  const until = Date.now() + 20 * 60_000;
  while (Date.now() < until) {
    const now = made();
    if (now.cutout && !now.cutting) return console.log(`Cut out: "${now.name ?? mid}". Set "cutout": true on its clips; what's beneath them shows round the person.`);
    if (!now.cutting && now.error) fail(now.error);
    if (now.step && now.step !== said) console.log((said = now.step));
    await new Promise((r) => setTimeout(r, 1500));
  }
  fail("The cutout is taking a long time. It carries on in the studio; run this again later to see if it's done.");
}

// ─── Cutting by words ───────────────────────────────────────────────────────

const editPath = path.join(dir, "edit.json");
function readEditFile() {
  const edit = readJson(editPath);
  if (!edit?.tracks) fail("This film has no edit yet (edit.json), so there's nothing to cut.");
  return edit;
}
const peaksFor = (edit) => {
  const out = {};
  for (const mid of new Set(edit.tracks.flatMap((t) => t.items.filter((i) => i.type === "clip").map((i) => i.media)))) {
    if (/^[a-z0-9]{8}$/.test(mid)) out[mid] = readJson(path.join(mediaDir, mid, "peaks.json")) ?? undefined;
  }
  return out;
};
// Writes the cut edit and the film's new length, each whole (a temp file,
// then renamed in), then says what changed in words.
function saveCut(edit, result) {
  if (!result.removed.length) {
    console.log("Nothing to cut: none of those words play in the edit.");
    if (result.skipped.length) console.log(`Not in the edit: ${result.skipped.join(", ")}.`);
    return;
  }
  const transcripts = readTranscriptsSync(dir, result.edit);
  const { notes } = resolveEdit(result.edit, transcripts);
  writeFileSync(`${editPath}.tmp`, `${JSON.stringify(result.edit, null, 2)}\n`);
  renameSync(`${editPath}.tmp`, editPath);
  const filmPath = path.join(dir, "film.json");
  const film = readJson(filmPath);
  if (film) {
    film.duration = Math.max(1, Math.round(filmEnd(result.edit) * 1000) / 1000);
    writeFileSync(`${filmPath}.tmp`, `${JSON.stringify(film, null, 2)}\n`);
    renameSync(`${filmPath}.tmp`, filmPath);
  }
  const total = result.removed.reduce((n, r) => n + r.seconds, 0);
  for (const r of result.removed) console.log(`Cut "${r.said}" (${r.seconds.toFixed(2)} s)`);
  console.log(`The film is ${total.toFixed(2)} s shorter: ${film ? `${film.duration.toFixed(2)} s now` : "edit.json saved"}.`);
  if (result.skipped.length) console.log(`Not in the edit, so not cut: ${result.skipped.join(", ")}.`);
  for (const note of notes) console.log(`Moved: ${note}`);
}

// "12-18 22 25" as word numbers.
function wordNumbers(raw) {
  const out = [];
  for (const part of raw) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) fail(`"${part}" isn't a word number or a range like 12-18.`);
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    if (b < a || b - a > 2000) fail(`"${part}" isn't a range from a lower number to a higher one.`);
    for (let n = a; n <= b; n++) out.push(n);
  }
  if (!out.length) fail("Name the words to cut by number, like: cut <media> 12-18 22. `words <media>` shows the numbers.");
  return out;
}

function cut(mid, args) {
  const m = media(mid);
  if (!words(m)) fail(`"${m.meta.name ?? mid}" has no transcript yet, so its words can't be cut. Transcribe it in the studio first.`);
  const keepPause = args.includes("--keep-pause");
  const refs = wordNumbers(args.filter((a) => a !== "--keep-pause")).map((n) => `${mid}:${n}`);
  const edit = readEditFile();
  saveCut(edit, cutWords(edit, readTranscriptsSync(dir, edit), peaksFor(edit), refs, { keepPause }));
}

function fillerWords(args) {
  const edit = readEditFile();
  const transcripts = readTranscriptsSync(dir, edit);
  const found = fillers(edit, transcripts);
  if (!found.length) return console.log("No fillers (um, uh, erm, a set-off \"like\" or \"you know\") in the edit.");
  if (!args.includes("--cut")) {
    const list = found.map((ref) => {
      const [mid, n] = ref.split(":");
      return `${ref} "${transcripts[mid]?.[Number(n)]?.text ?? "?"}"`;
    });
    console.log(`${found.length} filler${found.length > 1 ? "s" : ""}: ${list.join(", ")}. Cut them all with \`fillers --cut\`, or some with \`cut\`.`);
    return;
  }
  saveCut(edit, cutWords(edit, transcripts, peaksFor(edit), found));
}

function pauses(args) {
  const longerRaw = args.find((a) => !a.startsWith("--"));
  const longer = longerRaw === undefined ? 0.8 : number(longerRaw, "seconds", { min: 0.3, max: 10 });
  const edit = readEditFile();
  const result = cutPauses(edit, readTranscriptsSync(dir, edit), peaksFor(edit), { longer, keep: 0.3 });
  if (!result.removed.length) return console.log(`No pauses longer than ${longer} s in the edit.`);
  if (!args.includes("--cut")) {
    for (const r of result.removed) console.log(`${r.said}: ${(r.seconds + 0.3).toFixed(2)} s`);
    console.log(`Shorten them all to 0.3 s with \`pauses ${longerRaw ?? ""}${longerRaw ? " " : ""}--cut\`.`);
    return;
  }
  saveCut(edit, result);
}

// ─── Run ────────────────────────────────────────────────────────────────────

const commands = {
  list: () => list(),
  words: () => said(rest[0], rest[1], rest[2]),
  silences: () => silences(rest[0], rest[1], rest[2]),
  scenes: () => scenes(rest[0], rest[1]),
  frames: () => frames(rest[0], rest.slice(1)),
  faces: () => faces(rest[0], rest[1]),
  cutout: () => cutout(rest[0]),
  cut: () => cut(rest[0], rest.slice(1)),
  fillers: () => fillerWords(rest),
  pauses: () => pauses(rest),
};
if (!commands[command]) fail(`Commands: ${Object.keys(commands).join(", ")}.`);
await commands[command]();
