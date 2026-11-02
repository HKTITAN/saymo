// Claude's ears for a sound file. Claude can't hear, so this listens for it
// and prints a short plain report: length, tempo and beats, where sounds
// start, key and the main notes, loudness over time, brightness, the
// low/mid/high balance, how hits attack and decay, stereo width, and any
// words that are spoken or sung.
//
// usage:
//   node scripts/studio/listen.mjs <file> [--from s] [--to s] [--words | --no-words]
//   node scripts/studio/listen.mjs --film <id> refs/<file> [--from s] [--to s]
//   node scripts/studio/listen.mjs --film <id> --stem music|effects|mix [--from s] [--to s]
//
// With --film, only that film's own files can be heard: a reference sound
// attached to a prompt (in films/<id>/refs/) or the film's rendered sound
// (its music or effects stem, or the full mix), so the two can be compared.
// Nothing goes through a shell. ffmpeg decodes; the rest is plain JS.
//
// Words are transcribed with the studio's whisper (transcribe.mjs) when the
// part listened to is 3 minutes or shorter, or with --words.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RATE = 32000; // analysis rate: covers up to 16 kHz, light enough to be quick
const MAX_SECONDS = 300; // longer files: the first 5 minutes, unless --from/--to say otherwise
const WORDS_UP_TO = 180;

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

// ─── Arguments ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { file: null, film: null, stem: null, from: null, to: null, words: null };
  const seen = new Set();
  const number = (flag, v) => {
    const n = Number(v);
    if (v === undefined || !Number.isFinite(n) || n < 0 || n > 36000) fail(`${flag} needs a time in seconds, like ${flag} 2.5.`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      if (seen.has(a)) fail(`${a} was given twice.`);
      seen.add(a);
    }
    if (a === "--film") out.film = argv[++i] ?? "";
    else if (a === "--stem") out.stem = argv[++i] ?? "";
    else if (a === "--from") out.from = number(a, argv[++i]);
    else if (a === "--to") out.to = number(a, argv[++i]);
    else if (a === "--words") out.words = true;
    else if (a === "--no-words") out.words = false;
    else if (a.startsWith("-")) fail(`Unknown option ${a}. See the usage at the top of listen.mjs.`);
    else if (out.file) fail("Give one file at a time.");
    else out.file = a;
  }
  if (seen.has("--words") && seen.has("--no-words")) fail("Use --words or --no-words, not both.");
  if (out.from !== null && out.to !== null && out.to <= out.from) fail("--to must be later than --from.");
  return out;
}

const args = parseArgs(process.argv.slice(2));
let source;
let label;
if (args.film !== null) {
  if (!/^[a-z0-9]{8}$/.test(args.film)) fail("--film needs a film id (8 letters and digits).");
  const filmDir = path.join(ROOT, "films", args.film);
  if (!existsSync(path.join(filmDir, "film.json"))) fail(`There's no film "${args.film}".`);
  if (args.stem !== null) {
    if (args.file) fail("Give a reference file or --stem, not both.");
    const stems = { music: "music.wav", effects: "effects.wav", mix: "sound.wav" };
    if (!stems[args.stem]) fail("--stem is music, effects or mix.");
    source = path.join(filmDir, "sound", stems[args.stem]);
    if (!existsSync(source)) fail(`This film has no rendered ${args.stem === "mix" ? "sound" : `${args.stem} stem`} yet. Render the sound first.`);
    label = args.stem === "mix" ? "the film's sound (music and effects mixed)" : `the film's ${args.stem} stem`;
  } else {
    if (!args.file) fail("Name a reference file (refs/<file>) or a --stem.");
    // Only files attached to this film, in its refs/ folder.
    const refs = path.join(filmDir, "refs");
    const wanted = path.resolve(filmDir, args.file);
    let real;
    try {
      real = realpathSync(wanted);
    } catch {
      fail(`There's no ${args.file} in this film's references.`);
    }
    if (!existsSync(refs) || path.dirname(real) !== realpathSync(refs) || !statSync(real).isFile()) {
      fail("With --film, only files in that film's refs/ folder (or --stem) can be heard.");
    }
    source = real;
    label = `refs/${path.basename(real)}`;
  }
} else {
  if (args.stem !== null) fail("--stem needs --film <id>.");
  if (!args.file) fail("usage: node scripts/studio/listen.mjs <file> [--from s] [--to s]");
  source = path.resolve(args.file);
  if (!existsSync(source) || !statSync(source).isFile()) fail(`There's no file at ${args.file}.`);
  label = path.basename(source);
}

// ─── Running ffmpeg ─────────────────────────────────────────────────────────

function run(cmd, argv, { binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    let err = "";
    child.stdout.on("data", (c) => out.push(c));
    child.stderr.on("data", (c) => (err = (err + c).slice(-20000)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(err.trim().split("\n").at(-1) || `${cmd} failed`));
      else resolve({ stdout: binary ? Buffer.concat(out) : Buffer.concat(out).toString(), stderr: err });
    });
  });
}

async function probe(file) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,sample_rate,channels", "-of", "json", file]);
  const j = JSON.parse(stdout);
  const a = j.streams?.find((s) => s.codec_type === "audio");
  if (!a) fail("This file has no sound in it.");
  return { duration: Number(j.format?.duration) || 0, rate: Number(a.sample_rate) || 0, channels: Number(a.channels) || 0 };
}

const span = (from, length) => [...(from ? ["-ss", String(from)] : []), "-t", String(length)];

async function decode(file, from, length) {
  const { stdout } = await run(
    "ffmpeg",
    ["-v", "error", ...span(from, length), "-i", file, "-vn", "-ac", "2", "-ar", String(RATE), "-f", "f32le", "-"],
    { binary: true },
  );
  const buf = stdout;
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
}

async function loudness(file, from, length) {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", ...span(from, length), "-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const s = stderr.slice(stderr.lastIndexOf("Summary:"));
  const num = (re) => {
    const v = Number(re.exec(s)?.[1]);
    return Number.isFinite(v) ? v : null;
  };
  return { lufs: num(/I:\s+(-?[\d.]+) LUFS/), range: num(/LRA:\s+(-?[\d.]+) LU/), peak: num(/Peak:\s+(-?[\d.]+) dBFS/) };
}

// ─── DSP ────────────────────────────────────────────────────────────────────

const db = (v) => (v > 1e-10 ? 20 * Math.log10(v) : -200);
const median = (list) => {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// In-place radix-2 FFT, tables cached per size.
const fftTables = new Map();
function tables(n) {
  let t = fftTables.get(n);
  if (t) return t;
  const rev = new Uint32Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = -Math.sin((2 * Math.PI * i) / n);
  }
  const hann = new Float64Array(n);
  for (let i = 0; i < n; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  t = { rev, cos, sin, hann };
  fftTables.set(n, t);
  return t;
}

// Magnitude spectrum (n/2 + 1 bins) of a Hann-windowed frame starting at
// `at` (frames are centred on their times, so `at` may be negative).
function spectrum(signal, at, n, re, im, mag) {
  const { rev, cos, sin, hann } = tables(n);
  for (let i = 0; i < n; i++) {
    const j = at + i;
    re[rev[i]] = j >= 0 && j < signal.length ? signal[j] * hann[i] : 0;
    im[rev[i]] = 0;
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const c = cos[k * step];
        const s = sin[k * step];
        const a = start + k;
        const b = a + half;
        const tr = re[b] * c - im[b] * s;
        const ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  for (let k = 0; k <= n / 2; k++) mag[k] = Math.hypot(re[k], im[k]) / (n / 4);
}

const NOTE = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const noteName = (midi) => `${NOTE[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
const midiOf = (hz) => 69 + 12 * Math.log2(hz / 440);
const hzOf = (midi) => 440 * 2 ** ((midi - 69) / 12);

// Short frames (32 ms, every 10 ms): onsets, brightness, band balance.
function shortFrames(mono) {
  const n = 1024;
  const hop = RATE / 100;
  const count = Math.floor(mono.length / hop) + 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const mag = new Float64Array(n / 2 + 1);
  let prev = new Float64Array(n / 2 + 1);
  let cur = new Float64Array(n / 2 + 1);
  const flux = new Float64Array(count);
  const centroid = new Float64Array(count);
  const energy = new Float64Array(count);
  const bands = [0, 0, 0];
  const binHz = RATE / n;
  const lowTop = Math.round(250 / binHz);
  const midTop = Math.round(4000 / binHz);
  for (let f = 0; f < count; f++) {
    spectrum(mono, f * hop - n / 2, n, re, im, mag);
    let sum = 0;
    let weighted = 0;
    let rise = 0;
    for (let k = 1; k <= n / 2; k++) {
      const p = mag[k] * mag[k];
      sum += p;
      weighted += p * k * binHz;
      if (k < lowTop) bands[0] += p;
      else if (k < midTop) bands[1] += p;
      else bands[2] += p;
      cur[k] = Math.log1p(100 * mag[k]);
      const d = cur[k] - prev[k];
      if (d > 0) rise += d;
    }
    flux[f] = rise; // the first frame against silence
    centroid[f] = sum > 0 ? weighted / sum : 0;
    energy[f] = sum;
    [prev, cur] = [cur, prev];
  }
  return { flux, centroid, energy, bands, hop: 0.01, count };
}

// Long frames (128 ms, every 32 ms): pitch classes for the key, and the
// main note in each frame when the sound is tonal.
function longFrames(mono) {
  const n = 4096;
  const hop = 1024;
  const count = Math.floor(mono.length / hop) + 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const mag = new Float64Array(n / 2 + 1);
  const binHz = RATE / n;
  const chroma = new Float64Array(12);
  const notes = new Array(count).fill(null);
  let tonalFrames = 0;
  let loudFrames = 0;
  const lo = Math.ceil(30 / binHz);
  const hi = Math.floor(4200 / binHz);
  // The strongest bin near a frequency (within a quarter tone).
  const near = (hz) => {
    const a = Math.max(1, Math.floor((hz * 0.986) / binHz));
    const b = Math.min(n / 2, Math.ceil((hz * 1.014) / binHz));
    let m = 0;
    for (let k = a; k <= b; k++) if (mag[k] > m) m = mag[k];
    return m;
  };
  for (let f = 0; f < count; f++) {
    spectrum(mono, f * hop - n / 2, n, re, im, mag);
    let total = 0;
    let logSum = 0;
    let lin = 0;
    for (let k = lo; k <= hi; k++) {
      const p = mag[k] * mag[k] + 1e-12;
      total += p;
      logSum += Math.log(p);
      lin += p;
    }
    const bins = hi - lo + 1;
    if (db(Math.sqrt(total)) < -60) continue; // silence
    loudFrames++;
    const flatness = Math.exp(logSum / bins) / (lin / bins);
    // Peaks only, so noise doesn't smear across every pitch class.
    let peakMax = 0;
    for (let k = lo; k <= hi; k++) if (mag[k] > peakMax) peakMax = mag[k];
    for (let k = lo + 1; k < hi; k++) {
      if (mag[k] < peakMax * 0.05 || mag[k] < mag[k - 1] || mag[k] < mag[k + 1]) continue;
      // Parabolic interpolation for the true frequency.
      const a = Math.log(mag[k - 1] + 1e-12);
      const b = Math.log(mag[k] + 1e-12);
      const c = Math.log(mag[k + 1] + 1e-12);
      const shift = (0.5 * (a - c)) / (a - 2 * b + c || 1);
      const hz = (k + shift) * binHz;
      if (hz < 60 || hz > 2100) continue;
      chroma[((Math.round(midiOf(hz)) % 12) + 12) % 12] += mag[k];
    }
    if (flatness > 0.2) continue;
    // Main pitch by subharmonic summation, C1 to C7 (below C2 only to the nearest few semitones).
    let best = null;
    let bestScore = 0;
    for (let m = 24; m <= 96; m++) {
      const f0 = hzOf(m);
      let s = 0;
      for (let h = 1; h <= 6 && f0 * h < RATE / 2 - binHz; h++) s += 0.8 ** (h - 1) * near(f0 * h);
      if (s > bestScore) {
        bestScore = s;
        best = m;
      }
    }
    // A note is a peak that stands well clear of the spectrum around it
    // (noise, however coloured, doesn't).
    const prominence = (hz) => {
      const a = Math.max(1, Math.floor(Math.min(hz * 0.8, hz - 8 * binHz) / binHz));
      const b = Math.min(n / 2, Math.ceil(Math.max(hz * 1.25, hz + 8 * binHz) / binHz));
      const around = [];
      for (let k = a; k <= b; k++) around.push(mag[k]);
      return near(hz) / (median(around) + 1e-9);
    };
    let clear = 0;
    if (best !== null) for (let h = 1; h <= 3; h++) clear = Math.max(clear, prominence(hzOf(best) * h));
    if (best !== null && near(hzOf(best)) > peakMax * 0.1 && clear >= 4) {
      notes[f] = best;
      tonalFrames++;
    }
  }
  return { chroma, notes, hop: hop / RATE, tonal: loudFrames ? tonalFrames / loudFrames : 0 };
}

// Krumhansl-Kessler key profiles.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
function pearson(a, b) {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let dbb = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    dbb += (b[i] - mb) ** 2;
  }
  return da && dbb ? num / Math.sqrt(da * dbb) : 0;
}
function keyOf(chroma) {
  const scores = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const [profile, mode] of [[MAJOR, "major"], [MINOR, "minor"]]) {
      const rotated = profile.map((_, i) => profile[(i - tonic + 12) % 12]);
      scores.push({ name: `${NOTE[tonic]} ${mode}`, r: pearson([...chroma], rotated) });
    }
  }
  return scores.sort((a, b) => b.r - a.r);
}

// A 5 ms RMS envelope, read at any millisecond (centred on it).
function fineEnvelope(mono) {
  const win = Math.round(0.005 * RATE);
  const hop = Math.round(0.001 * RATE);
  const sq = new Float64Array(mono.length + 1);
  for (let i = 0; i < mono.length; i++) sq[i + 1] = sq[i] + mono[i] * mono[i];
  const totalMs = Math.max(0, Math.floor((mono.length - win) / hop));
  const env = (ms) => {
    const a = Math.max(0, Math.min(mono.length - win, Math.round(ms * hop - win / 2)));
    return Math.sqrt((sq[a + win] - sq[a]) / win);
  };
  return { env, totalMs };
}

// Onsets: peaks in spectral flux above a local median, loud enough to hear,
// at least 50 ms apart, each moved to where its sound actually starts (the
// rise to a quarter of its peak, to the millisecond).
function onsetsOf({ flux, energy, hop }, { env, totalMs }) {
  const out = [];
  const mean = flux.reduce((s, v) => s + v, 0) / Math.max(1, flux.length);
  const peakE = Math.max(...energy, 1e-12);
  let last = -Infinity;
  for (let f = 0; f < flux.length; f++) {
    const v = flux[f];
    let local = true;
    for (let k = Math.max(0, f - 3); k <= Math.min(flux.length - 1, f + 3); k++) {
      if (flux[k] > v || (k < f && flux[k] === v)) local = false;
    }
    if (!local) continue;
    const win = Array.from(flux.slice(Math.max(0, f - 15), f + 16));
    if (v < median(win) + 0.6 * mean + 1e-6) continue;
    const loud = Math.max(energy[f], energy[Math.min(energy.length - 1, f + 2)]);
    if (10 * Math.log10(loud / peakE) < -40) continue;
    const centre = Math.round(f * hop * 1000);
    let peakAt = centre;
    let peak = 0;
    for (let ms = Math.max(0, centre - 40); ms <= Math.min(totalMs, centre + 40); ms++) {
      const e = env(ms);
      if (e > peak) {
        peak = e;
        peakAt = ms;
      }
    }
    let start = peakAt;
    const stop = Math.max(0, centre - 40, Math.round(last * 1000) + 20);
    while (start > stop && env(start - 1) > peak * 0.25) start--;
    const t = start / 1000;
    // The very end of the part is where the cut is, not a new sound.
    if (t - last < 0.05 || t > (totalMs - 30) / 1000) continue;
    out.push({ t, strength: v });
    last = t;
  }
  return out;
}

// Tempo from the autocorrelation of the onset strength, leaning towards
// 120 BPM between octave choices (as people tap), then refined on the comb
// of its multiples. Confidence: how strongly the strength repeats at that
// period (0 none, 1 perfectly).
function tempoOf({ flux, hop }) {
  const env = Array.from(flux.slice(0, Math.min(flux.length, 12000)));
  const mean = env.reduce((s, v) => s + v, 0) / Math.max(1, env.length);
  const x = env.map((v) => v - mean);
  const ac = (lag) => {
    const L = Math.floor(lag);
    const frac = lag - L;
    let s0 = 0;
    let s1 = 0;
    for (let i = 0; i + L + 1 < x.length; i++) {
      s0 += x[i] * x[i + L];
      s1 += x[i] * x[i + L + 1];
    }
    return s0 * (1 - frac) + s1 * frac;
  };
  const zero = ac(0);
  if (zero <= 0 || x.length < 300) return null;
  const minLag = Math.round(60 / 220 / hop);
  const maxLag = Math.round(60 / 50 / hop);
  let bestLag = 0;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 / (lag * hop);
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 1) ** 2);
    const s = (ac(lag) / zero) * prior;
    if (s > bestScore) {
      bestScore = s;
      bestLag = lag;
    }
  }
  if (bestScore <= 0) return null;
  // Refine: the period whose multiples line up best.
  let period = bestLag;
  let combBest = -Infinity;
  for (let p = bestLag - 1.5; p <= bestLag + 1.5; p += 0.02) {
    let s = 0;
    for (let k = 1; k <= 4 && k * p < x.length / 2; k++) s += ac(k * p);
    if (s > combBest) {
      combBest = s;
      period = p;
    }
  }
  const confidence = Math.max(0, Math.min(1, ac(period) / zero));
  return { bpm: 60 / (period * hop), period, confidence };
}

// Beats: dynamic programming over the onset strength (Ellis 2007), so beats
// sit on real onsets while keeping close to the tempo.
function beatsOf({ flux, hop }, period) {
  const n = flux.length;
  const sd = Math.sqrt(flux.reduce((s, v) => s + v * v, 0) / n) || 1;
  const env = Array.from(flux, (v) => v / sd);
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const tight = 100;
  for (let t = 0; t < n; t++) {
    let best = 0;
    let from = -1;
    for (let p = Math.max(0, Math.round(t - 2 * period)); p <= t - Math.round(period / 2); p++) {
      const s = score[p] - tight * Math.log((t - p) / period) ** 2;
      if (s > best) {
        best = s;
        from = p;
      }
    }
    score[t] = env[t] + best;
    back[t] = from;
  }
  let end = n - 1;
  for (let t = Math.max(0, n - Math.round(period)); t < n; t++) if (score[t] > score[end]) end = t;
  const beats = [];
  for (let t = end; t >= 0; t = back[t]) beats.unshift(t);
  // Trim weak beats at either end (before the music starts, after it stops).
  const strong = beats.map((b) => env[b]);
  const floor = 0.5 * median(strong);
  while (beats.length && env[beats[0]] < floor) beats.shift();
  while (beats.length && env[beats.at(-1)] < floor) beats.pop();
  return beats.map((b) => b * hop);
}

// Loudness per window in dBFS (RMS of both channels).
function rmsWindows(pcm, seconds) {
  const step = Math.max(1, Math.round(seconds * RATE));
  const frames = pcm.length / 2;
  const out = [];
  for (let s = 0; s < frames; s += step) {
    let sum = 0;
    const e = Math.min(frames, s + step);
    for (let i = s; i < e; i++) sum += pcm[2 * i] ** 2 + pcm[2 * i + 1] ** 2;
    out.push(db(Math.sqrt(sum / (2 * (e - s)))));
  }
  return out;
}

// How each hit attacks and dies away, from a 5 ms RMS envelope.
function hitShape({ env, totalMs }, onsets) {
  const strongest = [...onsets].sort((a, b) => b.strength - a.strength).slice(0, 24);
  const attacks = [];
  const decays = [];
  let held = 0;
  for (const o of strongest) {
    const at = Math.round(o.t * 1000);
    const next = onsets.find((x) => x.t > o.t + 0.01);
    const until = Math.min(totalMs, next ? Math.round(next.t * 1000) - 5 : at + 3000);
    let peakAt = at;
    let peak = 0;
    for (let ms = Math.max(0, at - 20); ms <= Math.min(until, at + 200); ms++) {
      const v = env(ms);
      if (v > peak) {
        peak = v;
        peakAt = ms;
      }
    }
    if (peak <= 1e-5) continue;
    // The rise from the quietest point just before (the last sound may
    // still be ringing) to the peak: 10% to 90% of the way.
    const prev = onsets.findLast((x) => x.t < o.t - 0.01);
    let base = peak;
    let baseAt = peakAt;
    for (let ms = peakAt; ms >= Math.max(0, at - 60, prev ? Math.round(prev.t * 1000) + 5 : 0); ms--) {
      const v = env(ms);
      if (v <= base) {
        base = v;
        baseAt = ms;
      }
    }
    let low = baseAt;
    while (low < peakAt && env(low) < base + 0.1 * (peak - base)) low++;
    let rise = low;
    while (rise < peakAt && env(rise) < base + 0.9 * (peak - base)) rise++;
    attacks.push(Math.max(1, rise - low));
    let fall = peakAt;
    while (fall < until && env(fall) > peak * 0.1) fall++;
    if (fall >= until && env(fall) > peak * 0.1) held++;
    else decays.push(fall - peakAt);
  }
  return { attacks, decays, held, count: attacks.length };
}

function stereoOf(pcm) {
  let ll = 0;
  let rr = 0;
  let lr = 0;
  let mid = 0;
  let side = 0;
  for (let i = 0; i < pcm.length; i += 2) {
    const l = pcm[i];
    const r = pcm[i + 1];
    ll += l * l;
    rr += r * r;
    lr += l * r;
    mid += ((l + r) / 2) ** 2;
    side += ((l - r) / 2) ** 2;
  }
  return {
    correlation: ll && rr ? lr / Math.sqrt(ll * rr) : 1,
    width: mid ? Math.sqrt(side / mid) : 0,
    balance: ll && rr ? 10 * Math.log10(ll / rr) : 0,
  };
}

// Whisper, through the studio's own transcriber.
async function wordsOf(file, from, length) {
  const whisper = path.join(ROOT, "node_modules/.cache/studio-whisper");
  if (!existsSync(whisper)) return { skipped: "listening for words isn't set up on this Mac yet" };
  const tag = randomBytes(5).toString("hex");
  const clip = path.join(tmpdir(), `listen-${tag}.wav`);
  const out = path.join(tmpdir(), `listen-${tag}.json`);
  try {
    await run("ffmpeg", ["-v", "error", "-y", ...span(from, length), "-i", file, "-vn", "-ac", "1", "-ar", "16000", clip]);
    await run(process.execPath, [path.join(ROOT, "scripts/studio/transcribe.mjs"), clip, out]);
    return { words: JSON.parse(readFileSync(out, "utf8")) };
  } catch {
    return { skipped: "the transcriber couldn't run" };
  } finally {
    rmSync(clip, { force: true });
    rmSync(out, { force: true });
  }
}

// ─── The report ─────────────────────────────────────────────────────────────

// What whisper tends to "hear" in music, noise or silence.
const PHANTOM = /^\W*(soci[eé]t[eé] radio-canada|sous-titr\S*|subtitles? by.*|amara\.org|thanks? (you )?for watching|thank you|you|bye|music|applause)\W*$/i;

const s2 = (t) => t.toFixed(2);
const rows = (items, per, indent = "  ") => {
  const lines = [];
  for (let i = 0; i < items.length; i += per) lines.push(indent + items.slice(i, i + per).join("  "));
  return lines;
};
// A window length (in seconds) giving at most `most` values over `length`.
const windowFor = (length, base, most) => {
  let w = base;
  while (length / w > most) w *= 2;
  return w;
};

async function main() {
  const started = Date.now();
  const info = await probe(source);
  const from = args.from ?? 0;
  if (from >= info.duration) fail(`The file is only ${s2(info.duration)} s long.`);
  let to = Math.min(info.duration, args.to ?? info.duration);
  let capped = false;
  if (to - from > MAX_SECONDS && args.to === null) {
    to = from + MAX_SECONDS;
    capped = true;
  }
  const length = to - from;
  const wantWords = args.words ?? length <= WORDS_UP_TO;

  const [pcm, loud, heard] = await Promise.all([
    decode(source, from, length),
    loudness(source, from, length).catch(() => ({ lufs: null, range: null, peak: null })),
    wantWords ? wordsOf(source, from, length) : Promise.resolve(null),
  ]);
  const frames = pcm.length / 2;
  if (frames < RATE * 0.05) fail("That part is too short to listen to (under 50 ms).");
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) mono[i] = (pcm[2 * i] + pcm[2 * i + 1]) / 2;

  const short = shortFrames(mono);
  // The cut at the end of the part splashes across the spectrum; it isn't a beat.
  for (let f = Math.max(0, Math.floor((frames / RATE - 0.03) / short.hop)); f < short.count; f++) short.flux[f] = 0;
  const long = longFrames(mono);
  const fine = fineEnvelope(mono);
  const onsets = onsetsOf(short, fine);
  const tempo = tempoOf(short);
  const steady = tempo && tempo.confidence >= 0.25;
  const beats = steady ? beatsOf(short, tempo.period) : [];
  const stereo = stereoOf(pcm);
  const shape = hitShape(fine, onsets);
  const at = (t) => from + t; // times in the file (or the film, for a stem)

  const out = [];
  const where = from > 0 || to < info.duration ? `, ${s2(from)} s to ${s2(to)} s of ${s2(info.duration)} s` : "";
  const chans = info.channels === 1 ? "mono" : info.channels === 2 ? "stereo" : `${info.channels} channels`;
  out.push(`Listening to ${label}${where}. ${s2(length)} s, ${info.rate ? `${(info.rate / 1000).toFixed(1)} kHz ` : ""}${chans}.`);
  if (capped) out.push(`(Only the first ${MAX_SECONDS} s; use --from and --to for another part.)`);
  out.push("All times below are seconds in the file" + (args.stem ? " (film time)." : "."));

  // Loudness.
  const env = rmsWindows(pcm, windowFor(length, 0.25, 96));
  const envStep = windowFor(length, 0.25, 96);
  const lufs = loud.lufs !== null && loud.lufs > -70 ? `${loud.lufs.toFixed(1)} LUFS integrated` : "too quiet or short for an integrated LUFS";
  out.push("");
  out.push(`Loudness: ${lufs}, true peak ${loud.peak !== null ? `${loud.peak.toFixed(1)} dBTP` : "?"}, range ${loud.range !== null ? `${loud.range.toFixed(1)} LU` : "?"}.`);
  out.push(`Loudness every ${envStep} s (dBFS RMS, 8 per row):`);
  out.push(
    ...rows(
      env.map((v) => (v < -90 ? "  -" : String(Math.round(v)).padStart(3))),
      8,
    ).map((line, i) => `  ${s2(at(i * 8 * envStep)).padStart(6)}:${line}`),
  );

  // Rhythm.
  out.push("");
  if (!tempo) out.push("Tempo: no steady beat (too short or no rhythm to find).");
  else if (!steady) out.push(`Tempo: no steady beat (best guess ${tempo.bpm.toFixed(1)} BPM, confidence ${tempo.confidence.toFixed(2)}).`);
  else {
    const word = tempo.confidence >= 0.5 ? "a steady beat" : "a loose pulse";
    out.push(`Tempo: ${tempo.bpm.toFixed(1)} BPM, confidence ${tempo.confidence.toFixed(2)} (${word}; half or double time is also possible).`);
    out.push(`Beats (${beats.length}${beats.length > 40 ? ", first 40" : ""}):`);
    out.push(...rows(beats.slice(0, 40).map((t) => s2(at(t))), 10));
  }
  out.push(`Onsets, where sounds start (${onsets.length}${onsets.length > 40 ? ", first 40" : ""}${onsets.length ? `, about ${(onsets.length / length).toFixed(1)} a second` : ""}):`);
  out.push(...(onsets.length ? rows(onsets.slice(0, 40).map((o) => s2(at(o.t))), 10) : ["  none: a smooth bed, or silence"]));

  // Hits.
  if (shape.count) {
    const att = median(shape.attacks);
    const dec = shape.decays.length ? median(shape.decays) : null;
    const attackWord = att < 5 ? "sharp, clicky" : att < 20 ? "punchy" : att < 60 ? "soft" : "a slow swell";
    const decayWord = dec === null ? "" : dec < 80 ? "very short" : dec < 250 ? "short" : dec < 800 ? "medium" : "long, ringing";
    const heldShare = shape.held / shape.count;
    let line = `Hits (the ${shape.count} strongest): attack ${Math.round(att)} ms (${attackWord})`;
    if (dec !== null) line += `, decay to -20 dB ${Math.round(dec)} ms (${decayWord})`;
    if (heldShare >= 0.5) line += `; ${Math.round(heldShare * 100)}% ring on into the next sound (sustained, legato)`;
    out.push(`${line}.`);
  }

  // Pitch.
  out.push("");
  const keys = keyOf(long.chroma);
  const tonalPct = Math.round(long.tonal * 100);
  if (long.tonal < 0.2 || !long.chroma.some((v) => v > 0)) {
    out.push(`Pitch: mostly unpitched (tonal ${tonalPct}% of the time): noise, drums or texture. No clear key.`);
  } else {
    const [k1, k2] = keys;
    const total = long.chroma.reduce((s, v) => s + v, 0) || 1;
    const classes = [...long.chroma].map((v, i) => ({ n: NOTE[i], v: v / total })).sort((a, b) => b.v - a.v);
    const sure = k1.r >= 0.75 ? "clear" : k1.r >= 0.55 ? "likely" : "unsure";
    // One or two notes can't say which key they belong to.
    const sounding = classes.filter((c) => c.v >= 0.05).map((c) => c.n);
    if (sounding.length < 3) out.push(`Key: can't tell, only ${sounding.join(" and ")} sound. Tonal ${tonalPct}% of the time.`);
    else if (k1.r < 0.5) out.push(`Key: no clear key (closest ${k1.name}, fit ${k1.r.toFixed(2)}). Tonal ${tonalPct}% of the time.`);
    else out.push(`Key: ${k1.name} (${sure}, fit ${k1.r.toFixed(2)}; next ${k2.name} ${k2.r.toFixed(2)}). Tonal ${tonalPct}% of the time.`);
    out.push(`Pitch classes by weight: ${classes.slice(0, 7).map((c) => `${c.n} ${Math.round(c.v * 100)}%`).join(", ")}.`);
    // The main note over time: smoothed, runs under 100 ms dropped.
    const raw = long.notes;
    const smooth = raw.map((_, i) => {
      const w = raw.slice(Math.max(0, i - 2), i + 3).filter((v) => v !== null);
      if (raw[i] === null || w.length < 3) return raw[i];
      const counts = new Map();
      for (const v of w) counts.set(v, (counts.get(v) ?? 0) + 1);
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    });
    const runs = [];
    for (let i = 0; i < smooth.length; i++) {
      const m = smooth[i];
      const lastRun = runs.at(-1);
      if (m !== null && lastRun && lastRun.m === m && i - lastRun.end <= 2) lastRun.end = i + 1;
      else if (m !== null) runs.push({ m, start: i, end: i + 1 });
    }
    // Long frames blur when a note starts; take the onset nearby instead.
    const notes = runs
      .filter((r) => (r.end - r.start) * long.hop >= 0.1)
      .map((r) => {
        const guess = r.start * long.hop;
        // A frame hears a note from 64 ms before its centre, so the onset is at or just after the guess.
        const near = onsets.filter((o) => o.t >= guess - 0.03 && o.t <= guess + 0.1).sort((a, b) => Math.abs(a.t - guess - 0.04) - Math.abs(b.t - guess - 0.04))[0];
        return { m: r.m, from: near ? near.t : guess, to: Math.min(length, r.end * long.hop) };
      })
      .filter((r, i, all) => (Math.min(r.to, all[i + 1]?.from ?? r.to) - r.from) >= 0.05);
    if (notes.length) {
      const midis = notes.map((r) => r.m);
      out.push(
        `Main notes (${notes.length}${notes.length > 40 ? ", first 40" : ""}; range ${noteName(Math.min(...midis))} to ${noteName(Math.max(...midis))}), as start note length:`,
      );
      out.push(...rows(notes.slice(0, 40).map((r, i) => `${s2(at(r.from))} ${noteName(r.m)} ${(Math.min(r.to, notes[i + 1]?.from ?? r.to) - r.from).toFixed(2)}`), 6));
    } else out.push("Main notes: none held long enough to name.");
  }

  // Tone colour.
  out.push("");
  const silent = 1e-7;
  const lit = [];
  for (let f = 0; f < short.count; f++) if (short.energy[f] > silent) lit.push(f);
  let cw = 0;
  let ew = 0;
  for (const f of lit) {
    cw += short.centroid[f] * short.energy[f];
    ew += short.energy[f];
  }
  const centre = ew ? cw / ew : 0;
  const brightWord = centre < 600 ? "dark, deep" : centre < 1500 ? "warm" : centre < 3000 ? "bright" : "very bright, airy";
  out.push(`Brightness (spectral centroid): ${Math.round(centre)} Hz on average (${brightWord}).`);
  const cStep = windowFor(length, 0.5, 40);
  const perWindow = [];
  for (let s = 0; s < length; s += cStep) {
    const a = Math.floor(s / short.hop);
    const b = Math.min(short.count, Math.floor((s + cStep) / short.hop));
    let c = 0;
    let e = 0;
    for (let f = a; f < b; f++) {
      if (short.energy[f] <= silent) continue;
      c += short.centroid[f] * short.energy[f];
      e += short.energy[f];
    }
    perWindow.push(e ? String(Math.round(c / e)).padStart(5) : "    -");
  }
  out.push(`Brightness every ${cStep} s (Hz, 8 per row):`);
  out.push(...rows(perWindow, 8).map((line, i) => `  ${s2(at(i * 8 * cStep)).padStart(6)}:${line}`));
  const bandTotal = short.bands.reduce((s, v) => s + v, 0) || 1;
  const [low, mid, high] = short.bands.map((v) => Math.round((100 * v) / bandTotal));
  const tilt = low >= 60 ? "bass-heavy" : high >= 25 ? "bright, lots of top" : mid >= 70 ? "mid-focused" : "balanced";
  out.push(`Balance: low (under 250 Hz) ${low}%, mid ${mid}%, high (over 4 kHz) ${high}% of the energy (${tilt}).`);

  // Space.
  const { correlation, width, balance } = stereo;
  const spread =
    correlation > 0.995 && width < 0.05 ? "mono (both sides the same)" : correlation < 0 ? "out of phase (it may vanish on a phone speaker)" : width < 0.25 ? "narrow" : width < 0.6 ? "moderately wide" : "wide";
  const side = Math.abs(balance) < 1 ? "centred" : `${Math.abs(balance).toFixed(1)} dB louder on the ${balance > 0 ? "left" : "right"}`;
  out.push(`Stereo: ${spread}; width ${width.toFixed(2)} (side to mid), left/right correlation ${correlation.toFixed(2)}, ${side}.`);

  // Words.
  out.push("");
  if (!heard) out.push(`Words: not checked (over ${WORDS_UP_TO} s; add --words to transcribe).`);
  else if (heard.skipped) out.push(`Words: not checked (${heard.skipped}).`);
  else {
    // Whisper "hears" stock phrases in music and noise; real words are short.
    const words = heard.words.filter((w) => (w.confidence ?? 1) >= 0.3 && w.end - w.start <= 1.5);
    const sure = words.length ? words.reduce((s, w) => s + (w.confidence ?? 1), 0) / words.length : 0;
    const said = words.map((w) => w.text).join(" ");
    if (!words.length || (words.length <= 2 && sure < 0.6) || PHANTOM.test(said)) out.push("Words: none heard.");
    else {
      const lines = [];
      let cur = null;
      for (const w of words) {
        if (!cur || w.start - cur.end > 0.6 || cur.text.length > 70) {
          cur = { start: w.start, end: w.end, text: w.text };
          lines.push(cur);
        } else {
          cur.text += ` ${w.text}`;
          cur.end = w.end;
        }
      }
      out.push(`Words (${words.length}${sure < 0.6 ? ", unclear, may be sung or muffled" : ""}):`);
      out.push(...lines.slice(0, 20).map((l) => `  ${s2(at(l.start))} to ${s2(at(l.end))}: ${l.text}`));
      if (lines.length > 20) out.push(`  …and ${lines.length - 20} more lines`);
    }
  }
  out.push("");
  out.push(`Listened in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
  console.log(out.join("\n"));
}

main().catch((error) => fail(`Couldn't listen to ${label}: ${error.message}`));
