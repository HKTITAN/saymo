// The sound of the line field: a low, slow pulse underneath, a soft tick as
// the headline rises, filtered air that travels in from the right with the
// accent, one bright note when it lands, and the air drawing back out as
// black returns. Music in Strudel, hits in Tone.js (src/lib/studio/sound.ts).

export default {
  // Two seconds a cycle: a sub pulse on the beat and a few quiet, high
  // notes with a short echo, like light catching the lines.
  music: `setcps(0.5)
$: note("c1 ~ c1 ~").s("sine").attack(0.01).decay(0.5).sustain(0).lpf(180).gain(0.9)
$: note("<g4 ~ ~ bb4 ~ ~ c5 ~>*2").s("triangle").decay(0.12).sustain(0).lpf(2600).gain(0.1)
  .delay(0.35).delaytime(0.375).delayfeedback(0.35)`,
  musicGain: 0.5,
  musicFadeOut: 0.8,

  async effects({ Tone, at, marks, params }) {
    // The film's own moments, at its speed (a faster film tightens them).
    const speed = Math.max(0.25, Number(params.speed) || 1);
    const when = (label) => (marks.find((m) => m.label === label)?.t ?? 0) / speed;

    // Air travelling in from the right: pink noise through a rising band,
    // panned from the right edge to the middle, peaking as the accent lands.
    const arrive = when("Accent arrives");
    const pan = new Tone.Panner(0.9).toDestination();
    const band = new Tone.Filter({ type: "bandpass", frequency: 400, Q: 1.2 }).connect(pan);
    const level = new Tone.Gain(0).connect(band);
    const air = new Tone.Noise("pink").connect(level);
    const start = Math.max(0, arrive - 0.45);
    air.start(at(start)).stop(at(arrive + 0.4));
    level.gain.setValueAtTime(0, at(start));
    level.gain.linearRampToValueAtTime(0.5, at(arrive));
    level.gain.exponentialRampToValueAtTime(0.001, at(arrive + 0.4));
    band.frequency.setValueAtTime(400, at(start));
    band.frequency.exponentialRampToValueAtTime(3200, at(arrive));
    pan.pan.setValueAtTime(0.9, at(start));
    pan.pan.linearRampToValueAtTime(0, at(arrive));

    // A soft tick as the headline rises.
    const tick = new Tone.MembraneSynth({ pitchDecay: 0.008, octaves: 3, envelope: { attack: 0.001, decay: 0.08, sustain: 0 } });
    tick.connect(new Tone.Gain(0.6).toDestination());
    tick.triggerAttackRelease("G4", 0.05, at(when("Headline rises")));

    // One bright note as the orange lands, with a little room.
    const room = new Tone.Reverb({ decay: 1.6, wet: 0.35 }).toDestination();
    await room.ready; // the room is built before anything plays into it
    const bell = new Tone.FMSynth({
      harmonicity: 3,
      modulationIndex: 6,
      envelope: { attack: 0.002, decay: 0.6, sustain: 0, release: 0.4 },
      modulationEnvelope: { attack: 0.002, decay: 0.2, sustain: 0 },
    });
    bell.connect(new Tone.Gain(0.25).connect(room));
    bell.triggerAttackRelease("G5", 0.2, at(arrive));

    // Black returns: the air draws back out, falling and fading.
    const back = when("Black returns");
    const outBand = new Tone.Filter({ type: "lowpass", frequency: 2400, Q: 0.7 }).toDestination();
    const outLevel = new Tone.Gain(0).connect(outBand);
    const outAir = new Tone.Noise("brown").connect(outLevel);
    outAir.start(at(back)).stop(at(back + 0.9));
    outLevel.gain.setValueAtTime(0, at(back));
    outLevel.gain.linearRampToValueAtTime(0.35, at(back + 0.15));
    outLevel.gain.exponentialRampToValueAtTime(0.001, at(back + 0.9));
    outBand.frequency.setValueAtTime(2400, at(back));
    outBand.frequency.exponentialRampToValueAtTime(200, at(back + 0.9));
  },
};
