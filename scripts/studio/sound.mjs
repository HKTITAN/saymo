// Renders a film's sound design: films/<id>/sound/score.js (the music bed
// and Tone.js effects; see src/lib/studio/sound.ts) into sound/sound.wav,
// exactly as long as the film, 48 kHz stereo, at about -16 LUFS with the
// peaks kept under -1.5 dBTP. Also writes sound/peaks.json (100 a second,
// for the timeline) and sound/status.json.
//
// The music and the effects are kept as two stems (sound/music.wav and
// sound/effects.wav, 32 bit float, before loudness, with their peaks in
// music-peaks.json and effects-peaks.json), and the loudness gain chosen
// for the score is kept in sound/master.json. The person's volume edits
// (sound/mix.json: spans of one stem made louder, quieter or silent) are
// applied to the stems when they're added together, with 20 ms fades at
// each span's edges, and then that same loudness gain is applied, so an
// edit changes its span and nothing else. --mix does only that last part:
// no score is played, so it takes about a second.
//
//   node scripts/studio/sound.mjs <film-id>          render, then print what it hears
//   node scripts/studio/sound.mjs <film-id> --mix    mix the kept stems again with mix.json
//   node scripts/studio/sound.mjs <film-id> --check  render twice, say if the score is
//                                                    deterministic; writes nothing
//
// It plays the score in headless Chrome into offline audio contexts (never
// to speakers), so it takes seconds and the same score always gives the
// same sound. After rendering it prints a short report Claude can "hear"
// with: loudness, peak, and every onset with the film mark it lands on.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { openEngine, ROOT } from "./sound-engine.mjs";

// Importing the studio's TypeScript (captions.ts) makes Node warn that the
// project isn't marked as ES modules; that note means nothing here.
{
  const others = process.listeners("warning");
  process.removeAllListeners("warning");
  process.on("warning", (w) => {
    if (w.code !== "MODULE_TYPELESS_PACKAGE_JSON") for (const l of others) l(w);
  });
}

const RATE = 48000;
const TARGET_LUFS = -16;
const TARGET_TP = -1.5;
// A score may ask for its own loudness (`loudness: -14` at the top level of
// its export), from -20 to -12 LUFS; launch films want a little more than
// the studio's default.
const loudnessOf = (source) => {
  const asked = Number(/\bloudness\s*:\s*(-?\d+(?:\.\d+)?)/.exec(source)?.[1]);
  return Number.isFinite(asked) ? Math.min(-12, Math.max(-20, asked)) : TARGET_LUFS;
};

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--"));
const checking = args.includes("--check");
const remixing = args.includes("--mix");
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
const masterFile = path.join(soundDir, "master.json");
const mixFile = path.join(soundDir, "mix.json");
const STEMS = ["music", "effects"];

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

// ─── A motion film's voiceover ──────────────────────────────────────────────
//
// A motion film made from slides can have a voiceover: sound/voice.json
// places clips of speech (sound/voice/<name>.wav) on the film's timeline,
// { "clips": [{ "file": "voice/slide-01.wav", "start": 0.5 }, …] }. They're
// added to the mix as a third stem at their own level, and the music dips
// under them as it does under speech in a video film.

const voiceFile = path.join(soundDir, "voice.json");

async function voiceClips(film) {
  if (film.kind === "video") return [];
  const raw = JSON.parse(await readFile(voiceFile, "utf8").catch(() => "null"));
  if (!Array.isArray(raw?.clips)) return [];
  return raw.clips
    .slice(0, 400)
    .filter((c) => typeof c?.file === "string" && /^voice\/[A-Za-z0-9._-]{1,80}\.wav$/.test(c.file) && Number.isFinite(Number(c.start)))
    .map((c) => ({ file: path.join(soundDir, c.file), start: Math.max(0, Number(c.start)), name: c.file }))
    .filter((c) => existsSync(c.file));
}

// The voice stem: every clip at its start, the film's length, stereo float.
async function voiceStem(film, clips) {
  const frames = Math.round(film.duration * RATE);
  const out = new Float32Array(frames * 2);
  const spans = [];
  for (const c of clips) {
    const { stdout } = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", c.file, "-f", "f32le", "-ac", "2", "-ar", String(RATE), "-"]);
    const pcm = new Float32Array(stdout.buffer, stdout.byteOffset, stdout.byteLength / 4);
    const at = Math.round(c.start * RATE) * 2;
    const n = Math.min(pcm.length, out.length - at);
    for (let i = 0; i < n; i++) out[at + i] += pcm[i];
    if (n > 0) spans.push({ start: c.start, end: c.start + n / 2 / RATE });
  }
  return { pcm: out, spans };
}

// A video film's timeline, as the score sees it: its graphics, and where in
// film time someone speaks (from the captions if made, else the clips'
// transcripts placed on the timeline). A motion film's speech is its
// voiceover.
async function videoContext(film, voice = null) {
  if (film.kind !== "video") return { graphics: [], speech: voice?.spans ?? [] };
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
async function renderInChrome(source, film, voice = null) {
  const context = await videoContext(film, voice);
  const engine = await openEngine();
  try {
    const results = [];
    for (let i = 0; i < 1; i++) {
      const r = await engine.page.evaluate((input) => window.__sound.render(input), {
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
      const f32 = (b64) => new Float32Array(new Uint8Array(Buffer.from(b64, "base64")).buffer);
      results.push({ music: f32(r.music), effects: f32(r.effects), report: r.report });
    }
    return { results, logs: engine.logs, context, inputs: engine.inputs };
  } catch (e) {
    const detail = engine.logs.filter((l) => !/AudioContext was not allowed/.test(l)).slice(-4).join("\n");
    const said = e.message.split("\n")[0].replace(/^page\.evaluate: (Error: )?/, "");
    throw new Error(`${said}${detail ? `\n${detail}` : ""}`);
  } finally {
    await engine.close();
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

function musicLine(m) {
  if (m.engine === "strudel") {
    return `Music (Strudel, from before the music bed): ${m.notes} notes at ${m.cps} cycles a second (${(m.cps * 60).toFixed(0)} cycles a minute), from ${fmt(m.start)}.`;
  }
  if (m.engine === "bed") return `Music: ${m.notes} notes at ${Number(m.bpm.toFixed(3))} BPM, from ${fmt(m.start)}.`;
  return `Music: drawn with Tone by the score, from ${fmt(m.start)}.`;
}

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

// ─── Stems and the mix ──────────────────────────────────────────────────────

// 32 bit float WAV (format 3), interleaved stereo at 48 kHz.
function floatWav(pcm) {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVE", 8);
  head.write("fmt ", 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(3, 20);
  head.writeUInt16LE(2, 22);
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 8, 28);
  head.writeUInt16LE(8, 32);
  head.writeUInt16LE(32, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

async function readFloatWav(file) {
  const buf = await readFile(file);
  let at = 12;
  while (at + 8 <= buf.length) {
    const id = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === "data") {
      // Copied, so the floats start on a 4 byte boundary.
      return new Float32Array(new Uint8Array(buf.subarray(at + 8, at + 8 + size)).buffer);
    }
    at += 8 + size + (size % 2);
  }
  throw new Error(`${path.basename(file)} has no sound in it.`);
}

// The person's edits, as the studio saved them; anything odd is left out.
async function readSpans(duration) {
  const raw = JSON.parse(await readFile(mixFile, "utf8").catch(() => "null"));
  const spans = Array.isArray(raw?.spans) ? raw.spans : [];
  return spans
    .filter((s) => s && STEMS.includes(s.stem) && Number.isFinite(s.from) && Number.isFinite(s.to))
    .map((s) => ({
      stem: s.stem,
      from: Math.max(0, Math.min(duration, s.from)),
      to: Math.max(0, Math.min(duration, s.to)),
      gain: Number.isFinite(s.gain) ? Math.max(-60, Math.min(12, s.gain)) : 0,
      mute: s.mute === true,
    }))
    .filter((s) => s.to - s.from > 0.001 && (s.mute || Math.abs(s.gain) > 0.001));
}

const FADE = 0.02;

// A stem with its spans applied: each span's level eases in and out over
// 20 ms at its edges (not at the film's own start and end).
function withSpans(pcm, spans, stem) {
  const mine = spans.filter((s) => s.stem === stem);
  if (!mine.length) return pcm;
  const frames = pcm.length / 2;
  const env = new Float32Array(frames).fill(1);
  for (const s of mine) {
    const g = s.mute ? 0 : 10 ** (s.gain / 20);
    const a = Math.max(0, Math.round(s.from * RATE));
    const b = Math.min(frames, Math.round(s.to * RATE));
    const n = Math.max(1, Math.min(Math.round(FADE * RATE), Math.floor((b - a) / 2)));
    for (let i = a; i < b; i++) {
      let w = 1;
      if (a > 0 && i < a + n) w = (i - a + 0.5) / n;
      if (b < frames && i >= b - n) w = Math.min(w, (b - i - 0.5) / n);
      env[i] *= 1 + (g - 1) * w;
    }
  }
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < frames; i++) {
    out[2 * i] = pcm[2 * i] * env[i];
    out[2 * i + 1] = pcm[2 * i + 1] * env[i];
  }
  return out;
}

// Music and effects added together, as one render of both would be.
function sumOf(a, b) {
  const out = new Float32Array(Math.max(a.length, b.length));
  for (let i = 0; i < out.length; i++) out[i] = (a[i] ?? 0) + (b[i] ?? 0);
  return out;
}

// Catches peaks only, a little under the limit so the true peak stays
// below it. Run at four times the sample rate, so peaks between samples
// (the true peak) are caught too.
const LIMITER = `alimiter=limit=${(10 ** ((TARGET_TP - 0.5) / 20)).toFixed(4)}:attack=2:release=40:level=disabled`;

// How loud the score is made: measured once, on the score as Claude wrote
// it, and kept, so the person's edits never move the rest of the sound.
async function chooseMaster(raw, targetLufs) {
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
      "-af", `loudnorm=I=${targetLufs}:TP=${TARGET_TP}:LRA=11:print_format=json`, "-f", "null", "-",
    ]);
    m = JSON.parse(stderr.slice(stderr.lastIndexOf("{"), stderr.lastIndexOf("}") + 1));
    // Too quiet to measure (a few clicks in silence) counts as silent.
    if (!Number.isFinite(Number(m.input_i)) || !Number.isFinite(Number(m.input_tp))) silent = true;
  }
  let limited = false;
  if (!silent) {
    if (m.normalization_type === "dynamic") {
      // A plain gain change would push the peaks past the limit, and
      // loudnorm's own fallback rides the level up and down (a quiet intro
      // ends up as loud as the beat). Instead: one steady gain to the
      // target, then the limiter on the peaks.
      const gain = targetLufs - Number(m.input_i);
      filters.push(`volume=${gain.toFixed(2)}dB`, "aresample=192000", LIMITER);
      limited = true;
    } else {
      filters.push(
        `loudnorm=I=${targetLufs}:TP=${TARGET_TP}:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`,
      );
    }
  }
  return {
    silent,
    filters,
    limited,
    before: before.lufs,
    // About how much louder the stems are made, for drawing their outlines.
    gain: silent ? 0 : targetLufs - before.lufs,
  };
}

// Adds the stems (with the person's edits), sets the loudness the score
// was given, and writes sound.wav, the outlines and the status.
async function finish({ film, music, effects, voice = null, master, spans, work, stems }) {
  const total = Math.round(film.duration * RATE);
  const raw = path.join(work, "mix.f32");
  const score = spans.length ? sumOf(withSpans(music, spans, "music"), withSpans(effects, spans, "effects")) : sumOf(music, effects);
  const mixed = voice ? sumOf(score, voice.pcm) : score;
  await writeFile(raw, Buffer.from(mixed.buffer));
  const filters = [...master.filters];
  // A span made louder could push past the peak limit; catch it.
  if (!master.silent && !master.limited && spans.some((s) => !s.mute && s.gain > 0)) {
    filters.push("aresample=192000", LIMITER);
  }
  // Exactly the film's length, at 48 kHz (loudnorm works at 192 kHz inside).
  filters.push(`aresample=${RATE}`, "apad", `atrim=end_sample=${total}`);
  const wavTmp = path.join(work, "sound.wav");
  await run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error", "-f", "f32le", "-ar", String(RATE), "-ac", "2", "-i", raw,
    "-af", filters.join(","), "-ar", String(RATE), "-c:a", "pcm_s16le", wavTmp,
  ]);

  // Listen to the result as it will be heard.
  const { stdout } = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", wavTmp, "-f", "f32le", "-ac", "2", "-ar", String(RATE), "-"]);
  const final = new Float32Array(stdout.buffer, stdout.byteOffset, stdout.byteLength / 4);
  const finalRaw = path.join(work, "final.f32");
  await writeFile(finalRaw, stdout);
  const after = master.silent ? { lufs: null, truePeak: null } : await measure(finalRaw);
  // Each stem's outline, at about the level it's heard in the mix.
  const scale = 10 ** (master.gain / 20);
  const outline = (stem, pcm) => peaksOf(withSpans(pcm, spans, stem)).map((v) => Math.round(Math.min(1, v * scale) * 1000) / 1000);

  await rename(wavTmp, path.join(soundDir, "sound.wav"));
  await writeJson(path.join(soundDir, "peaks.json"), peaksOf(final));
  await writeJson(path.join(soundDir, "music-peaks.json"), outline("music", music));
  await writeJson(path.join(soundDir, "effects-peaks.json"), outline("effects", effects));
  const length = final.length / 2 / RATE;
  await status({ state: "ready", at: new Date().toISOString(), duration: Math.round(length * 1000) / 1000, loudness: after.lufs, stems });
  return { final, after, length };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const film = JSON.parse(await readFile(path.join(dir, "film.json"), "utf8"));
  const scoreFile = path.join(soundDir, "score.js");
  const clips = checking ? [] : await voiceClips(film);
  const voice = clips.length ? await voiceStem(film, clips) : null;
  if (!existsSync(scoreFile) && !voice) {
    await mkdir(soundDir, { recursive: true });
    await status({ state: "none" });
    say("This film has no sound/score.js yet, so there is nothing to render.");
    return;
  }

  if (remixing) {
    // Only the person's edits changed: mix the kept stems again. No
    // "rendering" status, so the studio keeps playing the old mix until
    // the new one is there.
    const started = Date.now();
    const master = JSON.parse(await readFile(masterFile, "utf8").catch(() => "null"));
    const files = STEMS.map((s) => path.join(soundDir, `${s}.wav`));
    if (!master || !files.every((f) => existsSync(f))) {
      console.error("This sound has no stems yet. Render the score once first.");
      process.exit(3);
    }
    const [music, effects] = await Promise.all(files.map(readFloatWav));
    const work = path.join(soundDir, ".work-mix");
    await mkdir(work, { recursive: true });
    try {
      const spans = await readSpans(film.duration);
      const { length } = await finish({ film, music, effects, voice, master, spans, work, stems: master.stems ?? STEMS });
      say(`Mixed sound/sound.wav again from its stems with ${spans.length} edit${spans.length === 1 ? "" : "s"}: ${fmt(length)}, in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
    return;
  }

  // A voiceover with no score yet: only the voice.
  const source = existsSync(scoreFile) ? await readFile(scoreFile, "utf8") : null;
  const targetLufs = source ? loudnessOf(source) : TARGET_LUFS;
  await mkdir(soundDir, { recursive: true });
  const started = Date.now();
  await status({ state: "rendering", step: "Playing the score" });

  if (checking) {
    // Two separate renders, each in a fresh browser, as two real renders are.
    const one = (await renderInChrome(source, film)).results[0];
    const two = (await renderInChrome(source, film)).results[0];
    const a = sumOf(one.music, one.effects);
    const b = sumOf(two.music, two.effects);
    // Chrome's reverb sums in threads, so two renders can differ in the last
    // bit (about -90 dB); anything louder than -60 dB is the score itself
    // changing, from Math.random or the clock.
    let diff = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) diff = Math.max(diff, Math.abs(a[i] - b[i]));
    if (a.length !== b.length || db(diff) > -60) {
      console.error(
        `The score sounds different each time it renders (by ${db(diff).toFixed(0)} dB). Remove Math.random, Date.now and anything timed by the clock from score.js.`,
      );
      process.exit(2);
    }
    say(`The score sounds the same every time it renders (${fmt(film.duration)}).`);
    return;
  }

  const silence = () => new Float32Array(Math.round(film.duration * RATE) * 2);
  const { results, context } = source
    ? await renderInChrome(source, film, voice)
    : { results: [{ music: silence(), effects: silence(), report: { music: null, effects: null } }], context: { graphics: [], speech: voice?.spans ?? [] } };
  const { music, effects, report } = results[0];
  const stems = STEMS.filter((s) => (s === "music" ? report.music : report.effects));
  const work = path.join(soundDir, ".work");
  await mkdir(work, { recursive: true });

  await status({ state: "rendering", step: "Setting the loudness" });
  // The loudness is chosen from the score (and voiceover) alone, before any edits.
  const raw = path.join(work, "score.f32");
  await writeFile(raw, Buffer.from((voice ? sumOf(sumOf(music, effects), voice.pcm) : sumOf(music, effects)).buffer));
  const master = { ...(await chooseMaster(raw, targetLufs)), stems };
  for (const [stem, pcm] of [["music", music], ["effects", effects]]) {
    await writeFile(path.join(work, `${stem}.wav`), floatWav(pcm));
    await rename(path.join(work, `${stem}.wav`), path.join(soundDir, `${stem}.wav`));
  }
  await writeJson(masterFile, master);

  await status({ state: "rendering", step: "Listening back" });
  const spans = await readSpans(film.duration);
  const { final, after, length } = await finish({ film, music, effects, voice, master, spans, work, stems });
  const onsets = onsetsOf(final);
  await rm(work, { recursive: true, force: true });

  // What Claude reads back.
  const lines = [
    `Rendered sound/sound.wav: ${fmt(length)}, 48 kHz stereo, in ${((Date.now() - started) / 1000).toFixed(1)} s.`,
    master.silent
      ? "It is silent."
      : `Loudness ${after.lufs?.toFixed(1)} LUFS (the ${voice ? "score and voiceover were" : "score alone was"} ${master.before?.toFixed(1)}), true peak ${after.truePeak?.toFixed(1)} dBTP.`,
    report.music ? musicLine(report.music) : "Music: none.",
    `Effects: ${report.effects ? "yes" : "none"}.`,
    ...(spans.length
      ? [
          `The person's own volume edits, from sound/mix.json, are applied on top (leave that file alone): ${spans
            .map((s) => `${s.stem} ${s.from.toFixed(2)} to ${s.to.toFixed(2)} s ${s.mute ? "muted" : `${s.gain > 0 ? "+" : ""}${s.gain.toFixed(1)} dB`}`)
            .join(", ")}.`,
        ]
      : []),
    `Onsets (${onsets.length}), with the film mark each lands on:`,
    ...describeOnsets(onsets, [...(film.marks ?? []), ...context.graphics.map((g) => ({ t: g.start, label: `${g.graphic} appears`, after: Math.min(0.8, g.duration) }))]),
    ...(context.graphics.length ? [`Graphics: ${context.graphics.map((g) => `${g.graphic} ${g.start.toFixed(2)} to ${(g.start + g.duration).toFixed(2)} s`).join(", ")}.`] : []),
    ...(voice
      ? [`Voiceover: ${clips.length} clip${clips.length === 1 ? "" : "s"} from sound/voice.json, ${voice.spans.map((v) => `${v.start.toFixed(2)} to ${v.end.toFixed(2)} s`).join(", ")}; the music dips under them.`]
      : context.speech.length
        ? [`Speech: ${context.speech.length} words; the music dips under them.`]
        : []),
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
