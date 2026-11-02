// Sound design: every film (motion or video) can have a sound track that
// Claude composes as code and the studio renders to audio. Music is a
// music bed (studio/sound/bed.js: named parts, each a loop of notes with a
// sound, envelope, filters, room and echo); effects that must land on
// exact moments (a whoosh as orange arrives, a tick per bar) are drawn with
// Tone.js. Both are rendered offline in headless Chrome to one WAV the
// length of the film, which the studio plays in sync and every render
// mixes in. Same contract for the engine, the interface and Claude.
//
// The bed is the studio's own code and Tone.js is MIT. Films scored before
// the bed have Strudel code (AGPL-3.0) as their music: the in-house edition
// still plays it, the product edition never loads Strudel (see
// docs/launch/README.md), and scripts/studio/convert-score.mjs turns it
// into a music bed.

// films/<id>/sound/
//   score.js       the score Claude writes (see SoundScore below)
//   score.strudel.js  a converted film's old Strudel score, kept as it was
//   sound.wav      48 kHz stereo, exactly film.duration long (rendered)
//   peaks.json     number[] 0..1, 100 per second (rendered)
//   status.json    SoundStatus
//   music.wav      the music on its own, 32 bit float, before loudness (rendered)
//   effects.wav    the effects on their own, likewise (rendered)
//   music-peaks.json, effects-peaks.json   each stem's outline, as heard (rendered)
//   voice.wav, voice-peaks.json   a slide film's voiceover as one stem, and its outline (rendered)
//   master.json    the loudness gain chosen for the score (rendered)
//   mix.json       SoundMix: the person's volume edits (the studio writes it;
//                  Claude never does)

// score.js is an ES module whose default export is a SoundScore. It runs in
// the renderer's page with Tone available; it must be deterministic (no
// Math.random without a seed) so a re-render sounds the same.
export type SoundScore = {
  // The music: a music bed (MusicBed below), or a function that draws
  // music with Tone itself (it gets the SoundKit plus `start`, which is
  // musicStart). In-house only, a string of Strudel code from before the
  // bed. Starts at film time `musicStart` (default 0) and is faded out
  // over `musicFadeOut` seconds (default 1) at the film's end.
  music?: MusicBed | ((kit: SoundKit & { start: number }) => void | Promise<void>) | string;
  musicStart?: number;
  musicFadeOut?: number;
  musicGain?: number; // 0..1, default 0.6
  // Effects at exact film times, drawn with Tone.js inside an offline
  // context. Called once; schedule everything relative to `at(seconds)`.
  effects?: (kit: SoundKit) => void | Promise<void>;
  effectsGain?: number; // 0..1, default 0.8
  // Video films: how loud the music stays while someone speaks, 0..1
  // (default 0.3; 1 = no ducking). Effects are never ducked.
  duck?: number;
  // How loud the rendered sound is, in LUFS (-20 to -12). Default -16,
  // right for most social films; a launch film may ask for -14.
  loudness?: number;
};

// The music bed: parts that loop at one tempo. A bar is beatsPerBar beats.
export type MusicBed = {
  bpm: number;
  beatsPerBar?: number; // default 4
  parts: Record<string, MusicPart | null | false>; // null or false: switched off
};

// One part. `notes` is one loop: bars split by "|", each bar into equal
// steps by spaces. A step is a note (c2, eb3, f#4, or a MIDI number),
// notes joined by "+" for a chord, "." for a rest, "_" to hold the step
// before, or "x" for a hit with no pitch (noise sounds). Each part loops
// on its own length.
export type MusicPart = {
  sound?: "sine" | "triangle" | "square" | "sawtooth" | "white" | "pink" | "brown"; // default sine
  notes: string;
  // A linear envelope held for each note's length, in seconds (sustain 0..1).
  attack?: number; // default 0.01
  decay?: number; // default 0
  sustain?: number; // default 1
  release?: number; // default 0.1
  gain?: MusicValue; // default 0.5; 1 is one strong voice, a bed's parts sit around 0.02 to 0.5
  lowpass?: MusicValue; // Hz
  lowpassQ?: number; // dB, default 1
  highpass?: MusicValue; // Hz
  highpassQ?: number; // dB, default 1
  pan?: MusicValue; // -1 (left) to 1 (right), default 0
  room?: number; // 0..1, how much goes into the room (reverb)
  roomSize?: number; // seconds until the room fades by 60 dB, default 2
  delay?: number; // 0..1, how much goes into the echo
  delayTime?: number; // seconds, default 3/16 of a bar
  delayFeedback?: number; // 0..0.95, default 0.5
  from?: number; // film seconds: notes start from here
  to?: number; // and stop starting here
};

// A number, or a slow wave between two numbers: sine (starts in the
// middle, rising), rise, fall, triangle or square, once every `bars` bars.
// It glides through each note; with `hold`, each note keeps the value the
// wave had when the note started.
export type MusicValue =
  | number
  | { from: number; to: number; shape?: "sine" | "rise" | "fall" | "triangle" | "square"; bars?: number; phase?: number; hold?: boolean };

// What effects() gets. `Tone` is the Tone.js module bound to the offline
// context; `at` turns a film time into the context time; `marks` and
// `duration` come from film.json so effects can follow the film's moments;
// `params` are the film's current values.
export type SoundKit = {
  Tone: unknown;
  at: (seconds: number) => number;
  duration: number;
  marks: { t: number; label: string }[];
  params: Record<string, number | string | boolean>;
  fps: number;
  // Video films only (empty otherwise): the graphics on the timeline and
  // the spans of film time where someone is speaking (from the captions,
  // or the clips' transcripts), so hits can land on graphics and stay out
  // of the way of speech.
  graphics: { id: string; graphic: string; start: number; duration: number }[];
  speech: { start: number; end: number }[];
};

// film.json gains:
export type FilmSound = {
  on: boolean; // plays in the studio and goes into renders
  volume: number; // 0..1.5, 1 = as rendered
};

export type SoundStatus =
  | { state: "none" } // no score yet
  | { state: "rendering"; step: string } // plain English, one line
  // loudness in LUFS; stems: which stems have sound in them (missing on a
  // sound rendered before stems existed)
  | { state: "ready"; at: string; duration: number; loudness: number | null; stems?: SoundStem[] }
  | { state: "failed"; message: string; at: string };

// The stems the timeline shows as lanes: the two the score renders to, and
// a slide film's voiceover (sound/voice.json) when it has one.
export type SoundStem = "music" | "effects" | "voice";

// A span of one stem made louder, quieter or silent by hand. The stems are
// mixed again with these (20 ms fades at each edge) without playing the
// score, so it takes about a second; the loudness gain stays the score's,
// so nothing outside the span changes. They stay when the score is
// rendered again. Spans of one stem don't overlap.
export type SoundSpan = {
  stem: SoundStem;
  from: number; // film seconds
  to: number;
  gain: number; // dB, -24 to +6
  mute: boolean;
};
export type SoundMix = { spans: SoundSpan[] };

// ─── Routes ─────────────────────────────────────────────────────────────────
//
// GET  /api/studio/films/<id>/sound            → SoundStatus
// POST /api/studio/films/<id>/sound            → SoundStatus (renders score.js; also
//                                                happens on its own after a Claude
//                                                turn that changed sound/score.js)
// GET  /api/studio/films/<id>/sound/<file>     → sound.wav (byte ranges), peaks.json,
//                                                music-peaks.json, effects-peaks.json, voice-peaks.json
// GET  /api/studio/films/<id>/sound/mix        → SoundMix
// PUT  /api/studio/films/<id>/sound/mix        SoundMix → { mix, status }: saves the
//                                                edits and mixes the stems again
// PATCH /api/studio/films/<id>  {sound: FilmSound} sets on/volume
//
// The studio page plays sound.wav itself, kept in step with its own clock
// (the stage stays silent), so all engines sound the same.
//
// Mixing: renders of every kind mix sound.wav under the film's own audio
// (video footage) at film.sound.volume, ending with the film.
