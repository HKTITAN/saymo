// Renders a film's sound design: films/<id>/sound/score.js (Strudel music,
// Tone.js effects; see src/lib/studio/sound.ts) into sound/sound.wav,
// exactly as long as the film, 48 kHz stereo, at about -16 LUFS with the
// peaks kept under -1.5 dBTP. Also writes sound/peaks.json (100 a second,
// for the timeline) and sound/status.json.
//
//   node scripts/studio/sound.mjs <film-id>          render, then print what it hears
//   node scripts/studio/sound.mjs <film-id> --check  render twice, say if the score is
//                                                    deterministic; writes nothing
//
// It plays the score in headless Chrome into offline audio contexts (never
// to speakers), so it takes seconds and the same score always gives the
// same sound. After rendering it prints a short report Claude can "hear"
// with: loudness, peak, and every onset with the film mark it lands on.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Importing the studio's TypeScript (captions.ts) makes Node warn that the
// project isn't marked as ES modules; that note means nothing here.
{
  const others = process.listeners("warning");
  process.removeAllListeners("warning");
  process.on("warning", (w) => {
    if (w.code !== "MODULE_TYPELESS_PACKAGE_JSON") for (const l of others) l(w);
  });
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ENGINE_DIR = path.join(ROOT, "studio/sound");
const CACHE = path.join(ROOT, "node_modules/.cache/studio-sound");
const RATE = 48000;
const TARGET_LUFS = -16;
const TARGET_TP = -1.5;

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--"));
const checking = args.includes("--check");
const quiet = args.includes("--quiet");
const say = (line) => {
  if (!quiet) console.log(line);
};

if (!id || !/^[a-z0-9]{8}$/.test(id)) {
  console.error("usage: node scripts/studio/sound.mjs <film-id> [--check]");
  process.exit(1);
}

const dir = path.join(ROOT, "films", id);
const soundDir = path.join(dir, "sound");
const statusFile = path.join(soundDir, "status.json");

const writeJson = async (file, value) => {
  await writeFile(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
};
const status = (value) => (checking ? Promise.resolve() : writeJson(statusFile, value));

// ─── Running things ─────────────────────────────────────────────────────────

const run = (cmd, argv, { input } = {}) =>
  new Promise((resolve, reject) => {
    const proc = spawn(cmd, argv, { stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
    const out = [];
    const err = [];
    proc.stdout.on("data", (c) => out.push(c));
    proc.stderr.on("data", (c) => err.push(c));
    proc.on("error", reject);
    proc.on("close", (code) => {
      const stderr = Buffer.concat(err).toString();
      if (code === 0) resolve({ stdout: Buffer.concat(out), stderr });
      else reject(new Error(`${path.basename(cmd)} failed (exit ${code}):\n${stderr.split("\n").slice(-15).join("\n")}`));
    });
    if (input) {
      proc.stdin.end(input);
    }
  });

// ─── The engine page ────────────────────────────────────────────────────────

// Strudel's published build carries its audio worklets inline, as base64
// modules. Worklets keep their own Math.random (the supersaw's starting
// phases), so each one gets the same seeded generator as the page.
const SEEDED = `Math.random=(()=>{let s=7;return()=>{s|=0;s=(s+0x6d2b79f5)|0;let t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296}})();\n`;
const seedWorklets = {
  name: "seed-worklets",
  setup(build) {
    build.onLoad({ filter: /(superdough|supradough)[\\/]dist[\\/]index\.mjs$/ }, async (a) => {
      const text = await readFile(a.path, "utf8");
      const contents = text.replace(/data:text\/javascript;base64,([A-Za-z0-9+/=]{200,})/g, (_, b64) => {
        const source = Buffer.from(b64, "base64").toString("utf8");
        return `data:text/javascript;base64,${Buffer.from(SEEDED + source).toString("base64")}`;
      });
      return { contents, loader: "js" };
    });
  },
};

// Bundled once and kept until the engine or its packages change.
async function engineBundle() {
  const sources = [path.join(ENGINE_DIR, "engine.js"), path.join(ENGINE_DIR, "package-lock.json"), fileURLToPath(import.meta.url)];
  const stamp = createHash("sha1");
  for (const f of sources) stamp.update(String((await stat(f).catch(() => ({ mtimeMs: 0 }))).mtimeMs));
  const file = path.join(CACHE, `engine-${stamp.digest("hex").slice(0, 12)}.js`);
  if (existsSync(file)) return readFile(file, "utf8");
  if (!existsSync(path.join(ENGINE_DIR, "node_modules"))) {
    throw new Error("The sound engine isn't installed. Run: npm ci --prefix studio/sound");
  }
  const { build } = await import(path.join(ENGINE_DIR, "node_modules/esbuild/lib/main.js"));
  await mkdir(CACHE, { recursive: true });
  await build({
    entryPoints: [path.join(ENGINE_DIR, "engine.js")],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "chrome120",
    outfile: file,
    absWorkingDir: ENGINE_DIR,
    nodePaths: [path.join(ENGINE_DIR, "node_modules")],
    logLevel: "silent",
    legalComments: "none",
    plugins: [seedWorklets],
  });
  return readFile(file, "utf8");
}

// The page is served from this Mac (a real origin, so worklets and module
// imports behave as they do in the studio).
function servePage(script) {
  const html = `<!doctype html><meta charset="utf-8"><title>sound</title><script type="module" src="/engine.js"></script>`;
  const server = http.createServer((req, res) => {
    if (req.url === "/engine.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(script);
    } else {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    }
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() })),
  );
}

// A video film's timeline, as the score sees it: its graphics, and where in
// film time someone speaks (from the captions if made, else the clips'
// transcripts placed on the timeline).
async function videoContext(film) {
  if (film.kind !== "video") return { graphics: [], speech: [] };
  const edit = JSON.parse(await readFile(path.join(dir, "edit.json"), "utf8").catch(() => "null"));
  if (!edit?.tracks) return { graphics: [], speech: [] };
  const graphics = [];
  for (const track of edit.tracks) {
    if (track.hidden) continue;
    for (const item of track.items) {
      if (item.type === "graphic") graphics.push({ id: item.id, graphic: item.graphic, start: item.start, duration: item.duration });
    }
  }
  let words = edit.captions?.words ?? [];
  if (!words.length) {
    const transcripts = {};
    for (const track of edit.tracks) {
      for (const item of track.items) {
        if (item.type !== "clip" || item.media in transcripts) continue;
        transcripts[item.media] = JSON.parse(
          await readFile(path.join(dir, "media", item.media, "transcript.json"), "utf8").catch(() => "null"),
        ) ?? undefined;
      }
    }
    const { captionWords } = await import("../../src/lib/studio/captions.ts");
    words = captionWords(edit, transcripts);
  }
  return {
    graphics: graphics.sort((a, b) => a.start - b.start),
    speech: words.map((w) => ({ start: w.start, end: w.end })),
  };
}

// Renders the score in the page; returns interleaved float32 stereo.
async function renderInChrome(source, film) {
  const script = await engineBundle();
  const context = await videoContext(film);
  const server = await servePage(script);
  const { chromium } = await import(path.join(ROOT, "node_modules/playwright/index.mjs"));
  const browser = await chromium.launch({ channel: "chrome", args: ["--autoplay-policy=no-user-gesture-required"] });
  const logs = [];
  try {
    const page = await browser.newPage();
    page.on("console", (m) => {
      if (m.type() === "warning" || m.type() === "error") logs.push(m.text());
    });
    page.on("pageerror", (e) => logs.push(String(e)));
    await page.goto(server.url, { waitUntil: "load" });
    await page.waitForFunction(() => window.__sound, null, { timeout: 30000 });
    const results = [];
    for (let i = 0; i < 1; i++) {
      const r = await page.evaluate((input) => window.__sound.render(input), {
        source,
        film: {
          duration: film.duration,
          fps: film.fps,
          marks: film.marks ?? [],
          params: Object.fromEntries((film.params ?? []).map((p) => [p.key, p.value])),
          ...context,
        },
        sampleRate: RATE,
      });
      results.push({ pcm: new Float32Array(new Uint8Array(Buffer.from(r.pcm, "base64")).buffer), report: r.report });
    }
    return { results, logs, context };
  } catch (e) {
    const detail = logs.filter((l) => !/AudioContext was not allowed/.test(l)).slice(-4).join("\n");
    throw new Error(`${e.message.split("\n")[0]}${detail ? `\n${detail}` : ""}`);
  } finally {
    await browser.close();
    server.close();
  }
}

// ─── Listening ──────────────────────────────────────────────────────────────

const db = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

// Loudness (EBU R128 integrated) and true peak of float32 stereo, by ffmpeg.
async function measure(rawFile) {
  const { stderr } = await run("ffmpeg", [
    "-hide_banner", "-nostats", "-f", "f32le", "-ar", String(RATE), "-ac", "2", "-i", rawFile,
    "-af", "ebur128=peak=true", "-f", "null", "-",
  ]);
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const lufs = Number(/I:\s+(-?[\d.]+|-inf) LUFS/.exec(summary)?.[1]);
  const peak = Number(/Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(summary)?.[1]);
  return { lufs: Number.isFinite(lufs) ? lufs : null, truePeak: Number.isFinite(peak) ? peak : null };
}

// Loudness per 10 ms (RMS of both channels), the base for onsets. With
// `highpass`, only what's above that frequency, so a tick isn't hidden
// under a sub bass note that is still ringing.
function envelope(pcm, highpass = 0, hop = RATE / 100) {
  const frames = pcm.length / 2;
  const out = new Float32Array(Math.ceil(frames / hop));
  const a = highpass ? 1 / (1 + 2 * Math.PI * highpass / RATE) : 0;
  let pl = 0, pr = 0, yl = 0, yr = 0; // prettier-ignore
  for (let w = 0; w < out.length; w++) {
    let sum = 0;
    let n = 0;
    const end = Math.min(frames, (w + 1) * hop);
    for (let i = w * hop; i < end; i++) {
      let l = pcm[2 * i];
      let r = pcm[2 * i + 1];
      if (highpass) {
        yl = a * (yl + l - pl);
        yr = a * (yr + r - pr);
        pl = l;
        pr = r;
        l = yl;
        r = yr;
      }
      sum += l * l + r * r;
      n += 2;
    }
    out[w] = n ? Math.sqrt(sum / n) : 0;
  }
  return out;
}

function peaksOf(pcm) {
  const hop = RATE / 100;
  const frames = pcm.length / 2;
  const out = [];
  for (let w = 0; w * hop < frames; w++) {
    let m = 0;
    const end = Math.min(frames, (w + 1) * hop);
    for (let i = w * hop; i < end; i++) m = Math.max(m, Math.abs(pcm[2 * i]), Math.abs(pcm[2 * i + 1]));
    out.push(Math.round(Math.min(1, m) * 1000) / 1000);
  }
  return out;
}

// Where something starts: a 10 ms window clearly louder than the 60 ms
// before it, and not too quiet to hear, in the full sound (a bass note) or
// above 400 Hz (a tick, a whoosh's peak). At least 80 ms apart.
function onsetsOf(pcm) {
  const bands = [envelope(pcm), envelope(pcm, 400)];
  const floor = 10 ** (-48 / 20);
  const out = [];
  let last = -Infinity;
  for (let w = 1; w < bands[0].length; w++) {
    const t = w / 100;
    if (t - last < 0.08) continue;
    for (const env of bands) {
      const prev = Math.max(...env.slice(Math.max(0, w - 6), w), 1e-6);
      if (env[w] > floor && env[w] > prev * 2.2) {
        out.push({ t, level: Math.round(db(bands[0][w])) });
        last = t;
        break;
      }
    }
  }
  return out;
}

const fmt = (t) => `${t.toFixed(2)} s`;

function describeOnsets(onsets, marks) {
  if (!onsets.length) return ["No clear onsets: the sound is a smooth bed, or silent."];
  const lines = [];
  // A mark can say how far after it a hit still belongs to it (a graphic
  // lands a moment after it appears).
  const near = (m, t) => t - m.t >= -0.25 && t - m.t <= (m.after ?? 0.25);
  for (const o of onsets.slice(0, 40)) {
    let note = "";
    let best = null;
    for (const m of marks) if (near(m, o.t) && (!best || Math.abs(m.t - o.t) < Math.abs(best.t - o.t))) best = m;
    if (best) {
      const ms = Math.round((o.t - best.t) * 1000);
      note = ` on "${best.label}" (${best.t.toFixed(2)} s, ${ms === 0 ? "exact" : `${ms > 0 ? "+" : ""}${ms} ms`})`;
    }
    lines.push(`  ${fmt(o.t)} at ${o.level} dBFS${note}`);
  }
  if (onsets.length > 40) lines.push(`  …and ${onsets.length - 40} more`);
  return lines;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const film = JSON.parse(await readFile(path.join(dir, "film.json"), "utf8"));
  const scoreFile = path.join(soundDir, "score.js");
  if (!existsSync(scoreFile)) {
    await mkdir(soundDir, { recursive: true });
    await status({ state: "none" });
    say("This film has no sound/score.js yet, so there is nothing to render.");
    return;
  }
  const source = await readFile(scoreFile, "utf8");
  await mkdir(soundDir, { recursive: true });
  const started = Date.now();
  await status({ state: "rendering", step: "Playing the score" });

  if (checking) {
    // Two separate renders, each in a fresh browser, as two real renders are.
    const one = (await renderInChrome(source, film)).results[0];
    const two = (await renderInChrome(source, film)).results[0];
    // Chrome's reverb sums in threads, so two renders can differ in the last
    // bit (about -90 dB); anything louder than -60 dB is the score itself
    // changing, from Math.random or the clock.
    let diff = 0;
    for (let i = 0; i < Math.min(one.pcm.length, two.pcm.length); i++) diff = Math.max(diff, Math.abs(one.pcm[i] - two.pcm[i]));
    if (one.pcm.length !== two.pcm.length || db(diff) > -60) {
      console.error(
        `The score sounds different each time it renders (by ${db(diff).toFixed(0)} dB). Remove Math.random, Date.now and anything timed by the clock from score.js; Strudel's rand and perlin are fine.`,
      );
      process.exit(2);
    }
    say(`The score sounds the same every time it renders (${fmt(film.duration)}).`);
    return;
  }

  const { results, context } = await renderInChrome(source, film);
  const { pcm, report } = results[0];
  const total = Math.round(film.duration * RATE);
  const work = path.join(soundDir, ".work");
  await mkdir(work, { recursive: true });
  const raw = path.join(work, "mix.f32");
  await writeFile(raw, Buffer.from(pcm.buffer));

  await status({ state: "rendering", step: "Setting the loudness" });
  const before = await measure(raw);
  // Silence stays silence; anything else is brought to the target loudness
  // with a true-peak limit. Two passes: measure, then a linear gain where
  // that keeps the peaks under the limit, the dynamic one otherwise.
  let silent = before.lufs === null || before.lufs <= -69;
  const filters = [];
  let m = null;
  if (!silent) {
    const { stderr } = await run("ffmpeg", [
      "-hide_banner", "-nostats", "-f", "f32le", "-ar", String(RATE), "-ac", "2", "-i", raw,
      "-af", `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TP}:LRA=11:print_format=json`, "-f", "null", "-",
    ]);
    m = JSON.parse(stderr.slice(stderr.lastIndexOf("{"), stderr.lastIndexOf("}") + 1));
    // Too quiet to measure (a few clicks in silence) counts as silent.
    if (!Number.isFinite(Number(m.input_i)) || !Number.isFinite(Number(m.input_tp))) silent = true;
  }
  if (!silent) {
    filters.push(
      `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TP}:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`,
    );
  }
  // Exactly the film's length, at 48 kHz (loudnorm works at 192 kHz inside).
  filters.push(`aresample=${RATE}`, "apad", `atrim=end_sample=${total}`);
  const wavTmp = path.join(work, "sound.wav");
  await run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error", "-f", "f32le", "-ar", String(RATE), "-ac", "2", "-i", raw,
    "-af", filters.join(","), "-ar", String(RATE), "-c:a", "pcm_s16le", wavTmp,
  ]);

  // Listen to the result as it will be heard.
  await status({ state: "rendering", step: "Listening back" });
  const { stdout } = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", wavTmp, "-f", "f32le", "-ac", "2", "-ar", String(RATE), "-"]);
  const final = new Float32Array(stdout.buffer, stdout.byteOffset, stdout.byteLength / 4);
  const finalRaw = path.join(work, "final.f32");
  await writeFile(finalRaw, stdout);
  const after = silent ? { lufs: null, truePeak: null } : await measure(finalRaw);
  const peaks = peaksOf(final);
  const onsets = onsetsOf(final);

  await rename(wavTmp, path.join(soundDir, "sound.wav"));
  await writeJson(path.join(soundDir, "peaks.json"), peaks);
  await rm(work, { recursive: true, force: true });
  const length = final.length / 2 / RATE;
  await status({ state: "ready", at: new Date().toISOString(), duration: Math.round(length * 1000) / 1000, loudness: after.lufs });

  // What Claude reads back.
  const lines = [
    `Rendered sound/sound.wav: ${fmt(length)}, 48 kHz stereo, in ${((Date.now() - started) / 1000).toFixed(1)} s.`,
    silent
      ? "It is silent."
      : `Loudness ${after.lufs?.toFixed(1)} LUFS (the score alone was ${before.lufs?.toFixed(1)}), true peak ${after.truePeak?.toFixed(1)} dBTP.`,
    report.music
      ? `Music: ${report.music.notes} notes at ${report.music.cps} cycles a second (${(report.music.cps * 60).toFixed(0)} cycles a minute), from ${fmt(report.music.start)}.`
      : "Music: none.",
    `Effects: ${report.effects ? "yes" : "none"}.`,
    `Onsets (${onsets.length}), with the film mark each lands on:`,
    ...describeOnsets(onsets, [...(film.marks ?? []), ...context.graphics.map((g) => ({ t: g.start, label: `${g.graphic} appears`, after: Math.min(0.8, g.duration) }))]),
    ...(context.graphics.length ? [`Graphics: ${context.graphics.map((g) => `${g.graphic} ${g.start.toFixed(2)} to ${(g.start + g.duration).toFixed(2)} s`).join(", ")}.`] : []),
    ...(context.speech.length ? [`Speech: ${context.speech.length} words; the music dips under them.`] : []),
  ];
  say(lines.join("\n"));
}

try {
  await main();
} catch (e) {
  const message = e.message.split("\n").slice(0, 6).join("\n");
  await status({ state: "failed", message, at: new Date().toISOString() }).catch(() => {});
  console.error(`The sound could not be rendered: ${message}`);
  process.exit(1);
}
