// The sound engine that runs inside headless Chrome (bundled by
// scripts/studio/sound.mjs with esbuild into one script): it plays a film's
// score into offline audio contexts, never to speakers, so a 20 second film
// renders in a moment and the same score always gives the same sound.
//
//   music    Strudel code (superdough synths, no samples: nothing is
//            fetched), queried cycle by cycle and played into an
//            OfflineAudioContext the length of the film.
//   effects  Tone.js, drawn inside Tone.Offline at exact film times.
//
// Each is brought to its gain (the music faded out at the end, and ducked
// under speech) and handed back as its own 32 bit float stereo stem; the
// two added together are the mix. Loudness is set afterwards, outside the
// page, which also keeps the stems so the person's volume edits can be
// mixed in again without playing the score.
//
// Strudel is AGPL-3.0 (in-house use only); Tone.js is MIT.

import * as core from "@strudel/core";
import * as mini from "@strudel/mini";
import * as tonal from "@strudel/tonal";
import { transpiler } from "@strudel/transpiler";
import * as webaudio from "@strudel/webaudio";
import * as Tone from "tone";

const { evaluate, evalScope, Pattern, silence, stack } = core;
const { superdough, setAudioContext, setSuperdoughAudioController, initAudio, registerSynthSounds, registerZZFXSounds, resetGlobalEffects } =
  webaudio;

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

let scoped = false;

// What the Strudel REPL adds on top of the core: `$:` lines, setcps and
// setcpm, all() and each(). Gathered here instead of played live.
function strudelScope(state) {
  Pattern.prototype.p = function (id) {
    if (typeof id === "string" && (id.startsWith("_") || id.endsWith("_"))) return silence;
    const key = typeof id === "string" && id.includes("$") ? `${id}${state.anonymous++}` : String(id);
    state.patterns[key] = this;
    return this;
  };
  Pattern.prototype.q = () => silence;
  for (let i = 1; i < 10; ++i) {
    Object.defineProperty(Pattern.prototype, `d${i}`, { get() { return this.p(i); }, configurable: true });
    Object.defineProperty(Pattern.prototype, `p${i}`, { get() { return this.p(i); }, configurable: true });
  }
  const setcps = (v) => {
    state.cps = Number(v);
    return silence;
  };
  const setcpm = (v) => setcps(Number(v) / 60);
  return evalScope({
    setcps,
    setCps: setcps,
    setcpm,
    setCpm: setcpm,
    all: (f) => {
      state.all.push(f);
      return silence;
    },
    each: (f) => {
      state.each = f;
      return silence;
    },
    hush: () => silence,
  });
}

async function strudelPattern(code) {
  if (!scoped) {
    await evalScope(core, mini, tonal, webaudio);
    scoped = true;
  }
  const state = { patterns: {}, anonymous: 0, cps: 0.5, all: [], each: null };
  await strudelScope(state);
  let { pattern } = await evaluate(code, transpiler);
  const keyed = Object.values(state.patterns);
  if (keyed.length) pattern = stack(...(state.each ? keyed.map((x) => state.each(x)) : keyed));
  for (const f of state.all) pattern = f(pattern);
  if (!pattern || typeof pattern.queryArc !== "function") pattern = silence;
  return { pattern, cps: state.cps > 0 && Number.isFinite(state.cps) ? state.cps : 0.5 };
}

// The music on its own, from `start` to the film's end.
async function renderMusic(code, start, duration, sampleRate) {
  const { pattern, cps } = await strudelPattern(code);
  const length = Math.max(1, Math.round(duration * sampleRate));
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  setAudioContext(ctx);
  setSuperdoughAudioController(null); // made afresh for this context
  await initAudio({ maxPolyphony: 128, multiChannelOrbits: false });
  registerSynthSounds();
  registerZZFXSounds();
  const span = Math.max(0, duration - start);
  // Ascending onsets, as Strudel's own renderer does (cut groups depend on it).
  const haps = pattern
    .queryArc(0, span * cps, { _cps: cps })
    .filter((h) => h.hasOnset())
    .sort((a, b) => a.whole.begin.valueOf() - b.whole.begin.valueOf());
  let played = 0;
  for (const hap of haps) {
    const t = start + hap.whole.begin.valueOf() / cps;
    if (t >= duration) continue;
    hap.ensureObjectValue();
    try {
      await superdough(hap.value, t, hap.duration / cps, cps, t);
      played++;
    } catch (err) {
      console.warn("[sound] a note could not be played:", err?.message ?? err);
    }
  }
  await settled();
  const buffer = await ctx.startRendering();
  setAudioContext(null);
  setSuperdoughAudioController(null);
  resetGlobalEffects();
  return { buffer, cps, notes: played };
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
window.__sound = {
  async render({ source, film, sampleRate = 48000 }) {
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
    if (typeof score.music === "string" && score.music.trim()) {
      const start = clamp(score.musicStart, 0, duration, 0);
      const r = await renderMusic(score.music, start, duration, sampleRate);
      music = r.buffer;
      report.music = { cps: r.cps, notes: r.notes, start };
    }
    let effects = null;
    if (typeof score.effects === "function") {
      seed = 2; // effects have their own stream, so adding music never changes them
      effects = await renderEffects(score.effects, duration, sampleRate, kitBase);
      report.effects = true;
    }
    const settings = {
      duration,
      sampleRate,
      musicGain: clamp(score.musicGain, 0, 1, 0.6),
      effectsGain: clamp(score.effectsGain, 0, 1, 0.8),
      fadeOut: clamp(score.musicFadeOut, 0, duration, Math.min(1, duration)),
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
