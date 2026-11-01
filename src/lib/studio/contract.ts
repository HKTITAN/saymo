// The studio's shared contract: what a film is, how the studio page talks to
// the stage that plays it, and what the server's routes take and return.
// Three parts are built against it at once (engines, the Claude bridge and
// the interface), so change it only on purpose and in one place.
//
// The engines stay under the hood. The person using the studio sees films,
// never "HyperFrames", "Remotion" or "fframes"; the engine is a detail of how
// a film is written and rendered, chosen by Claude (or the starter).

// ─── Films ──────────────────────────────────────────────────────────────────

// How a film is written.
//   html  HyperFrames: one index.html, GSAP timeline in window.__timelines.main.
//         The default: instant preview, Claude writes it best.
//   react Remotion: src/Film.jsx, a React component using useCurrentFrame().
//         For data-driven films, captions, audio and video clips.
//   rust  fframes: a Cargo crate drawing SVG per frame on the GPU.
//         For heavy generative scenes; previews as a quick draft video.
export type Engine = "html" | "react" | "rust";

export type ParamType = "number" | "color" | "text" | "toggle" | "choice";

// A value a film exposes so it can be changed from the panel without Claude.
// The film reads the current values at load:
//   html  window.__params (set before the film's own scripts run)
//   react the component's props
//   rust  params.json beside Cargo.toml (read when the film is built)
export type Param = {
  key: string; // camelCase, unique in the film
  label: string; // plain English, shown in the panel
  type: ParamType;
  value: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  unit?: string; // "s", "px", "%"
  options?: string[]; // for "choice"
};

// A named moment on the timeline ("Orange rises").
export type Mark = { t: number; label: string };

// films/<id>/film.json. The folder holds everything else the film needs.
export type Film = {
  id: string; // 8 lowercase letters/digits, also the folder name
  title: string;
  engine: Engine;
  width: number;
  height: number;
  fps: number; // 60 unless there's a reason
  duration: number; // seconds
  params: Param[];
  marks: Mark[];
  createdAt: string; // ISO
  updatedAt: string; // ISO
  session?: string; // Claude session id, so the chat continues
  kind?: "motion" | "video"; // video = an edit of footage (edit.ts); missing = motion
  sound?: { on: boolean; volume: number }; // sound design (sound.ts); missing = none yet
};

// A film in the list.
export type FilmSummary = Pick<Film, "id" | "title" | "engine" | "kind" | "width" | "height" | "duration" | "updatedAt"> & {
  poster: string | null; // URL of a still, if one has been made
};

// Size presets offered when making a film.
export const SIZES = [
  { label: "Wide 16:9", width: 1920, height: 1080 },
  { label: "Square 1:1", width: 1080, height: 1080 },
  { label: "Portrait 4:5", width: 1080, height: 1350 },
  { label: "Story 9:16", width: 1080, height: 1920 },
] as const;

// ─── Files on disk ─────────────────────────────────────────────────────────
//
// films/<id>/                    git ignores films/, as it does posts/
//   film.json                    Film
//   index.html, assets/          html
//   src/Film.jsx, public/        react (component is the default export)
//   Cargo.toml, src/, media/,    rust
//   params.json
//   .history/<n>/                a copy of the film before each Claude turn
//   out/                         renders: draft.mp4, 4k.mp4, 1080p.mp4,
//                                poster.png, render.json (RenderStatus)
//
// studio/starters/<engine>/      what a new film is copied from

// ─── The stage ──────────────────────────────────────────────────────────────
//
// GET /studio/stage/<id> serves a page that plays one film at its own pixel
// size (the studio scales the iframe to fit). It is the same page for every
// engine; inside, html films run their timeline, react films run in the
// Remotion Player, rust films show their draft video.
//
// The stage never plays on its own. The studio page owns time: it sends
// "seek" every animation frame while playing, so all engines behave the same.

export type StageInbound =
  | { type: "studio:seek"; t: number } // seconds, clamped to [0, duration]
  | { type: "studio:params"; params: Record<string, Param["value"]> } // live values
  | { type: "studio:point"; on: boolean } // pointing mode: clicks pick, not play
  | { type: "studio:reload" }; // the film's files changed

export type Picked = {
  x: number; // film pixels
  y: number;
  // The element under the pointer, as precisely as the engine allows.
  // html: the deepest element with an id or data-hf-id; react: the
  // data-part attribute if the film sets one; rust: none.
  id: string | null;
  tag: string | null;
  text: string | null; // its visible words, trimmed to 80 characters
  rect: { x: number; y: number; width: number; height: number } | null; // film pixels
};

export type StageOutbound =
  | { type: "studio:ready"; duration: number; fps: number; width: number; height: number }
  | { type: "studio:picked"; pick: Picked } // a click in pointing mode
  | { type: "studio:error"; message: string } // the film failed to load or threw
  | { type: "studio:loading" }; // e.g. a rust draft is being made

// ─── Routes ─────────────────────────────────────────────────────────────────
//
// Every /api/studio route starts with `if (!allowed(request)) return
// refused();` (films.ts). Requests that change anything must send the
// header `x-studio: 1` (STUDIO_HEADERS), or they are refused.
//
// GET    /api/studio/films                     → FilmSummary[]
// POST   /api/studio/films  {title?, engine?, width?, height?}
//                                              → Film (copied from a starter)
// GET    /api/studio/films/<id>                → Film
// PATCH  /api/studio/films/<id>  FilmEdit      → Film
// DELETE /api/studio/films/<id>                → 204
// POST   /api/studio/films/<id>/duplicate      → Film
//
// POST   /api/studio/films/<id>/chat  ChatRequest
//        → text/event-stream of ChatEvent, one JSON object per `data:` line
// DELETE /api/studio/films/<id>/chat           → stops the running turn
// GET    /api/studio/films/<id>/chat           → ChatMessage[] (the history)
// POST   /api/studio/films/<id>/undo           → Film (state before the last turn)
//
// POST   /api/studio/films/<id>/render  {quality: "draft" | "final"}
//        → RenderStatus (starts it; one render at a time across the studio)
// GET    /api/studio/films/<id>/render         → RenderStatus
// GET    /api/studio/films/<id>/out/<file>     → the file (mp4/png), download
//                                                with ?download=1

// Headers every studio request from the page sends.
export const STUDIO_HEADERS = { "x-studio": "1" } as const;

export type FilmEdit = Partial<Pick<Film, "title" | "width" | "height" | "fps" | "duration">> & {
  params?: Record<string, Param["value"]>; // new values by key
};

// What Claude is told along with the words, so "make this bigger" works.
export type ChatContext = {
  t: number; // where the playhead is, seconds
  pick: Picked | null; // what was pointed at, if anything
  selection?: string[]; // video films: ids of the timeline items selected (edit.ts Clip/Graphic ids)
};

export type ChatRequest = { prompt: string; context: ChatContext };

export type ChatEvent =
  | { kind: "start"; turn: number }
  | { kind: "text"; text: string } // Claude's words, streamed in pieces
  | { kind: "step"; label: string } // plain English: "Editing the film", "Checking it"
  | { kind: "changed"; files: string[] } // film files written; reload the stage
  | { kind: "done"; film: Film } // the turn ended; film.json as it is now
  | { kind: "error"; message: string }; // plain English

export type ChatMessage = {
  role: "you" | "claude";
  text: string;
  at: string; // ISO
  context?: ChatContext; // on yours
  steps?: string[]; // on Claude's
};

export type RenderStatus =
  | { state: "idle" }
  | { state: "queued" }
  | { state: "running"; quality: "draft" | "final"; progress: number } // 0..1
  | { state: "done"; quality: "draft" | "final"; files: string[]; at: string }
  | { state: "failed"; message: string; at: string };
