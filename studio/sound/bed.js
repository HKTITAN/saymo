// The studio's music bed: a small, declarative way to write looping music,
// played with Tone.js (MIT) and plain Web Audio. Written for the studio
// from scratch; it shares no code with Strudel.
//
// A score's `music` is an object:
//
//   music: {
//     bpm: 104,              // beats a minute
//     beatsPerBar: 4,        // default 4
//     parts: {
//       bass: { sound: "sine", notes: "c2 | c2 | ab1 | bb1", release: 0.4, lowpass: 160, gain: 0.42 },
//       pad:  { sound: "sawtooth", notes: "c3+eb3+g3 | ab2+c3+eb3", attack: 0.5,
//               lowpass: { from: 560, to: 1500, shape: "rise", bars: 9 }, room: 0.45 },
//     },
//   }
//
// `notes` is one loop of the part: bars split by "|", each bar split into
// equal steps by spaces. A step is a note ("c2", "eb3", "f#4", or a MIDI
// number), notes joined by "+" for a chord, "." for a rest, "_" to hold
// the step before for one more step (also across a bar line), or "x" for
// a hit with no pitch (noise parts). Each part loops on its own length.
//
// Every note is its own voice: a source, a linear ADSR envelope held for
// the note's length, an optional high-pass and low-pass filter, a gain and
// a pan, into the part's bus. The bus goes to the output and, if asked,
// through an echo (delay) and a room (reverb) too. Filters, gain and pan
// can move with a slow wave measured in bars: { from, to, shape, bars,
// phase }, gliding through each note, or with `hold: true` fixed for each
// note at the wave's value when it starts.

export const SOUNDS = ["sine", "triangle", "square", "sawtooth", "white", "pink", "brown"];
export const SHAPES = ["sine", "rise", "fall", "triangle", "square"];
const OSCILLATORS = new Set(["sine", "triangle", "square", "sawtooth"]);

// Each voice is turned down by this much, so a gain of 1 is one strong
// voice and a chord of four at 0.5 stays well clear of clipping.
const HEADROOM = 0.3;

export const PART_DEFAULTS = Object.freeze({
  sound: "sine",
  attack: 0.01,
  decay: 0,
  sustain: 1,
  release: 0.1,
  gain: 0.5,
  lowpassQ: 1,
  highpassQ: 1,
  pan: 0,
  room: 0,
  roomSize: 2,
  delay: 0,
  delayFeedback: 0.5,
});

const KNOWN = new Set([
  "sound", "notes", "attack", "decay", "sustain", "release", "gain", "lowpass", "lowpassQ", "highpass", "highpassQ",
  "pan", "room", "roomSize", "delay", "delayTime", "delayFeedback", "from", "to",
]);
// Names people often reach for, and the bed's own word for each.
const ALIASES = {
  s: "sound", synth: "sound", wave: "sound", note: "notes", lpf: "lowpass", cutoff: "lowpass", hpf: "highpass",
  lpq: "lowpassQ", resonance: "lowpassQ", q: "lowpassQ", hpq: "highpassQ", volume: "gain", size: "roomSize",
  roomsize: "roomSize", reverb: "room", echo: "delay", delaytime: "delayTime", delayfeedback: "delayFeedback",
  feedback: "delayFeedback", start: "from", end: "to",
};

// ─── Reading the score ──────────────────────────────────────────────────────

const LETTERS = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

// "c2" → 36, "eb3" → 51, "f#4" → 66, "bb1" → 34. Middle C is c4 (60).
export function noteNumber(token) {
  if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
  const m = /^([a-gA-G])((?:#|b|s)*)(-?\d+)$/.exec(token);
  if (!m) return null;
  let n = LETTERS[m[1].toLowerCase()] + (Number(m[3]) + 1) * 12;
  for (const ch of m[2]) n += ch === "b" ? -1 : 1;
  return n;
}

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

// One loop of a part as events: { at, length } in bars from the loop's
// start, and the notes (MIDI numbers; null for an unpitched hit).
export function readNotes(text, where = "notes") {
  if (typeof text !== "string" || !text.trim()) throw new Error(`${where} is empty.`);
  const bars = text.split("|").map((b) => b.trim().split(/\s+/).filter(Boolean));
  if (bars.some((b) => !b.length)) throw new Error(`${where} has an empty bar ("| |").`);
  const events = [];
  let last = null;
  bars.forEach((steps, bar) => {
    const size = 1 / steps.length;
    steps.forEach((step, i) => {
      const at = bar + i * size;
      if (step === ".") {
        last = null;
      } else if (step === "_") {
        if (!last) throw new Error(`${where}: "_" holds the step before it, but there's nothing to hold at bar ${bar + 1}.`);
        last.length += size;
      } else {
        const notes = step.split("+").map((t) => {
          if (t === "x") return null;
          const n = noteNumber(t);
          if (n === null) throw new Error(`${where}: "${t}" isn't a note. Write notes like c2, eb3 or f#4.`);
          return n;
        });
        last = { at, length: size, notes };
        events.push(last);
      }
    });
  });
  return { events, bars: bars.length };
}

const num = (v, where, lo = -Infinity, hi = Infinity) => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${where} must be a number.`);
  return Math.min(hi, Math.max(lo, v));
};

// A value that is a number, or a slow wave between two numbers.
function readMoving(v, where, lo, hi) {
  if (typeof v === "number") return num(v, where, lo, hi);
  if (!v || typeof v !== "object") throw new Error(`${where} must be a number or a wave like { from: 400, to: 1200, shape: "sine", bars: 8 }.`);
  const shape = v.shape ?? "sine";
  if (!SHAPES.includes(shape)) throw new Error(`${where}.shape must be one of ${SHAPES.join(", ")}.`);
  return {
    from: num(v.from, `${where}.from`, lo, hi),
    to: num(v.to, `${where}.to`, lo, hi),
    shape,
    bars: num(v.bars ?? 1, `${where}.bars`, 1 / 64, 1024),
    phase: num(v.phase ?? 0, `${where}.phase`, 0, 1),
    hold: v.hold === true,
  };
}

// The score's `music` checked and filled in with defaults. Throws a plain
// sentence naming the part and setting when something is wrong.
export function readBed(music) {
  if (!music || typeof music !== "object" || Array.isArray(music)) throw new Error("music must be an object: { bpm, parts }.");
  const bpm = num(music.bpm, "music.bpm", 1, 1000);
  const beatsPerBar = num(music.beatsPerBar ?? 4, "music.beatsPerBar", 1, 64);
  if (!music.parts || typeof music.parts !== "object") throw new Error("music.parts must be an object of named parts.");
  const parts = [];
  for (const [name, raw] of Object.entries(music.parts)) {
    const where = `music.parts.${name}`;
    if (!raw) continue; // a part switched off with null or false
    if (typeof raw !== "object") throw new Error(`${where} must be an object.`);
    for (const key of Object.keys(raw)) {
      if (KNOWN.has(key)) continue;
      const meant = ALIASES[key.toLowerCase()];
      throw new Error(`${where} has a setting the music bed doesn't know: "${key}".${meant ? ` Did you mean "${meant}"?` : ""}`);
    }
    const p = { ...PART_DEFAULTS, ...raw, name };
    if (!SOUNDS.includes(p.sound)) throw new Error(`${where}.sound must be one of ${SOUNDS.join(", ")}.`);
    const loop = readNotes(p.notes, `${where}.notes`);
    if (OSCILLATORS.has(p.sound) && loop.events.some((e) => e.notes.includes(null))) {
      throw new Error(`${where}: "x" is for noise parts; a ${p.sound} needs notes.`);
    }
    parts.push({
      name,
      sound: p.sound,
      loop,
      attack: num(p.attack, `${where}.attack`, 0, 60),
      decay: num(p.decay, `${where}.decay`, 0, 60),
      sustain: num(p.sustain, `${where}.sustain`, 0, 1),
      release: num(p.release, `${where}.release`, 0, 60),
      gain: readMoving(p.gain, `${where}.gain`, 0, 4),
      lowpass: p.lowpass === undefined ? null : readMoving(p.lowpass, `${where}.lowpass`, 10, 22000),
      lowpassQ: num(p.lowpassQ, `${where}.lowpassQ`, -30, 40),
      highpass: p.highpass === undefined ? null : readMoving(p.highpass, `${where}.highpass`, 10, 22000),
      highpassQ: num(p.highpassQ, `${where}.highpassQ`, -30, 40),
      pan: readMoving(p.pan, `${where}.pan`, -1, 1),
      room: num(p.room, `${where}.room`, 0, 1),
      roomSize: num(p.roomSize, `${where}.roomSize`, 0.1, 10),
      delay: num(p.delay, `${where}.delay`, 0, 1),
      delayTime: p.delayTime === undefined ? null : num(p.delayTime, `${where}.delayTime`, 0.001, 4),
      delayFeedback: num(p.delayFeedback, `${where}.delayFeedback`, 0, 0.95),
      from: p.from === undefined ? 0 : num(p.from, `${where}.from`, 0),
      to: p.to === undefined ? Infinity : num(p.to, `${where}.to`, 0),
    });
  }
  return { bpm, beatsPerBar, bar: (beatsPerBar * 60) / bpm, parts };
}

// ─── Waves and noise ────────────────────────────────────────────────────────

// Where a wave is (0..1) at `x` cycles: sine starts in the middle, rising;
// rise climbs from 0 and jumps back; fall is rise upside down; triangle
// climbs then falls; square is low for half a cycle, then high.
function shapeAt(shape, x) {
  const f = x - Math.floor(x);
  switch (shape) {
    case "rise": return f;
    case "fall": return 1 - f;
    case "triangle": return f < 0.5 ? 2 * f : 2 - 2 * f;
    case "square": return f < 0.5 ? 0 : 1;
    default: return 0.5 + 0.5 * Math.sin(2 * Math.PI * f);
  }
}

// A moving value at film time `t` (seconds), bars counted from `origin`.
const valueAt = (v, t, origin, bar) => (typeof v === "number" ? v : v.from + (v.to - v.from) * shapeAt(v.shape, (t - origin) / bar / v.bars + v.phase));

// Sets an AudioParam to a value, or draws its wave over [t0, t1]. A wave
// with `hold` keeps, for each note, the value it had when the note began.
function drive(param, v, t0, t1, origin, bar) {
  if (typeof v === "number" || v.hold) {
    param.setValueAtTime(valueAt(v, t0, origin, bar), t0);
    return;
  }
  // 200 points a second is far finer than any wave measured in bars.
  const n = Math.max(2, Math.ceil((t1 - t0) * 200));
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) curve[i] = valueAt(v, t0 + ((t1 - t0) * i) / (n - 1), origin, bar);
  param.setValueCurveAtTime(curve, t0, t1 - t0);
}

// Seeded, so a bed sounds the same every render.
function seeded(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x9e3779b9) | 0;
    let t = s ^ (s >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return (t >>> 0) / 4294967296;
  };
}

// Four seconds of noise, looped. Pink and brown are white noise filtered:
// pink by a sum of leaky averages at spread rates, brown by a leaky sum.
function noiseBuffer(ctx, kind) {
  const rate = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, rate * 4, rate);
  const data = buffer.getChannelData(0);
  const rand = seeded(kind === "white" ? 11 : kind === "pink" ? 23 : 37);
  const poles = [0.99765, 0.963, 0.57];
  const weights = [0.099046, 0.2965164, 1.0526913];
  const state = [0, 0, 0];
  let brown = 0;
  for (let i = 0; i < data.length; i++) {
    const w = rand() * 2 - 1;
    if (kind === "white") data[i] = w * 0.5;
    else if (kind === "pink") {
      let sum = w * 0.1848;
      for (let k = 0; k < 3; k++) {
        state[k] = poles[k] * state[k] + w * weights[k];
        sum += state[k];
      }
      data[i] = sum * 0.11;
    } else {
      brown = (brown + 0.02 * w) / 1.02;
      data[i] = brown * 3.5;
    }
  }
  return buffer;
}

// A room: decaying noise, a little different in each ear, swelling in over
// its first 0.1 s, darker as it fades (bright at first, about 1 kHz by the
// end), -60 dB after `size` seconds and silent half as long again.
function roomBuffer(ctx, size) {
  const rate = ctx.sampleRate;
  const length = Math.round(size * 1.5 * rate);
  const buffer = ctx.createBuffer(2, length, rate);
  const fadeIn = Math.round(0.1 * rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    const rand = seeded(101 + ch * 977);
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      const level = 10 ** ((-60 * t) / size / 20) * Math.min(1, i / fadeIn);
      // Two one-pole low-passes whose corner falls from 15 kHz to 1 kHz.
      const corner = 15000 * (1000 / 15000) ** Math.min(1, t / size);
      const a = 1 - Math.exp((-2 * Math.PI * corner) / rate);
      y1 += a * (rand() * 2 - 1 - y1);
      y2 += a * (y1 - y2);
      data[i] = y2 * level;
    }
  }
  return buffer;
}

// ─── Playing ────────────────────────────────────────────────────────────────

// Plays the bed into Tone's current (offline) context, from film time
// `start` to `duration`. `at` turns film time into context time. Returns
// how many notes it played.
export function playBed(Tone, music, { start, duration, at = (t) => t }) {
  const bed = readBed(music);
  const ctx = Tone.getContext();
  const out = Tone.getDestination();
  const noises = {};
  let played = 0;

  for (const part of bed.parts) {
    const bus = ctx.createGain();
    Tone.connect(bus, out);
    if (part.delay > 0) {
      const send = ctx.createGain();
      send.gain.value = part.delay;
      const echo = ctx.createDelay(4);
      echo.delayTime.value = part.delayTime ?? (bed.bar * 3) / 16;
      const feedback = ctx.createGain();
      feedback.gain.value = part.delayFeedback;
      bus.connect(send);
      send.connect(echo);
      echo.connect(feedback);
      feedback.connect(echo);
      Tone.connect(echo, out);
    }
    if (part.room > 0) {
      const send = ctx.createGain();
      send.gain.value = part.room;
      const room = ctx.createConvolver();
      room.buffer = roomBuffer(ctx, part.roomSize);
      bus.connect(send);
      send.connect(room);
      Tone.connect(room, out);
    }

    const loopLength = part.loop.bars * bed.bar;
    for (let k = 0; start + k * loopLength < duration; k++) {
      for (const e of part.loop.events) {
        const t0 = start + (k * part.loop.bars + e.at) * bed.bar;
        if (t0 >= duration || t0 < part.from || t0 >= part.to) continue;
        const gate = e.length * bed.bar;
        const end = Math.min(duration + part.release, t0 + gate + part.release + 0.01);
        for (const n of e.notes) {
          voice(Tone, ctx, part, bus, noises, { n, t0, gate, end, origin: start, bar: bed.bar, at });
          played++;
        }
      }
    }
  }
  return { notes: played, bpm: bed.bpm, bar: bed.bar };
}

function voice(Tone, ctx, part, bus, noises, { n, t0, gate, end, origin, bar, at }) {
  const T0 = at(t0);
  const T1 = at(end);
  let source;
  if (OSCILLATORS.has(part.sound)) {
    source = ctx.createOscillator();
    source.type = part.sound;
    source.frequency.value = hz(n ?? 60);
  } else {
    source = ctx.createBufferSource();
    source.buffer = noises[part.sound] ??= noiseBuffer(ctx, part.sound);
    source.loop = true;
  }

  // Linear envelope: up over attack, down to sustain over decay, held for
  // the note's length, then down to nothing over release.
  const env = ctx.createGain();
  const { attack: a, decay: d, sustain: s, release: r } = part;
  const level = (x) => (x < a ? x / a : x < a + d ? 1 - ((1 - s) * (x - a)) / d : s);
  const g = env.gain;
  g.setValueAtTime(0, T0);
  if (gate >= a) {
    if (a > 0) g.linearRampToValueAtTime(1, T0 + a);
    else g.setValueAtTime(1, T0);
    if (gate >= a + d) {
      if (d > 0) g.linearRampToValueAtTime(s, T0 + a + d);
      else g.setValueAtTime(s, T0 + a);
      g.setValueAtTime(s, T0 + gate);
    } else {
      g.linearRampToValueAtTime(level(gate), T0 + gate);
    }
  } else {
    g.linearRampToValueAtTime(level(gate), T0 + gate);
  }
  g.linearRampToValueAtTime(0, T0 + gate + Math.max(0.002, r));

  let node = source;
  node.connect(env);
  node = env;
  for (const [type, value, q] of [["highpass", part.highpass, part.highpassQ], ["lowpass", part.lowpass, part.lowpassQ]]) {
    if (value === null) continue;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    drive(f.frequency, value, T0, T1, at(origin), bar);
    node.connect(f);
    node = f;
  }
  const amp = ctx.createGain();
  if (typeof part.gain === "number") amp.gain.value = part.gain * HEADROOM;
  else drive(amp.gain, { ...part.gain, from: part.gain.from * HEADROOM, to: part.gain.to * HEADROOM }, T0, T1, at(origin), bar);
  node.connect(amp);
  node = amp;
  if (part.pan !== 0) {
    const pan = ctx.createStereoPanner();
    drive(pan.pan, part.pan, T0, T1, at(origin), bar);
    node.connect(pan);
    node = pan;
  }
  node.connect(bus);
  source.start(T0);
  source.stop(T1);
}
