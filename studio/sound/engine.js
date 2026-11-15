// The sound engine that runs inside headless Chrome (bundled by
// scripts/studio/sound-engine.mjs with esbuild into one script): it plays a
// film's score into offline audio contexts, never to speakers, so a 20
// second film renders in a moment and the same score always gives the same
// sound.
//
//   music    the studio's music bed (bed.js): an object of parts, played
//            with Tone.js; or a function that draws music with Tone itself.
//            In-house only, a string of Strudel code from before the bed,
//            played by strudel/music.js when that's bundled in.
//   effects  Tone.js, drawn inside Tone.Offline at exact film times.
//
// Each is brought to its gain (the music faded out at the end, and ducked
// under speech) and handed back as its own 32 bit float stereo stem; the
// two added together are the mix. Loudness is set afterwards, outside the
// page, which also keeps the stems so the person's volume edits can be
// mixed in again without playing the score.
//
// This file and bed.js use only Tone.js (MIT) and the browser. Strudel
// (AGPL-3.0) is never imported here: the in-house build adds it through
// inhouse.js, the product build leaves it out.

import * as Tone from "tone";
import { playBed } from "./bed.js";

// Every random number in the page comes from one seeded generator, reset at
// the start of each render, so the noise in a whoosh is the same noise
// every time.
let seed = 1;
const random = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
Math.random = random;

// Strudel builds each reverb's impulse in a small offline render of its
// own and hands it to the reverb when that finishes, which in a live REPL
// is a moment later. Offline, the film would render while some impulses
// are still missing, differently each time. So every offline render is
// tracked, and the film waits for the impulses before it plays.
const pending = new Set();
const startRendering = OfflineAudioContext.prototype.startRendering;
OfflineAudioContext.prototype.startRendering = function () {
  const p = startRendering.call(this);
  pending.add(p);
  p.finally(() => pending.delete(p)).catch(() => {});
  return p;
};
async function settled() {
  while (pending.size) {
    await Promise.allSettled([...pending]);
    await new Promise((r) => setTimeout(r, 0)); // their callbacks run
  }
}

// Strudel music from before the bed (in-house builds only).
async function renderStrudel(code, start, duration, sampleRate) {
  const strudel = globalThis.__strudelMusic;
  if (!strudel) {
    throw new Error(
      "This score's music is Strudel code, which this build of the studio doesn't play. Write the music as a music bed instead (the saymo-sound-design skill shows how); in-house, node scripts/studio/convert-score.mjs <film-id> converts it.",
    );
  }
  const r = await strudel.render(code, start, duration, sampleRate, { settled });
  return { ...r, engine: "strudel" };
}

// The music bed (an object of parts), or music drawn with Tone by the
// score's own function, from `start` to the film's end.
async function renderToneMusic(music, start, duration, sampleRate, kitBase) {
  let report = null;
  const buffer = await Tone.Offline(
    async (context) => {
      const at = (s) => Math.max(0, Number(s) || 0);
      if (typeof music === "function") {
        await music({ ...kitBase, Tone, context, at, start });
        report = { notes: null };
      } else {
        report = playBed(Tone, music, { start, duration, at });
      }
    },
    duration,
    2,
    sampleRate,
  );
  return { buffer: buffer.get(), ...report, engine: typeof music === "function" ? "tone" : "bed" };
}

// The effects on their own, drawn with Tone at exact film times.
async function renderEffects(effects, duration, sampleRate, kitBase) {
  const out = await Tone.Offline(
    async (context) => {
      const kit = { ...kitBase, Tone, context, at: (s) => Math.max(0, Number(s) || 0) };
      await effects(kit);
    },
    duration,
    2,
    sampleRate,
  );
  return out.get();
}

// Both, mixed: music faded out over its last seconds, each at its gain.
// In a video film the music dips to `duck` of itself while someone speaks
// (eased over 0.25 s either side), so words stay clear.
async function mix({ music, effects, duration, sampleRate, musicGain, effectsGain, fadeOut, speech, duck }) {
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.round(duration * sampleRate)), sampleRate);
  const add = (buffer, gain, fade, spans) => {
    if (!buffer) return;
    const src = new AudioBufferSourceNode(ctx, { buffer });
    const g = new GainNode(ctx, { gain });
    const ease = 0.25;
    if (spans?.length && duck < 1) {
      for (const s of spans) {
        const a = Math.max(0, s.start - ease);
        const b = Math.min(duration, s.end + ease);
        g.gain.setValueAtTime(gain, a);
        g.gain.linearRampToValueAtTime(gain * duck, Math.min(b, s.start));
        g.gain.setValueAtTime(gain * duck, Math.max(a, s.end));
        g.gain.linearRampToValueAtTime(gain, b);
      }
    }
    if (fade > 0) {
      const from = Math.max(0, duration - fade);
      // From wherever the level is then (ducked or not) down to silence.
      g.gain.cancelAndHoldAtTime(from);
      g.gain.linearRampToValueAtTime(0, duration);
    }
    src.connect(g).connect(ctx.destination);
    src.start(0);
  };
  add(music, musicGain, fadeOut, speech);
  add(effects, effectsGain, 0, null);
  return ctx.startRendering();
}

// Speech spans, merged where the gaps are short, so the music doesn't pump
// between words.
function mergeSpans(spans, gap = 0.6) {
  const out = [];
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last && s.start - last.end <= gap) last.end = Math.max(last.end, s.end);
    else out.push({ start: s.start, end: s.end });
  }
  return out;
}

const clamp = (v, lo, hi, d) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

// The page's one entry: render a score module (its source text) for a film.
// `musicOnly` (for comparing two versions of the music) plays the music at
// full level with no fade and no effects.
window.__sound = {
  async render({ source, film, sampleRate = 48000, musicOnly = false }) {
    seed = 1;
    Math.random = random;
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    let score;
    try {
      score = (await import(/* webpackIgnore: true */ url)).default;
    } finally {
      URL.revokeObjectURL(url);
    }
    if (!score || typeof score !== "object") throw new Error("score.js must export default { music, effects }.");
    const duration = film.duration;
    const speech = mergeSpans(film.speech ?? []);
    const kitBase = {
      duration,
      marks: film.marks ?? [],
      params: film.params ?? {},
      fps: film.fps,
      graphics: film.graphics ?? [],
      speech,
    };
    const report = { music: null, effects: false };
    let music = null;
    const hasMusic =
      (typeof score.music === "string" && score.music.trim()) ||
      typeof score.music === "function" ||
      (score.music && typeof score.music === "object");
    if (hasMusic) {
      const start = clamp(score.musicStart, 0, duration, 0);
      const r =
        typeof score.music === "string"
          ? await renderStrudel(score.music, start, duration, sampleRate)
          : await renderToneMusic(score.music, start, duration, sampleRate, kitBase);
      music = r.buffer;
      report.music = { engine: r.engine, cps: r.cps ?? null, bpm: r.bpm ?? null, notes: r.notes, start };
    }
    let effects = null;
    if (typeof score.effects === "function" && !musicOnly) {
      seed = 2; // effects have their own stream, so adding music never changes them
      effects = await renderEffects(score.effects, duration, sampleRate, kitBase);
      report.effects = true;
    }
    const settings = {
      duration,
      sampleRate,
      musicGain: musicOnly ? 1 : clamp(score.musicGain, 0, 1, 0.6),
      effectsGain: clamp(score.effectsGain, 0, 1, 0.8),
      fadeOut: musicOnly ? 0 : clamp(score.musicFadeOut, 0, duration, Math.min(1, duration)),
      speech,
      duck: clamp(score.duck, 0, 1, 0.3),
    };
    // One stem each, mixed the same way as both at once: a mix of the two
    // is the sum of these, sample for sample.
    const musicStem = await mix({ ...settings, music, effects: null });
    const effectsStem = await mix({ ...settings, music: null, effects });
    // Interleaved 32 bit float, as base64, for the page's way out.
    const out = (buffer) => {
      const l = buffer.getChannelData(0);
      const r = buffer.getChannelData(1);
      const pcm = new Float32Array(l.length * 2);
      for (let i = 0; i < l.length; i++) {
        pcm[2 * i] = l[i];
        pcm[2 * i + 1] = r[i];
      }
      const bytes = new Uint8Array(pcm.buffer);
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    };
    return { music: out(musicStem), effects: out(effectsStem), frames: musicStem.length, report };
  },
};
