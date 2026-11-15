// A video film's sound design starts quiet: no music (the footage has its
// own sound), only a light touch on each graphic: air in from the right as
// it arrives, a soft tick when it lands, and air out as it leaves. The end
// card gets one bright note. Ask Claude for music under the speech; it dips
// on its own while someone talks.
// Hits in Tone.js (src/lib/studio/sound/sound.ts).

export default {
  async effects({ Tone, at, graphics, duration }) {
    if (!graphics.length) return;
    const room = new Tone.Reverb({ decay: 1.6, wet: 0.3 }).toDestination();
    await room.ready;

    const air = (from, to, up) => {
      const pan = new Tone.Panner(up ? 0.8 : 0).toDestination();
      const band = new Tone.Filter({ type: "bandpass", frequency: up ? 500 : 2600, Q: 1 }).connect(pan);
      const level = new Tone.Gain(0).connect(band);
      new Tone.Noise("pink").connect(level).start(at(from)).stop(at(to + 0.05));
      level.gain.setValueAtTime(0, at(from));
      level.gain.linearRampToValueAtTime(up ? 0.3 : 0.2, at(up ? to : from + 0.08));
      level.gain.exponentialRampToValueAtTime(0.001, at(up ? to + 0.3 : to));
      band.frequency.setValueAtTime(up ? 500 : 2600, at(from));
      band.frequency.exponentialRampToValueAtTime(up ? 3000 : 400, at(to));
      if (up) {
        pan.pan.setValueAtTime(0.8, at(from));
        pan.pan.linearRampToValueAtTime(0, at(to));
      }
    };

    const tick = new Tone.MembraneSynth({ pitchDecay: 0.008, octaves: 3, envelope: { attack: 0.001, decay: 0.08, sustain: 0 } });
    tick.connect(new Tone.Gain(0.4).toDestination());
    const bell = new Tone.FMSynth({
      harmonicity: 3,
      modulationIndex: 5,
      envelope: { attack: 0.002, decay: 0.7, sustain: 0, release: 0.4 },
      modulationEnvelope: { attack: 0.002, decay: 0.25, sustain: 0 },
    });
    bell.connect(new Tone.Gain(0.22).connect(room));

    for (const g of graphics) {
      const lands = g.start + Math.min(0.4, g.duration / 3);
      air(Math.max(0, g.start - 0.2), lands, true);
      if (g.graphic === "end-card") bell.triggerAttackRelease("G5", 0.2, at(lands));
      else tick.triggerAttackRelease("G4", 0.05, at(lands));
      const leaves = Math.min(duration, g.start + g.duration);
      if (leaves - lands > 0.6) air(Math.max(lands, leaves - 0.35), leaves, false);
    }
  },
};
