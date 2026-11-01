// Sound design: every film (motion or video) can have a sound track that
// Claude composes as code and the studio renders to audio. Music beds are
// written in Strudel (pattern-based live-coding music), effects that must
// land on exact moments (a whoosh as orange arrives, a tick per bar) in
// Tone.js. Both are rendered offline in headless Chrome to one WAV the
// length of the film, which the studio plays in sync and every render mixes
// in. Same contract for the engine, the interface and Claude.
//
// Strudel is AGPL-3.0: fine for this in-house tool on this Mac; it must not
// be offered to people outside Aerchain as a hosted service without
// publishing the source. Tone.js is MIT.

// films/<id>/sound/
//   score.js       the score Claude writes (see SoundScore below)
//   sound.wav      48 kHz stereo, exactly film.duration long (rendered)
//   peaks.json     number[] 0..1, 100 per second (rendered)
//   status.json    SoundStatus

// score.js is an ES module whose default export is a SoundScore. It runs in
// the renderer's page with Strudel and Tone available; it must be
// deterministic (no Math.random without a seed) so a re-render sounds the
// same.
export type SoundScore = {
  // Strudel code, evaluated as in the Strudel REPL (e.g. `setcps(0.5)\nstack(s("bd*2"), note("c2 eb2").s("sawtooth").lpf(400))`).
  // Starts at film time `musicStart` (default 0) and is faded out over
  // `musicFadeOut` seconds (default 1) at the film's end.
  music?: string;
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
};

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
  | { state: "ready"; at: string; duration: number; loudness: number | null } // LUFS
  | { state: "failed"; message: string; at: string };

// ─── Routes ─────────────────────────────────────────────────────────────────
//
// GET  /api/studio/films/<id>/sound            → SoundStatus
// POST /api/studio/films/<id>/sound            → SoundStatus (renders score.js; also
//                                                happens on its own after a Claude
//                                                turn that changed sound/score.js)
// GET  /api/studio/films/<id>/sound/<file>     → sound.wav (byte ranges), peaks.json
// PATCH /api/studio/films/<id>  {sound: FilmSound} sets on/volume
//
// The studio page plays sound.wav itself, kept in step with its own clock
// (the stage stays silent), so all engines sound the same.
//
// Mixing: renders of every kind mix sound.wav under the film's own audio
// (video footage) at film.sound.volume, ending with the film.
