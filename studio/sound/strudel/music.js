// In-house only. Plays the music of films scored in Strudel, before the
// studio had its own music bed (studio/sound/bed.js), so those films keep
// sounding exactly as they did. Strudel is AGPL-3.0: the product edition
// never installs these packages (studio/sound/strudel/package.json) and
// never bundles this file (see scripts/studio/sound-engine.mjs).
//
// It registers itself on the page as globalThis.__strudelMusic:
//   render(code, start, duration, sampleRate, { settled })
//       the music on its own, from `start` to the film's end, as before
//   describe(code, cycles)
//       every note the code plays in its first `cycles` cycles, grouped by
//       part, for scripts/studio/convert-score.mjs

import * as core from "@strudel/core";
import * as mini from "@strudel/mini";
import * as tonal from "@strudel/tonal";
import { transpiler } from "@strudel/transpiler";
import * as webaudio from "@strudel/webaudio";

const { evaluate, evalScope, Pattern, silence, stack } = core;
const { superdough, setAudioContext, setSuperdoughAudioController, initAudio, registerSynthSounds, registerZZFXSounds, resetGlobalEffects } =
  webaudio;

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
  const scope = {
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
  };
  // Describing only: remember what a top-level stack(...) was made of, so
  // each of its lines can become its own part.
  if (state.stacks) {
    scope.stack = (...parts) => {
      const made = stack(...parts);
      state.stacks.push({ made, parts });
      return made;
    };
  }
  return evalScope(scope);
}

async function strudelPattern(code, describing = false) {
  if (!scoped) {
    await evalScope(core, mini, tonal, webaudio);
    scoped = true;
  }
  const state = { patterns: {}, anonymous: 0, cps: 0.5, all: [], each: null, stacks: describing ? [] : null };
  await strudelScope(state);
  let { pattern } = await evaluate(code, transpiler);
  if (describing) await evalScope({ stack }); // as it was
  const keyed = Object.values(state.patterns);
  if (keyed.length) pattern = stack(...(state.each ? keyed.map((x) => state.each(x)) : keyed));
  for (const f of state.all) pattern = f(pattern);
  if (!pattern || typeof pattern.queryArc !== "function") pattern = silence;
  const cps = state.cps > 0 && Number.isFinite(state.cps) ? state.cps : 0.5;
  let parts = null;
  if (describing) {
    if (keyed.length) parts = state.each ? keyed.map((x) => state.each(x)) : keyed;
    else parts = state.stacks.find((s) => s.made === pattern)?.parts ?? [pattern];
    if (state.all.length) parts = null; // all() reshapes the whole; can't split it
  }
  return { pattern, cps, parts };
}

// The music on its own, from `start` to the film's end.
async function render(code, start, duration, sampleRate, { settled }) {
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

// Every note in the first `cycles` cycles, as plain data: times as exact
// fractions of a cycle, and each note's values as Strudel would play them.
async function describe(code, cycles) {
  const { pattern, cps, parts } = await strudelPattern(code, true);
  const frac = (f) => [Number(f.n) * (f.s < 0 ? -1 : 1), Number(f.d)];
  const notesOf = (p) =>
    p
      .queryArc(0, cycles, { _cps: cps })
      .filter((h) => h.hasOnset())
      .map((h) => {
        h.ensureObjectValue();
        return { begin: frac(h.whole.begin), end: frac(h.whole.end), value: { ...h.value } };
      });
  return {
    cps,
    parts: parts ? parts.map(notesOf) : null,
    all: notesOf(pattern),
  };
}

globalThis.__strudelMusic = { render, describe };
