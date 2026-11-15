// The slot machine's sounds, made with Web Audio (no files): the lever's
// ratchet and clunk, a tick each time a symbol passes under the pay line,
// a thunk as each reel lands, and a short bright chime with coins on the
// jackpot. Quiet by default. The machine only appears after a click, so
// the browser lets it play.

let ctx: AudioContext | null = null;
let out: GainNode | null = null;

function audio() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    out = ctx.createGain();
    out.gain.value = 0.35;
    out.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

// A short burst of filtered noise: clicks, ticks, ratchets.
function noise(c: AudioContext, at: number, dur: number, freq: number, q: number, gain: number) {
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(out!);
  src.start(at);
}

// A tone with a quick attack and a falling tail.
function tone(c: AudioContext, at: number, freq: number, dur: number, gain: number, type: OscillatorType = "sine", drop = 1) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (drop !== 1) o.frequency.exponentialRampToValueAtTime(freq * drop, at + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(out!);
  o.start(at);
  o.stop(at + dur + 0.02);
}

export const slotSounds = {
  // The lever going down: a run of ratchet clicks, then a clunk at the bottom.
  pull() {
    const c = audio();
    if (!c) return;
    const t = c.currentTime;
    for (let i = 0; i < 6; i++) noise(c, t + i * 0.045, 0.02, 3200 - i * 180, 6, 0.5);
    tone(c, t + 0.3, 110, 0.18, 0.5, "sine", 0.6);
    noise(c, t + 0.3, 0.06, 900, 1.5, 0.6);
  },
  // The SPIN button pressing in.
  press() {
    const c = audio();
    if (!c) return;
    noise(c, c.currentTime, 0.03, 1800, 3, 0.35);
  },
  // A symbol passing the pay line (called as the reels turn; it keeps
  // itself to a sensible rate).
  tick(speed: number) {
    const c = audio();
    if (!c) return;
    noise(c, c.currentTime, 0.012, 2400 + Math.min(1, speed / 30) * 1400, 8, 0.18);
  },
  // A reel landing.
  land(i: number) {
    const c = audio();
    if (!c) return;
    const t = c.currentTime;
    tone(c, t, 180 - i * 12, 0.16, 0.55, "sine", 0.55);
    noise(c, t, 0.05, 700, 1.2, 0.45);
  },
  // All three in: a quick rising chime and a few coins.
  jackpot() {
    const c = audio();
    if (!c) return;
    const t = c.currentTime;
    [784, 988, 1175, 1568].forEach((f, i) => {
      tone(c, t + i * 0.07, f, 0.5, 0.22, "triangle");
      tone(c, t + i * 0.07, f * 2, 0.3, 0.05, "sine");
    });
    for (let i = 0; i < 5; i++) {
      const at = t + 0.3 + i * 0.07 + Math.random() * 0.03;
      tone(c, at, 2600 + Math.random() * 900, 0.18, 0.08, "sine");
      tone(c, at, 4100 + Math.random() * 700, 0.12, 0.04, "sine");
    }
  },
};
