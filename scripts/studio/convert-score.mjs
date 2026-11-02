// Converts a film's music from Strudel code to the studio's music bed
// (studio/sound/bed.js, Tone.js), so the film no longer needs Strudel.
//
//   node scripts/studio/convert-score.mjs <film-id>           convert, then compare
//   node scripts/studio/convert-score.mjs <film-id> --dry     print the new music, write nothing
//   node scripts/studio/convert-score.mjs <film-id> --compare compare an already converted film
//
// It reads films/<id>/sound/score.js, asks Strudel itself (in the in-house
// sound engine) for every note the music plays, and writes those notes,
// with their sounds, envelopes, filters, room and echo, as a music bed.
// Only the `music` value changes; everything else in score.js stays byte
// for byte. The original is kept as sound/score.strudel.js (never
// overwritten), so `cp score.strudel.js score.js` undoes it.
//
// Afterwards it renders the old and the new music on their own and prints
// how close they are: loudness, the low, mid and high balance, and onsets
// per bar. Converting is in-house only (it needs Strudel to read the old
// code); the product edition never sees Strudel scores.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { hasStrudel, openEngine, ROOT } from "./sound-engine.mjs";

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--"));
const dry = args.includes("--dry");
const compareOnly = args.includes("--compare");

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (!id || !/^[a-z0-9]{8}$/.test(id)) fail("usage: node scripts/studio/convert-score.mjs <film-id> [--dry | --compare]");

const dir = path.join(ROOT, "films", id);
const scoreFile = path.join(dir, "sound/score.js");
const backupFile = path.join(dir, "sound/score.strudel.js");
const RATE = 48000;

// ─── Finding the music in score.js ──────────────────────────────────────────

// Where `music: <string>` is in the source: the value's start and end, and
// the string it holds. Only a plain string (no ${…} in it) is converted.
function findMusic(source) {
  const re = /(^|[\s,{])music\s*:\s*/g;
  const found = [];
  for (let m; (m = re.exec(source)); ) {
    const at = m.index + m[0].length;
    const quote = source[at];
    if (!"`\"'".includes(quote)) continue;
    let i = at + 1;
    while (i < source.length && source[i] !== quote) {
      if (source[i] === "\\") i++;
      else if (quote === "`" && source[i] === "$" && source[i + 1] === "{") fail("The music has ${…} in it, so it can't be converted on its own. Convert it by hand.");
      i++;
    }
    if (i >= source.length) continue;
    const literal = source.slice(at, i + 1);
    const value = quote === "`" ? new Function(`return ${literal};`)() : JSON.parse(quote === "'" ? `"${literal.slice(1, -1).replace(/"/g, '\\"')}"` : literal);
    // The start of the line `music:` is on, for its indent and a comment.
    const lineStart = source.lastIndexOf("\n", m.index + m[1].length) + 1;
    found.push({ keyAt: m.index + m[1].length, lineStart, at, end: i + 1, value });
  }
  return found;
}

// ─── Reading what Strudel plays ─────────────────────────────────────────────

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const lcm = (a, b) => (a / gcd(a, b)) * b;
const q = ([n, d]) => n / d;

// Strudel's synth envelope, as numbers: what it fills in when a score
// leaves parts of attack, decay, sustain and release out.
function envelopeOf(v) {
  const { attack: a, decay: d, sustain: s, release: r } = v;
  if (a == null && d == null && s == null && r == null) return { attack: 0.001, decay: 0.05, sustain: 0.6, release: 0.01 };
  const sustain = s != null ? s : (a != null && d == null) || (a == null && d == null) ? 1 : 0;
  return {
    attack: Math.max(a ?? 0, 0.001),
    decay: Math.max(d ?? 0, 0.001),
    sustain: Math.min(Math.max(sustain, 0), 1),
    release: Math.max(r ?? 0, 0.01),
  };
}

const NAMES = ["c", "db", "d", "eb", "e", "f", "gb", "g", "ab", "a", "bb", "b"];
const LETTERS = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
function midiOf(v) {
  if (typeof v.note === "number") return v.note;
  if (typeof v.note === "string") {
    const m = /^([a-gA-G])((?:#|b|s)*)(-?\d+)?$/.exec(v.note);
    if (m) {
      let n = LETTERS[m[1].toLowerCase()] + (Number(m[3] ?? 3) + 1) * 12;
      for (const ch of m[2]) n += ch === "b" ? -1 : 1;
      return n;
    }
  }
  if (typeof v.freq === "number") return 69 + 12 * Math.log2(v.freq / 440);
  return null;
}
// Keeps the score's own spelling (eb3, not d#3) where it can.
function noteName(v, midi) {
  if (typeof v.note === "string" && /^[a-gA-G](#|b|s)*-?\d+$/.test(v.note) && midiOf(v) === midi) return v.note.toLowerCase().replace(/s/g, "#");
  if (Number.isInteger(midi)) return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  return String(Math.round(midi * 1000) / 1000);
}

// The controls the bed can play, and how each maps to a part's setting.
const SOUND = { sine: "sine", triangle: "triangle", square: "square", sawtooth: "sawtooth", saw: "sawtooth", tri: "triangle", sin: "sine", white: "white", pink: "pink", brown: "brown", supersaw: "sawtooth", pulse: "square" };
const PLAIN = { cutoff: "lowpass", resonance: "lowpassQ", hcutoff: "highpass", hresonance: "highpassQ", gain: "gain", room: "room", roomsize: "roomSize", size: "roomSize", delay: "delay", delaytime: "delayTime", delayfeedback: "delayFeedback", pan: "pan" };
const HANDLED = new Set(["note", "freq", "s", "attack", "decay", "sustain", "release", "velocity", ...Object.keys(PLAIN)]);
const MOVABLE = new Set(["lowpass", "highpass", "gain", "pan"]);

// The candidates for a slow wave: Strudel's signals as the bed's shapes.
const WAVES = [
  { shape: "sine", phase: 0 }, // sine
  { shape: "sine", phase: 0.25 }, // cosine
  { shape: "rise", phase: 0 }, // saw
  { shape: "fall", phase: 0 }, // isaw
  { shape: "triangle", phase: 0 },
  { shape: "triangle", phase: 0.5 }, // tri
  { shape: "square", phase: 0 },
];
function shapeAt(shape, x) {
  const f = x - Math.floor(x);
  if (shape === "rise") return f;
  if (shape === "fall") return 1 - f;
  if (shape === "triangle") return f < 0.5 ? 2 * f : 2 - 2 * f;
  if (shape === "square") return f < 0.5 ? 0 : 1;
  return 0.5 + 0.5 * Math.sin(2 * Math.PI * f);
}

// Finds a slow wave that gives exactly these values at these times (in
// cycles), as Strudel samples its signals once per note.
function fitWave(points) {
  const values = points.map((p) => p.v);
  const range = Math.max(...values) - Math.min(...values);
  const lengths = [];
  for (let b = 1; b <= 64; b++) lengths.push(b);
  lengths.unshift(0.25, 0.5);
  for (const bars of lengths) {
    for (const w of WAVES) {
      const xs = points.map((p) => shapeAt(w.shape, p.t / bars + w.phase));
      // values = from + (to - from) * x, by least squares.
      const n = xs.length;
      const mx = xs.reduce((a, b) => a + b, 0) / n;
      const my = values.reduce((a, b) => a + b, 0) / n;
      let sxx = 0;
      let sxy = 0;
      for (let i = 0; i < n; i++) {
        sxx += (xs[i] - mx) ** 2;
        sxy += (xs[i] - mx) * (values[i] - my);
      }
      if (sxx < 1e-12) continue;
      const slope = sxy / sxx;
      const from = my - slope * mx;
      const worst = Math.max(...xs.map((x, i) => Math.abs(from + slope * x - values[i])));
      if (worst <= range * 1e-6 + 1e-9) return { from, to: from + slope, shape: w.shape, bars, phase: w.phase };
    }
  }
  return null;
}

// The smallest number of cycles after which a part repeats exactly.
function periodOf(notes, cycles, constantKeys) {
  const same = (v) => (typeof v === "number" ? v.toPrecision(9) : v);
  const sig = (n, shift) => `${q(n.begin) - shift}|${q(n.end) - shift}|${midiOf(n.value)}|${constantKeys.map((k) => same(n.value[k])).join(",")}`;
  for (let p = 1; p <= 64; p++) {
    if (2 * p > cycles) break;
    let ok = true;
    for (let k = 1; ok && (k + 1) * p <= cycles; k++) {
      const a = notes.filter((n) => q(n.begin) >= 0 && q(n.begin) < p).map((n) => sig(n, 0)).sort();
      const b = notes.filter((n) => q(n.begin) >= k * p && q(n.begin) < (k + 1) * p).map((n) => sig(n, k * p)).sort();
      ok = a.length === b.length && a.every((s, i) => s === b[i]);
    }
    if (ok) return p;
  }
  return null;
}

const round = (v) => (Number.isInteger(v) ? v : Number(v.toPrecision(6)));

// One Strudel part as one or more bed parts (a part whose notes overlap in
// different ways is split into lanes).
function convertPart(notes, cycles, warnings, label) {
  if (!notes.length) return [];
  const keys = new Set();
  for (const n of notes) for (const k of Object.keys(n.value)) keys.add(k);
  for (const k of keys) if (!HANDLED.has(k)) warnings.add(`${label}: "${k}" has no match in the music bed and was left out.`);
  const sounds = new Set(notes.map((n) => n.value.s ?? "triangle"));
  if (sounds.size > 1) warnings.add(`${label}: plays several sounds (${[...sounds].join(", ")}); all are played as ${[...sounds][0]}.`);
  const s = [...sounds][0];
  if (!SOUND[s]) warnings.add(`${label}: the sound "${s}" has no match in the music bed; it's played as a triangle.`);
  else if (s === "supersaw" || s === "pulse") warnings.add(`${label}: "${s}" is played as a plain ${SOUND[s]}.`);

  // Settings that are the same on every note, and ones that move.
  const settings = {};
  const moving = [];
  const env = envelopeOf(notes[0].value);
  for (const n of notes.slice(1)) {
    const e = envelopeOf(n.value);
    if (Object.keys(e).some((k) => e[k] !== env[k])) {
      warnings.add(`${label}: its envelope changes from note to note; the first note's is used.`);
      break;
    }
  }
  const valueOf = (n, key) => {
    const v = n.value;
    if (key === "gain") return (v.gain ?? 0.8) * (v.velocity ?? 1);
    return v[key];
  };
  for (const key of keys) {
    if (!(key in PLAIN) && key !== "velocity") continue;
    const target = PLAIN[key] ?? "gain";
    if (target === "gain" && settings.gain !== undefined) continue;
    const k = key === "velocity" ? "gain" : key;
    const vals = notes.map((n) => valueOf(n, k));
    if (vals.some((v) => typeof v !== "number")) {
      warnings.add(`${label}: "${key}" isn't a plain number on every note and was left out.`);
      continue;
    }
    const same = vals.every((v) => Math.abs(v - vals[0]) < 1e-9);
    if (same) {
      settings[target] = vals[0];
      continue;
    }
    const wave = MOVABLE.has(target) ? fitWave(notes.map((n, i) => ({ t: q(n.begin), v: vals[i] }))) : null;
    if (wave) {
      // Strudel sets the value once per note, so the bed holds it too.
      settings[target] = { from: round(wave.from), to: round(wave.to), shape: wave.shape, bars: wave.bars, ...(wave.phase ? { phase: wave.phase } : {}), hold: true };
      moving.push(key);
    } else {
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      settings[target] = mean;
      warnings.add(`${label}: "${key}" changes in a way the bed can't follow; it's set to its average, ${round(mean)}.`);
    }
  }
  if (!("gain" in settings)) settings.gain = 0.8;
  if (typeof settings.pan === "number") settings.pan = settings.pan * 2 - 1;
  else if (settings.pan) settings.pan = { ...settings.pan, from: round(settings.pan.from * 2 - 1), to: round(settings.pan.to * 2 - 1) };
  if (settings.pan === 0) delete settings.pan;

  // How often the notes repeat (the slow waves loop on their own).
  const constantKeys = [...keys].filter((k) => !moving.includes(k) && k !== "note" && k !== "freq");
  const period = periodOf(notes, cycles, constantKeys);
  if (!period) warnings.add(`${label}: its notes don't repeat within 64 bars; the first ${Math.min(64, cycles)} bars are kept and loop.`);
  const bars = period ?? Math.min(64, cycles);
  const loop = notes.filter((n) => q(n.begin) < bars);
  for (const n of loop) {
    if (q(n.end) > bars + 1e-9) warnings.add(`${label}: a note rings past the end of its loop and is cut at the loop's end.`);
  }

  // Chords: notes that start and end together. Lanes: chords that never overlap.
  const chords = new Map();
  for (const n of loop) {
    const key = `${n.begin.join("/")}-${n.end.join("/")}`;
    if (!chords.has(key)) chords.set(key, { begin: n.begin, end: n.end, notes: [] });
    const midi = midiOf(n.value);
    if (midi === null) {
      if (SOUND[s] && ["white", "pink", "brown"].includes(SOUND[s])) chords.get(key).notes.push("x");
      else warnings.add(`${label}: a note with no pitch was left out.`);
      continue;
    }
    const name = noteName(n.value, midi);
    if (!chords.get(key).notes.includes(name)) chords.get(key).notes.push(name);
  }
  const lanes = [];
  for (const c of [...chords.values()].filter((c) => c.notes.length).sort((a, b) => q(a.begin) - q(b.begin))) {
    const lane = lanes.find((l) => q(l.at(-1).end) <= q(c.begin) + 1e-9);
    if (lane) lane.push(c);
    else lanes.push([c]);
  }

  const soundName = SOUND[s] ?? "triangle";
  return lanes.map((lane) => {
    const text = [];
    for (let b = 0; b < bars; b++) {
      // Steps in this bar: fine enough for every start and end in it.
      let den = 1;
      for (const c of lane) {
        for (const f of [c.begin, c.end]) {
          const t = q(f);
          if (t > b - 1e-9 && t < b + 1 + 1e-9) {
            const rel = [f[0] - b * f[1], f[1]];
            const g = gcd(Math.abs(rel[0]), rel[1]) || 1;
            den = lcm(den, rel[1] / g);
          }
        }
      }
      if (den > 64) {
        warnings.add(`${label}: bar ${b + 1} needs more than 64 steps; its timing is rounded to 64ths.`);
        den = 64;
      }
      const startsAt = new Map();
      for (const c of lane) {
        const t = q(c.begin);
        if (t > b - 1e-9 && t < b + 1 - 1e-9) startsAt.set(Math.min(den - 1, Math.round((t - b) * den)), c);
      }
      const steps = [];
      for (let i = 0; i < den; i++) {
        const t = b + i / den;
        const starts = startsAt.get(i);
        const holds = lane.find((c) => q(c.begin) < t - 1e-9 && q(c.end) > t + 1e-9);
        steps.push(starts ? starts.notes.join("+") : holds ? "_" : ".");
      }
      text.push(steps.join(" "));
    }
    const chordy = lane.some((c) => c.notes.length > 1);
    return { sound: soundName, notes: text, chordy, settings, env };
  });
}

// A name for each part, from what it plays.
function nameParts(parts) {
  const used = new Map();
  return parts.map((p) => {
    const pitches = p.notes.join(" ").split(/[\s|+]+/).map((t) => midiOf({ note: t })).filter((n) => n !== null);
    const top = Math.max(...pitches);
    const busy = p.notes.reduce((a, bar) => a + bar.split(" ").filter((s) => s !== "." && s !== "_").length, 0) / p.notes.length;
    let base = "notes";
    if (["white", "pink", "brown"].includes(p.sound)) base = "noise";
    else if (p.chordy) base = "pad";
    else if (top < 48) base = "bass";
    else if (busy >= 4) base = "arp";
    else if (top >= 72) base = "high";
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}${n}`;
  });
}

// ─── Writing the bed ────────────────────────────────────────────────────────

const ORDER = ["sound", "notes", "attack", "decay", "sustain", "release", "lowpass", "lowpassQ", "highpass", "highpassQ", "gain", "pan", "room", "roomSize", "delay", "delayTime", "delayFeedback"];

const lit = (v) => {
  if (typeof v === "number") return String(round(v));
  if (typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
  return `{ ${Object.entries(v).map(([k, x]) => `${k}: ${lit(x)}`).join(", ")} }`;
};

function writeBed({ bpm, parts, names }, indent) {
  const i1 = `${indent}  `;
  const i2 = `${indent}    `;
  const i3 = `${indent}      `;
  const lines = ["{", `${i1}bpm: ${round(bpm)},`, `${i1}parts: {`];
  parts.forEach((p, k) => {
    const fields = { sound: p.sound, notes: p.notes.join(" | "), ...p.env, ...p.settings };
    const entries = ORDER.filter((key) => fields[key] !== undefined).map((key) => `${key}: ${lit(fields[key])}`);
    // One line where it fits, else one setting a line.
    const one = `${i2}${names[k]}: { ${entries.join(", ")} },`;
    if (one.length <= 120) lines.push(one);
    else lines.push(`${i2}${names[k]}: {`, ...entries.map((e) => `${i3}${e},`), `${i2}},`);
  });
  lines.push(`${i1}},`, `${indent}}`);
  return lines.join("\n");
}

// ─── Comparing old and new ──────────────────────────────────────────────────

const run = (cmd, argv) =>
  new Promise((resolve, reject) => {
    const proc = spawn(cmd, argv, { stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    const err = [];
    proc.stdout.on("data", (c) => out.push(c));
    proc.stderr.on("data", (c) => err.push(c));
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve({ stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString() }) : reject(new Error(Buffer.concat(err).toString().slice(-500)))));
  });

async function lufsOf(pcm, work, name) {
  const file = path.join(work, `${name}.f32`);
  await writeFile(file, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-f", "f32le", "-ar", String(RATE), "-ac", "2", "-i", file, "-af", "ebur128", "-f", "null", "-"]);
  const v = Number(/I:\s+(-?[\d.]+) LUFS/.exec(stderr.slice(stderr.lastIndexOf("Summary:")))?.[1]);
  return Number.isFinite(v) ? v : null;
}

// The level of each octave-ish band, in dB against the loudest band, from
// a ladder of one-pole low-passes on the mono signal.
const BANDS = [120, 250, 500, 1000, 2000, 4000];
const BAND_NAMES = ["under 120 Hz", "120-250", "250-500", "500-1k", "1-2k", "2-4k", "over 4k"];
function balanceOf(pcm) {
  const coef = BANDS.map((f) => 1 - Math.exp((-2 * Math.PI * f) / RATE));
  const y = BANDS.map(() => 0);
  const e = new Array(BANDS.length + 1).fill(0);
  for (let i = 0; i < pcm.length; i += 2) {
    const x = (pcm[i] + pcm[i + 1]) / 2;
    let below = 0;
    for (let k = 0; k < BANDS.length; k++) {
      y[k] += coef[k] * (x - y[k]);
      e[k] += (y[k] - below) ** 2;
      below = y[k];
    }
    e[BANDS.length] += (x - below) ** 2;
  }
  const top = Math.max(...e) || 1;
  return e.map((v) => (v > 0 ? Math.round(10 * Math.log10(v / top)) : -99));
}

// Onsets, even quiet ones under a held pad: every 10 ms, how much each band
// grew (in dB) since the frame before, summed; a peak in that well above
// its usual level is a sound starting.
function onsetsOf(pcm) {
  const hop = RATE / 100;
  const coef = BANDS.map((f) => 1 - Math.exp((-2 * Math.PI * f) / RATE));
  const y = BANDS.map(() => 0);
  const frames = [];
  let e = new Array(BANDS.length + 1).fill(0);
  for (let i = 0, n = 0; i < pcm.length; i += 2) {
    const x = (pcm[i] + pcm[i + 1]) / 2;
    let below = 0;
    for (let k = 0; k < BANDS.length; k++) {
      y[k] += coef[k] * (x - y[k]);
      e[k] += (y[k] - below) ** 2;
      below = y[k];
    }
    e[BANDS.length] += (x - below) ** 2;
    if (++n === hop) {
      frames.push(e.map((v) => 10 * Math.log10(v / hop + 1e-12)));
      e = new Array(BANDS.length + 1).fill(0);
      n = 0;
    }
  }
  const flux = frames.map((f, w) => (w ? f.reduce((s, v, k) => s + Math.max(0, v - Math.max(frames[w - 1][k], -90)), 0) : 0));
  const sorted = [...flux].sort((a, b) => a - b);
  const typical = sorted[Math.floor(sorted.length / 2)];
  const out = [];
  for (let w = 1; w < flux.length - 1; w++) {
    if (flux[w] > typical + 12 && flux[w] >= flux[w - 1] && flux[w] > flux[w + 1] && (!out.length || w / 100 - out.at(-1) >= 0.08)) out.push(w / 100);
  }
  return out;
}

async function compare(oldSource, newSource) {
  const film = JSON.parse(await readFile(path.join(dir, "film.json"), "utf8"));
  const engine = await openEngine();
  const work = await mkdtemp(path.join(tmpdir(), "convert-score-"));
  try {
    const renderMusic = async (source) => {
      // The music on its own: no effects, no fade, so the two compare like for like.
      const r = await engine.page.evaluate((input) => window.__sound.render(input), {
        source,
        film: { duration: film.duration, fps: film.fps, marks: [], params: Object.fromEntries((film.params ?? []).map((p) => [p.key, p.value])), speech: [], graphics: [] },
        sampleRate: RATE,
        musicOnly: true,
      });
      return { pcm: new Float32Array(new Uint8Array(Buffer.from(r.music, "base64")).buffer), report: r.report.music };
    };
    const a = await renderMusic(oldSource);
    const b = await renderMusic(newSource);
    const start = a.report?.start ?? 0;
    const bar = 1 / (a.report?.cps || 0.5);
    const [la, lb] = [await lufsOf(a.pcm, work, "old"), await lufsOf(b.pcm, work, "new")];
    const [ba, bb] = [balanceOf(a.pcm), balanceOf(b.pcm)];
    const [oa, ob] = [onsetsOf(a.pcm), onsetsOf(b.pcm)];
    const bars = Math.ceil((film.duration - start) / bar);
    const perBar = (on) => Array.from({ length: bars }, (_, k) => on.filter((t) => t >= start + k * bar - 0.02 && t < start + (k + 1) * bar - 0.02).length);
    const [pa, pb] = [perBar(oa), perBar(ob)];
    let matched = 0;
    for (const t of oa) if (ob.some((u) => Math.abs(u - t) <= 0.02)) matched++;
    const files = { old: path.join(work, "old.wav"), new: path.join(work, "new.wav") };
    const wav = async (pcm, file) => {
      const raw = `${file}.f32`;
      await writeFile(raw, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
      await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "f32le", "-ar", String(RATE), "-ac", "2", "-i", raw, "-c:a", "pcm_f32le", file]);
    };
    await wav(a.pcm, files.old);
    await wav(b.pcm, files.new);
    return {
      lufs: [la, lb],
      balance: [ba, bb],
      onsets: [oa.length, ob.length, matched],
      perBar: [pa, pb],
      start,
      bar,
      files,
      work,
    };
  } catch (e) {
    await rm(work, { recursive: true, force: true });
    throw e;
  } finally {
    await engine.close();
  }
}

function printComparison(c) {
  const f = (v) => (v === null ? "silent" : `${v.toFixed(1)} LUFS`);
  console.log(`\nOld music (Strudel) against the new music bed, each on its own from ${c.start.toFixed(2)} s, ${c.bar.toFixed(3)} s a bar:`);
  console.log(`  Loudness: ${f(c.lufs[0])} and ${f(c.lufs[1])}${c.lufs[0] !== null && c.lufs[1] !== null ? ` (${(c.lufs[1] - c.lufs[0]).toFixed(1)} dB apart)` : ""}`);
  console.log(`  Bands (dB below the loudest): ${BAND_NAMES.map((n, k) => `${n} ${c.balance[0][k]}/${c.balance[1][k]}`).join(", ")}`);
  console.log(`  Onsets: ${c.onsets[0]} and ${c.onsets[1]}; ${c.onsets[2]} of the old ones have a new one within 20 ms`);
  console.log(`  Onsets per bar, old: ${c.perBar[0].join(" ")}`);
  console.log(`  Onsets per bar, new: ${c.perBar[1].join(" ")}`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(scoreFile)) fail(`Film ${id} has no sound/score.js.`);
  if (!hasStrudel()) {
    fail("Converting reads the old Strudel code, so it needs the in-house edition with Strudel installed: npm ci --prefix studio/sound/strudel");
  }
  const source = await readFile(scoreFile, "utf8");

  if (compareOnly) {
    if (!existsSync(backupFile)) fail("This film hasn't been converted (there's no sound/score.strudel.js to compare with).");
    const c = await compare(await readFile(backupFile, "utf8"), source);
    printComparison(c);
    console.log(`  Kept for listening: ${c.files.old} and ${c.files.new}`);
    return;
  }

  const found = findMusic(source);
  if (!found.length) fail("This score's music isn't Strudel code (a string), so there's nothing to convert.");
  if (found.length > 1) fail("This score has more than one `music:` string; convert it by hand.");
  const m = found[0];
  if (existsSync(backupFile) && !dry) fail("sound/score.strudel.js already exists, so this film was converted before. Restore it first if you want to convert again.");

  const engine = await openEngine();
  let described;
  const CYCLES = 128;
  try {
    described = await engine.page.evaluate(([code, cycles]) => window.__strudelMusic.describe(code, cycles), [m.value, CYCLES]);
  } finally {
    await engine.close();
  }

  const warnings = new Set();
  const groups = described.parts ?? [described.all];
  if (!described.parts) warnings.add("The music uses all() or each(); its parts are converted together.");
  const parts = groups.flatMap((notes, i) => convertPart(notes, CYCLES, warnings, `part ${i + 1}`));
  if (!parts.length) fail("Strudel plays no notes for this music, so there's nothing to convert.");
  const bpm = described.cps * 60 * 4;
  const names = nameParts(parts);
  const indent = /^\s*/.exec(source.slice(m.lineStart))[0];
  const bed = writeBed({ bpm, parts, names }, indent);

  const note = `${indent}// Music: the studio's music bed (studio/sound/bed.js), converted from\n${indent}// Strudel by scripts/studio/convert-score.mjs; the original is in\n${indent}// score.strudel.js.\n`;
  const next = `${source.slice(0, m.lineStart)}${note}${source.slice(m.lineStart, m.at)}${bed}${source.slice(m.end)}`;

  if (dry) {
    console.log(`music: ${bed}`);
  } else {
    await copyFile(scoreFile, backupFile);
    await writeFile(scoreFile, next);
    console.log(`Converted the music of film ${id} to the music bed: ${parts.length} part${parts.length === 1 ? "" : "s"} (${names.join(", ")}) at ${round(bpm)} BPM.`);
    console.log(`The Strudel original is in films/${id}/sound/score.strudel.js. Render the sound again to hear it: node scripts/studio/sound.mjs ${id}`);
  }
  for (const w of warnings) console.log(`  Note: ${w}`);

  const c = await compare(source, next);
  printComparison(c);
  await rm(c.work, { recursive: true, force: true });
}

try {
  await main();
} catch (e) {
  fail(`The score could not be converted: ${e.message.split("\n").slice(0, 6).join("\n")}`);
}
