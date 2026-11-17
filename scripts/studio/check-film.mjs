// Checks the studio film in the current folder, the way its engine allows:
//   html  HyperFrames' own check: lint, runtime, layout, motion, contrast
//   react the component bundles (catches typos and missing imports)
//   rust  the crate builds, offline, inside a sandbox
//   video (a react film of kind "video"): edit.json against
//         src/lib/studio/films/edit.ts and the footage, then the film's own
//         graphics and component bundle
//
// This is the one command the studio's Claude may run to check its work
// (see src/lib/studio/agent/claude.ts), so it takes no arguments: it always
// checks the film it is run from, and nothing else.
//
// usage (from films/<id>/): node <project>/scripts/studio/check-film.mjs

import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { IS_MAC, packageBin } from "./platform.mjs";
import { parseWordRef, resolveEdit } from "../../src/lib/studio/films/anchors.ts";
import { readTranscriptsSync } from "../../src/lib/studio/films/edit-file.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dir = process.cwd();

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (path.dirname(dir) !== path.join(ROOT, "films") || !existsSync(path.join(dir, "film.json"))) {
  fail("Run this from a film's folder (films/<id>/).");
}
const film = JSON.parse(readFileSync(path.join(dir, "film.json"), "utf8"));
// What moved because its word was cut (checkEdit fills it in).
let editNotes = [];

const run = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd: dir, stdio: "inherit", ...opts });
    proc.on("close", (code) => resolve(code ?? 1));
    proc.on("error", (error) => {
      console.error(String(error));
      resolve(1);
    });
  });

// The sound design, if the film has one: the score loads, plays and sounds
// the same each time it renders (sound.mjs --check renders it twice).
if (existsSync(path.join(dir, "sound/score.js"))) {
  const code = await run(process.execPath, [path.join(ROOT, "scripts/studio/sound.mjs"), film.id, "--check"]);
  if (code !== 0) process.exit(code);
}

// Bundles the film exactly as the studio's stage does (its component, its
// own graphics and the shared kit and library): catches typos, bad JSX and
// missing imports.
const bundleStage = () =>
  run(process.execPath, [
    path.join(ROOT, "scripts/studio/stage-bundle.mjs"),
    dir,
    path.join(tmpdir(), `studio-check-${film.id}.js`),
  ]);

if (film.kind === "video") {
  const problems = checkEdit();
  if (problems.length) {
    console.error(`The edit has ${problems.length} problem${problems.length > 1 ? "s" : ""}:`);
    for (const p of problems.slice(0, 40)) console.error(`- ${p}`);
    if (problems.length > 40) console.error(`- and ${problems.length - 40} more`);
    process.exit(1);
  }
  console.log("The edit is sound: every clip fits its footage, nothing overlaps, graphics and captions check out.");
  // What moved because its word was cut: mention it to the person.
  for (const note of editNotes) console.log(`Note: ${note}`);
  // The film's own graphics must bundle, as must its component if it has one.
  const graphicsDir = path.join(dir, "graphics");
  const own = existsSync(graphicsDir) ? readdirSync(graphicsDir).filter((f) => /\.jsx?$/.test(f)) : [];
  const code = await bundleStage();
  if (code !== 0) process.exit(code);
  console.log(`The film bundles cleanly${own.length ? `, with its own graphics (${own.length})` : ""}.`);
  process.exit(0);
}

if (film.engine === "html") {
  // Films move with Motion, wrapped by filmTimeline() so the studio can seek
  // them (assets/timeline.js). GSAP is only for films made before Motion, and
  // only in the in-house edition (docs/research/gsap-to-motion.md).
  const html = readFileSync(path.join(dir, "index.html"), "utf8");
  if (process.env.STUDIO_EDITION === "product" && /<script[^>]+src=["'][^"']*gsap[^"']*["']/i.test(html)) {
    fail("index.html loads GSAP, which this edition of the studio doesn't include. Move the film to Motion (assets/vendor/motion.js with assets/timeline.js).");
  }
  const checker = packageBin(path.join(ROOT, "studio/hyperframes"), "hyperframes");
  if (!checker) fail("The film checker isn't installed: run `npm ci` in studio/hyperframes.");
  const [bin, before] = checker;
  const code = await run(bin, [...before, "check", dir, "--max-issues=30"], {
    // CI=1: no warm checker left running in the background afterwards.
    env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", CI: "1" },
  });
  if (code !== 0) process.exit(code);
  process.exit(await checkLayers());
}

if (film.engine === "react") {
  const entry = path.join(dir, "src/Film.jsx");
  if (!existsSync(entry)) fail("src/Film.jsx is missing: a react film's component lives there.");
  const code = await bundleStage();
  if (code === 0) console.log("The component bundles cleanly.");
  process.exit(code);
}

if (film.engine === "rust") {
  // Building runs code (build scripts, macros), so: no build scripts or
  // proc-macro crates of the film's own, no network (only crates already
  // downloaded), and writes only to the film, cargo's cache and temp.
  const manifest = readFileSync(path.join(dir, "Cargo.toml"), "utf8");
  // The one build script allowed is the studio's own, unchanged (it turns
  // film.json and params.json into constants).
  const ownBuild = path.join(dir, "build.rs");
  const studioBuild = readFileSync(path.join(ROOT, "studio/starters/rust/build.rs"), "utf8");
  const buildOk = !existsSync(ownBuild) || readFileSync(ownBuild, "utf8") === studioBuild;
  const buildLine = manifest.match(/^\s*build\s*=\s*"([^"]*)"/m);
  if (!buildOk || (buildLine && buildLine[1] !== "build.rs") || /proc-macro\s*=\s*true/.test(manifest)) {
    fail("Studio films can only use the studio's own build.rs, unchanged, and no proc-macros.");
  }
  const cargoHome = process.env.CARGO_HOME ?? path.join(homedir(), ".cargo");
  // The same build folder the stage and renders use, so the engine's large
  // dependencies (Skia) are already built and nothing needs downloading.
  const target = path.join(ROOT, "node_modules/.cache/studio-cargo");
  const profile = [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    "(deny file-write*)",
    `(allow file-write* (subpath ${JSON.stringify(dir)}) (subpath ${JSON.stringify(cargoHome)}) (subpath ${JSON.stringify(target)})`,
    '  (subpath "/private/tmp") (subpath "/private/var/folders") (literal "/dev/null"))',
  ].join("\n");
  const cargo = existsSync(path.join(cargoHome, "bin/cargo")) ? path.join(cargoHome, "bin/cargo") : "cargo";
  const build = ["build", "--release", "--offline", "--quiet"];
  const env = { ...process.env, CARGO_TARGET_DIR: target };
  // Windows has no sandbox-exec. The checks above still hold there (only
  // the studio's build.rs, no proc-macros, no network), which is how a
  // render builds the film on the Mac too.
  // eslint-disable-next-line no-restricted-syntax -- Mac's sandbox; Windows builds with the checks above
  process.exit(IS_MAC ? await run("sandbox-exec", ["-p", profile, cargo, ...build], { env }) : await run(cargo, build, { env }));
}

fail(`Unknown engine "${film.engine}" in film.json.`);

// ─── HTML films: graphics memory ────────────────────────────────────────────
//
// Everything turned in 3D (a matrix3d transform) gets its own layer on the
// graphics card, at its full size. Too many big ones at the same moment and
// the card runs out of memory: the film goes blank and the whole studio
// window flickers (one film had 30 full-frame planes at once).
// So: step through the film and add up, at each moment, the area of every
// visible 3D layer, in frames. Above the budget, say when and where.

async function checkLayers() {
  const LAYER_BUDGET = 16; // full frames of 3D layers at one moment
  let chromium;
  try {
    ({ chromium } = await import(pathToFileURL(path.join(ROOT, "node_modules/playwright/index.mjs")).href));
  } catch {
    console.log("Skipped the graphics memory check (Playwright isn't installed).");
    return 0;
  }
  const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
  try {
    const page = await browser.newPage({ viewport: { width: film.width, height: film.height } });
    await page.goto(`file://${path.join(dir, "index.html")}`, { waitUntil: "load", timeout: 60_000 });
    const ready = await page
      .waitForFunction(() => Boolean(window.__timelines?.main), null, { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (!ready) {
      console.log("Skipped the graphics memory check (no main timeline to step through).");
      return 0;
    }
    const duration = await page.evaluate(() => window.__timelines.main.duration());
    const frame = film.width * film.height;
    const heavy = [];
    for (let t = 0; t <= duration; t += 0.25) {
      const at = await page.evaluate((t) => {
        window.__timelines.main.seek(t, false);
        const shown = (el) => {
          for (let e = el; e; e = e.parentElement) {
            const s = getComputedStyle(e);
            if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
          }
          return true;
        };
        let area = 0;
        const where = new Map();
        for (const el of document.querySelectorAll("body *")) {
          if (!getComputedStyle(el).transform.startsWith("matrix3d") || !shown(el)) continue;
          let w = el.offsetWidth || el.getBoundingClientRect().width;
          let h = el.offsetHeight || el.getBoundingClientRect().height;
          if (el instanceof SVGGraphicsElement) {
            const box = el.getBBox();
            w = Math.max(w, box.width);
            h = Math.max(h, box.height);
          }
          area += w * h;
          const owner = el.closest("[id]")?.id ?? el.tagName.toLowerCase();
          where.set(owner, (where.get(owner) ?? 0) + 1);
        }
        return { area, where: [...where].sort((a, b) => b[1] - a[1]).slice(0, 3) };
      }, t);
      const frames = at.area / frame;
      if (frames > LAYER_BUDGET) heavy.push({ t, frames, where: at.where });
    }
    if (!heavy.length) {
      console.log("Graphics memory: fine, no moment has too many big 3D layers.");
      return 0;
    }
    const worst = heavy.reduce((a, b) => (b.frames > a.frames ? b : a));
    const span = `${heavy[0].t.toFixed(2)} s to ${heavy.at(-1).t.toFixed(2)} s`;
    console.error(
      [
        `Too much in 3D at once, from ${span}: up to ${worst.frames.toFixed(0)} full frames of 3D layers (the budget is ${LAYER_BUDGET}).`,
        `Mostly in: ${worst.where.map(([id, n]) => `#${id} (${n} layer${n > 1 ? "s" : ""})`).join(", ")}.`,
        "Each element turned in 3D is held on the graphics card at its full size, and this many makes the studio flicker and the film go blank.",
        "Fix: make each 3D element's box only as big as what it draws (an SVG's width, height and viewBox around its own shape, not the whole frame), use fewer 3D planes, or flatten the parts that don't need depth.",
      ].join("\n"),
    );
    return 1;
  } catch (error) {
    console.log(`Skipped the graphics memory check (${String(error).split("\n")[0]}).`);
    return 0;
  } finally {
    await browser.close();
  }
}

// ─── Video films: the edit ──────────────────────────────────────────────────
//
// Mirrors src/lib/studio/films/edit.ts. Every problem is a sentence Claude can
// act on, naming the item by its id and where it sits.

function checkEdit() {
  const problems = [];
  const say = (p) => problems.push(p);
  let edit;
  try {
    edit = JSON.parse(readFileSync(path.join(dir, "edit.json"), "utf8"));
  } catch (error) {
    return [existsSync(path.join(dir, "edit.json")) ? `edit.json isn't valid JSON: ${error.message}` : "edit.json is missing."];
  }
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const t = (v) => (isNum(v) ? `${v.toFixed(2)} s` : String(v));

  if (edit.version !== 1 && edit.version !== 2) say('edit.json needs "version": 2 (or 1 for an edit with nothing fixed to words).');
  // Words fixed to things: check every anchor points at a real word, then
  // check the edit with its anchors turned into seconds, as it plays.
  if (Array.isArray(edit.tracks)) {
    const transcripts = readTranscriptsSync(dir, edit);
    const anchorProblem = (a, what) => {
      const ref = a && typeof a === "object" && typeof a.word === "string" ? parseWordRef(a.word) : null;
      if (!ref) return say(`${what}: "word" must be "<media id>:<word number>", like "${[...mediaIndex().keys()][0] ?? "abcd1234"}:12".`);
      if (a.edge !== undefined && a.edge !== "start" && a.edge !== "end") say(`${what}: "edge" is "start" or "end".`);
      if (a.offset !== undefined && (!isNum(a.offset) || Math.abs(a.offset) > 60)) say(`${what}: "offset" is seconds from the word, -60 to 60.`);
      const words = transcripts[ref.media];
      if (!words) say(`${what}: "${ref.media}" has no transcript yet, or no clip plays it. Word anchors need a transcribed clip in the edit.`);
      else if (!words[ref.index]) say(`${what}: "${ref.media}" has ${words.length} words (0 to ${words.length - 1}), so word ${ref.index} doesn't exist.`);
    };
    for (const track of edit.tracks) {
      for (const item of track?.items ?? []) {
        if (item?.type !== "graphic") continue;
        if (item.at !== undefined) anchorProblem(item.at, `graphic "${item.id}" "at"`);
        if (item.until !== undefined) anchorProblem(item.until, `graphic "${item.id}" "until"`);
      }
    }
    if (edit.marks !== undefined) {
      if (!Array.isArray(edit.marks)) say('"marks" must be a list of { "label", "at": { "word" } }.');
      else for (const [i, m] of edit.marks.entries()) {
        if (typeof m?.label !== "string" || !m.label.trim()) say(`mark ${i + 1} needs a "label".`);
        anchorProblem(m?.at, `mark ${i + 1} ("${m?.label ?? "?"}")`);
      }
    }
    if (edit.captions?.fixes !== undefined) {
      if (!edit.captions.fixes || typeof edit.captions.fixes !== "object") say('captions "fixes" must be an object of { "<media id>:<word number>": { "text", "hit", "hidden" } }.');
      else for (const ref of Object.keys(edit.captions.fixes)) anchorProblem({ word: ref }, `caption fix "${ref}"`);
    }
    if (problems.length) return problems;
    const resolved = resolveEdit(edit, transcripts);
    edit = resolved.edit;
    editNotes = resolved.notes;
  }
  if (typeof edit.background !== "string" || !/^#[0-9a-f]{6}$/i.test(edit.background)) say('"background" must be a colour like "#141414".');
  if (!Array.isArray(edit.tracks)) return [...problems, '"tracks" must be a list of tracks.'];

  const media = mediaIndex();
  const graphics = graphicIndex();
  const ids = new Set();
  let end = 0;

  for (const [ti, track] of edit.tracks.entries()) {
    const where = `track ${ti + 1} ("${track?.name ?? track?.id ?? "?"}")`;
    if (!track || typeof track !== "object") {
      say(`${where} isn't a track object.`);
      continue;
    }
    if (typeof track.id !== "string" || !track.id) say(`${where} needs an "id".`);
    if (!["video", "graphics", "audio"].includes(track.kind)) say(`${where}: "kind" must be "video", "graphics" or "audio", not "${track.kind}".`);
    if (typeof track.name !== "string") say(`${where} needs a "name".`);
    if (!Array.isArray(track.items)) {
      say(`${where}: "items" must be a list.`);
      continue;
    }
    const spans = [];
    for (const item of track.items) {
      const it = `${item?.type ?? "item"} "${item?.id ?? "?"}" on ${where}`;
      if (!item || typeof item !== "object") {
        say(`${where} has an item that isn't an object.`);
        continue;
      }
      if (typeof item.id !== "string" || !item.id) say(`An item on ${where} has no "id".`);
      else if (ids.has(item.id)) say(`Two items share the id "${item.id}"; ids must be unique across the edit.`);
      else ids.add(item.id);
      if (!isNum(item.start) || item.start < 0) say(`${it}: "start" must be 0 or more seconds (it's ${t(item.start)}).`);

      let length = null;
      if (item.type === "clip") {
        if (track.kind === "graphics") say(`${it}: footage clips belong on a video or audio track, not a graphics track.`);
        const m = media.get(item.media);
        if (!m) {
          say(`${it} uses media "${item.media}", which this film doesn't have. Media ids: ${[...media.keys()].join(", ") || "none yet"}.`);
        } else {
          if (track.kind === "audio" && m.kind === "image") say(`${it}: a photo has no sound, so it can't sit on an audio track.`);
          if (track.kind === "audio" && m.kind === "video" && m.hasAudio === false) say(`${it}: "${m.name}" has no sound.`);
          if (track.kind === "video" && m.kind === "audio") say(`${it}: "${m.name}" is sound only; put it on an audio track.`);
        }
        if (!isNum(item.from) || item.from < 0) say(`${it}: "from" must be 0 or more seconds in the source (it's ${t(item.from)}).`);
        if (!isNum(item.to) || !(item.to > item.from)) say(`${it}: "to" must be after "from" (from ${t(item.from)}, to ${t(item.to)}).`);
        else if (m?.duration && m.kind !== "image" && item.to > m.duration + 0.05) {
          say(`${it}: "to" is ${t(item.to)} but "${m.name}" is only ${t(m.duration)} long.`);
        }
        const speed = item.speed ?? 1;
        if (!isNum(speed) || speed < 0.1 || speed > 8) say(`${it}: "speed" must be between 0.1 and 8 (it's ${speed}).`);
        if (item.volume !== undefined && (!isNum(item.volume) || item.volume < 0 || item.volume > 2)) say(`${it}: "volume" must be 0 to 2 (1 is as recorded).`);
        for (const k of ["fadeIn", "fadeOut"]) {
          if (item[k] !== undefined && (!isNum(item[k]) || item[k] < 0)) say(`${it}: "${k}" must be 0 or more seconds.`);
        }
        if (item.zoom !== undefined && (!isNum(item.zoom) || item.zoom < 1 || item.zoom > 6)) say(`${it}: "zoom" must be 1 (just covers the frame) to 6.`);
        for (const k of ["x", "y"]) {
          if (item[k] !== undefined && (!isNum(item[k]) || item[k] < 0 || item[k] > 1)) say(`${it}: "${k}" is the framing centre, 0 to 1 of the source (it's ${item[k]}).`);
        }
        if (item.box !== undefined) {
          const b = item.box;
          const ok = b && typeof b === "object" && ["x", "y", "w", "h"].every((k) => isNum(b[k]) && b[k] >= 0 && b[k] <= 1);
          if (!ok || b.w < 0.05 || b.h < 0.05 || b.x + b.w > 1.0001 || b.y + b.h > 1.0001) {
            say(`${it}: "box" is the part of the frame the clip fills, { "x", "y", "w", "h" } from 0 to 1 and inside the frame (the top half is { "x": 0, "y": 0, "w": 1, "h": 0.5 }).`);
          }
        }
        if (isNum(item.from) && isNum(item.to) && isNum(speed) && speed > 0) length = (item.to - item.from) / speed;
      } else if (item.type === "graphic") {
        if (track.kind !== "graphics") say(`${it}: graphics belong on a graphics track.`);
        if (typeof item.graphic !== "string" || !graphics.has(item.graphic)) {
          say(
            `${it} uses the graphic "${item.graphic}", which doesn't exist. Studio graphics: ${[...graphics.entries()].filter(([, w]) => w === "studio").map(([n]) => n).join(", ") || "none installed"}; this film's own (graphics/<name>.jsx): ${[...graphics.entries()].filter(([, w]) => w === "film").map(([n]) => n).join(", ") || "none"}.`,
          );
        }
        if (!isNum(item.duration) || item.duration <= 0) say(`${it}: "duration" must be more than 0 seconds.`);
        else length = item.duration;
        if (!item.values || typeof item.values !== "object" || Array.isArray(item.values)) say(`${it}: "values" must be an object of the graphic's settings (it can be {}).`);
      } else {
        say(`${it}: "type" must be "clip" or "graphic".`);
      }
      if (length !== null && isNum(item.start)) {
        spans.push({ id: item.id, start: item.start, end: item.start + length });
        end = Math.max(end, item.start + length);
      }
    }
    spans.sort((a, b) => a.start - b.start);
    for (let i = 1; i < spans.length; i++) {
      const [a, b] = [spans[i - 1], spans[i]];
      if (b.start < a.end - 0.001) {
        say(`On ${where}, "${a.id}" (until ${t(a.end)}) overlaps "${b.id}" (from ${t(b.start)}). Move one, or put it on another track.`);
      }
    }
  }

  const c = edit.captions;
  if (!c || typeof c !== "object") say('"captions" is missing: { "on": false, "style": "lines", "words": [], "position": "bottom" }.');
  else {
    if (typeof c.on !== "boolean") say('captions "on" must be true or false.');
    if (!["words", "lines", "karaoke", "serif"].includes(c.style)) say('captions "style" must be "words", "lines", "karaoke" or "serif".');
    if (!["bottom", "middle"].includes(c.position)) say('captions "position" must be "bottom" or "middle".');
    if (!Array.isArray(c.words)) say('captions "words" must be a list.');
    else {
      let prev = -Infinity;
      for (const [i, w] of c.words.entries()) {
        const at = `caption word ${i + 1} ("${w?.text ?? "?"}")`;
        if (typeof w?.text !== "string" || !w.text.trim()) say(`${at} has no text.`);
        if (!isNum(w?.start) || !isNum(w?.end) || w.end <= w.start) say(`${at}: "end" must be after "start" (${t(w?.start)} to ${t(w?.end)}).`);
        else {
          if (w.start < prev - 0.001) say(`${at} starts at ${t(w.start)}, before the word ahead of it ends; caption words must be in time order.`);
          if (end > 0 && w.start > end + 0.05) say(`${at} is at ${t(w.start)}, after the film ends (${t(end)}). Captions are on the film's timeline, not the source's.`);
          prev = w.end;
        }
        if (problems.length > 60) break;
      }
      if (c.on && c.words.length === 0) say("Captions are on but there are no caption words.");
    }
  }

  if (end > 0 && isNum(film.duration) && Math.abs(film.duration - end) > 0.05) {
    say(`film.json says the film is ${t(film.duration)} long but the edit ends at ${t(end)}. Set film.json "duration" to ${Math.round(end * 100) / 100}.`);
  }
  return problems;
}

// The film's footage: media/<id>/ with media.json (written on import), or
// what can be read from the files.
function mediaIndex() {
  const index = new Map();
  const root = path.join(dir, "media");
  if (!existsSync(root)) return index;
  for (const mid of readdirSync(root).filter((m) => /^[a-z0-9]{8}$/.test(m))) {
    const folder = path.join(root, mid);
    let meta = {};
    try {
      meta = JSON.parse(readFileSync(path.join(folder, "media.json"), "utf8"));
    } catch {}
    const files = readdirSync(folder);
    const original = meta.original ?? files.find((f) => f.startsWith("original."));
    const kind =
      meta.kind ??
      (/\.(wav|mp3|m4a|aac|aif|aiff|flac|ogg|opus)$/i.test(original ?? "")
        ? "audio"
        : /\.(jpe?g|png|webp|gif|heic|tiff?)$/i.test(original ?? "")
          ? "image"
          : "video");
    let duration = meta.duration ?? null;
    let hasAudio = meta.hasAudio;
    if ((duration == null || hasAudio == null) && kind !== "image") {
      const file = files.includes("proxy.mp4") ? path.join(folder, "proxy.mp4") : original ? path.join(folder, original) : null;
      if (file) {
        try {
          const j = JSON.parse(
            execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", file], { encoding: "utf8" }),
          );
          duration ??= Number(j.format?.duration) || null;
          hasAudio ??= j.streams?.some((s) => s.codec_type === "audio") ?? false;
        } catch {}
      }
    }
    index.set(mid, { kind, duration, hasAudio, name: meta.name ?? original ?? mid });
  }
  return index;
}

// Graphics a film can use: the studio's library (studio/graphics/<name>.jsx
// or <name>/index.jsx) and the film's own (graphics/<name>.jsx).
function graphicIndex() {
  const index = new Map();
  const add = (folder, where) => {
    if (!existsSync(folder)) return;
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.isFile() && /\.jsx?$/.test(entry.name)) index.set(entry.name.replace(/\.jsx?$/, ""), where);
      else if (entry.isDirectory() && ["index.jsx", "index.js"].some((f) => existsSync(path.join(folder, entry.name, f)))) index.set(entry.name, where);
    }
  };
  add(path.join(ROOT, "studio/graphics"), "studio");
  add(path.join(dir, "graphics"), "film");
  return index;
}
