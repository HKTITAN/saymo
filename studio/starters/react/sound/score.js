// The sound of the counting figure: air rushing in from the right with the
// bar, a fine digital tick for each step of the count (fast, then slowing
// as it eases in), one bright note when the figure settles, and the air
// leaving with the black. A quiet pulse runs under it all.
// Music as a music bed, hits in Tone.js (src/lib/studio/sound/sound.ts).

export default {
  music: {
    bpm: 120,
    parts: {
      pulse: { sound: "sine", notes: "c1 . . c1 . . . .", attack: 0.01, decay: 0.6, sustain: 0, release: 0.01, lowpass: 160, gain: 0.9 },
      glints: { sound: "sine", notes: ". . eb5 . . . g5 .", attack: 0.001, decay: 0.2, sustain: 0, release: 0.01, gain: 0.06, room: 0.4 },
    },
  },
  musicGain: 0.45,
  musicFadeOut: 1,

  async effects({ Tone, at, marks, params }) {
    const when = (label, fallback) => marks.find((m) => m.label === label)?.t ?? fallback;
    const arrive = when("Bar arrives", 0.4);
    const settle = arrive + 1; // the count eases in over one second (Film.jsx)
    const back = when("Black returns", 3.6);

    // Air in from the right with the bar.
    const pan = new Tone.Panner(0.9).toDestination();
    const band = new Tone.Filter({ type: "bandpass", frequency: 500, Q: 1.1 }).connect(pan);
    const level = new Tone.Gain(0).connect(band);
    new Tone.Noise("pink").connect(level).start(at(Math.max(0, arrive - 0.35))).stop(at(arrive + 0.5));
    level.gain.setValueAtTime(0, at(Math.max(0, arrive - 0.35)));
    level.gain.linearRampToValueAtTime(0.45, at(arrive));
    level.gain.exponentialRampToValueAtTime(0.001, at(arrive + 0.5));
    band.frequency.setValueAtTime(500, at(Math.max(0, arrive - 0.35)));
    band.frequency.exponentialRampToValueAtTime(3500, at(arrive));
    pan.pan.setValueAtTime(0.9, at(Math.max(0, arrive - 0.35)));
    pan.pan.linearRampToValueAtTime(0, at(arrive + 0.1));

    // One tick per step of the count, as the figure eases in (ease-out
    // cubic, the same curve the film uses), at most 24 of them.
    const figure = Math.max(1, Math.round(Number(params.figure) || 40));
    const steps = Math.min(24, figure);
    const tick = new Tone.Synth({ oscillator: { type: "square" }, envelope: { attack: 0.001, decay: 0.018, sustain: 0, release: 0.01 } });
    const tickLevel = new Tone.Gain(0.12);
    tick.chain(new Tone.Filter(2500, "highpass"), tickLevel, Tone.getDestination());
    for (let k = 1; k <= steps; k++) {
      // Inverse of ease-out cubic: when has the count reached k/steps?
      const p = 1 - Math.cbrt(1 - k / steps);
      const t = arrive + p * (settle - arrive);
      tick.triggerAttackRelease(k % 2 ? "C7" : "G6", 0.01, at(t), 1 - 0.6 * (k / steps));
    }

    // The figure settles: one bright note, with a little room.
    const room = new Tone.Reverb({ decay: 1.8, wet: 0.3 }).toDestination();
    await room.ready;
    const bell = new Tone.FMSynth({
      harmonicity: 3,
      modulationIndex: 5,
      envelope: { attack: 0.002, decay: 0.7, sustain: 0, release: 0.4 },
      modulationEnvelope: { attack: 0.002, decay: 0.25, sustain: 0 },
    });
    bell.connect(new Tone.Gain(0.25).connect(room));
    bell.triggerAttackRelease("C6", 0.2, at(settle));

    // Black returns: the air draws back out.
    const outBand = new Tone.Filter({ type: "lowpass", frequency: 2400, Q: 0.7 }).toDestination();
    const outLevel = new Tone.Gain(0).connect(outBand);
    new Tone.Noise("brown").connect(outLevel).start(at(back)).stop(at(back + 0.9));
    outLevel.gain.setValueAtTime(0, at(back));
    outLevel.gain.linearRampToValueAtTime(0.35, at(back + 0.15));
    outLevel.gain.exponentialRampToValueAtTime(0.001, at(back + 0.9));
    outBand.frequency.setValueAtTime(2400, at(back));
    outBand.frequency.exponentialRampToValueAtTime(200, at(back + 0.9));
  },
};
