// The sound of the swelling accent field: a low pad that breathes with the
// wave rolling through the lines, air arriving from the right with the
// accent, one bright note as it lands, and the air leaving with the black.
// Music as a music bed, hits in Tone.js (src/lib/studio/sound/sound.ts).

export default {
  // A slow chord on soft sawtooths, its filter opening and closing like
  // the wave over two bars, with a sub underneath.
  music: {
    bpm: 60,
    parts: {
      pad: {
        sound: "sawtooth",
        notes: "c3+g3+eb4 | ab2+eb3+c4",
        attack: 0.6,
        sustain: 0.8,
        release: 1.2,
        lowpass: { from: 300, to: 1100, shape: "sine", bars: 2 },
        lowpassQ: 2,
        gain: 0.18,
      },
      sub: { sound: "sine", notes: "c2 | ab1", attack: 0.2, release: 1, gain: 0.5 },
    },
  },
  musicGain: 0.5,
  musicFadeOut: 1.2,

  async effects({ Tone, at, marks }) {
    const when = (label, fallback) => marks.find((m) => m.label === label)?.t ?? fallback;
    const arrive = when("Accent arrives", 0.5);
    const landed = arrive + 0.9; // the lines take 0.9 s to land (lib.rs)
    const back = when("Black returns", 3.6);

    // Air in from the right, rising until the accent has landed.
    const pan = new Tone.Panner(0.9).toDestination();
    const band = new Tone.Filter({ type: "bandpass", frequency: 350, Q: 1 }).connect(pan);
    const level = new Tone.Gain(0).connect(band);
    new Tone.Noise("pink").connect(level).start(at(arrive)).stop(at(landed + 0.5));
    level.gain.setValueAtTime(0, at(arrive));
    level.gain.linearRampToValueAtTime(0.4, at(landed));
    level.gain.exponentialRampToValueAtTime(0.001, at(landed + 0.5));
    band.frequency.setValueAtTime(350, at(arrive));
    band.frequency.exponentialRampToValueAtTime(2800, at(landed));
    pan.pan.setValueAtTime(0.9, at(arrive));
    pan.pan.linearRampToValueAtTime(0, at(landed));

    // Landed: one bright note.
    const room = new Tone.Reverb({ decay: 2.2, wet: 0.35 }).toDestination();
    await room.ready;
    const bell = new Tone.FMSynth({
      harmonicity: 2,
      modulationIndex: 4,
      envelope: { attack: 0.002, decay: 0.9, sustain: 0, release: 0.5 },
      modulationEnvelope: { attack: 0.002, decay: 0.3, sustain: 0 },
    });
    bell.connect(new Tone.Gain(0.22).connect(room));
    bell.triggerAttackRelease("G5", 0.25, at(landed));

    // Black returns: the air draws back out.
    const outBand = new Tone.Filter({ type: "lowpass", frequency: 2400, Q: 0.7 }).toDestination();
    const outLevel = new Tone.Gain(0).connect(outBand);
    new Tone.Noise("brown").connect(outLevel).start(at(back)).stop(at(back + 1));
    outLevel.gain.setValueAtTime(0, at(back));
    outLevel.gain.linearRampToValueAtTime(0.35, at(back + 0.15));
    outLevel.gain.exponentialRampToValueAtTime(0.001, at(back + 1));
    outBand.frequency.setValueAtTime(2400, at(back));
    outBand.frequency.exponentialRampToValueAtTime(200, at(back + 1));
  },
};
