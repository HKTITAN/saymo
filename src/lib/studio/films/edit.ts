// The studio as a video editor: a film can be an EDIT of footage the owner
// brings in (interviews, event clips, screen recordings, photos, music),
// cut on a timeline, captioned, reframed and dressed with motion graphics.
// Same studio, same chat, same render button; this file is the contract for
// the editing half, alongside contract.ts.
//
// Under the hood an edit is a Remotion film (engine "react"): one generic
// composition (studio/starters/video/) reads edit.json and plays it, so the
// timeline, Claude and the render all change the same file.

import type { Param } from "./contract";

// ─── Footage ────────────────────────────────────────────────────────────────

export type MediaKind = "video" | "image" | "audio";

// films/<id>/media/<mediaId>/ holds the original and what's made from it.
export type Media = {
  id: string; // 8 lowercase letters/digits
  kind: MediaKind;
  name: string; // the file's own name, shown in the bin
  original: string; // file name inside the media folder, e.g. "original.mov"
  // Made after import (null until ready):
  proxy: string | null; // "proxy.mp4": 1080p H.264, a keyframe every few frames, for smooth scrubbing
  thumbs: string | null; // "thumbs.jpg": a strip of frames for the timeline
  thumbEvery: number | null; // seconds between strip frames
  peaks: string | null; // "peaks.json": number[] of 0..1 loudness, 100 per second
  transcript: string | null; // "transcript.json": Word[]
  width: number | null;
  height: number | null;
  duration: number | null; // seconds (images: null)
  fps: number | null;
  hasAudio: boolean;
  status: "importing" | "ready" | "failed";
  step?: string; // plain English while importing: "Making a smooth preview copy"
  error?: string;
  transcribing?: boolean;
  // The person in a video cut out of their background, for layouts where
  // they stand in front of the graphics: "cutout.webm", see-through VP9
  // with the sound kept. null until asked for (see startCutout in media.ts).
  cutout?: string | null;
  cutting?: boolean; // being made now; `step` says how far
  cutoutCrisp?: boolean; // made with the crisp edge; an older, softer cutout is made again when next asked for
};

// A spoken word with its time in the SOURCE file.
// `hit`: a key word, shown in colour by the serif captions.
// `ref`: on caption words, the transcript word it came from (WordRef).
export type Word = { text: string; start: number; end: number; confidence?: number; hit?: boolean; ref?: WordRef };

// ─── Words as anchors (anchors.ts) ──────────────────────────────────────────

// A word's address: "<mediaId>:<index>", its place in that media's
// transcript.json. Transcripts are in source time and don't change when the
// edit does, so the address survives cuts, moves and speed changes.
export type WordRef = string;

// A moment fixed to a word: an edge of the word, plus an offset in seconds
// (negative is before it). `clip` pins it to one clip when the same footage
// plays twice; otherwise the topmost, earliest clip that plays the word wins.
export type Anchor = {
  word: WordRef;
  edge?: "start" | "end"; // default "start"
  offset?: number; // default 0
  clip?: string;
};

// A fix to one caption word, kept by its WordRef so it survives every cut.
export type CaptionFix = { text?: string; hit?: boolean; hidden?: boolean };

// A named moment the sound design lands on, fixed to a word.
export type EditMark = { label: string; at: Anchor };

// ─── The edit ───────────────────────────────────────────────────────────────

// All times are seconds. `start` is on the film's timeline; `from`/`to` are
// in the source file.
export type Clip = {
  id: string;
  type: "clip";
  media: string; // Media.id
  start: number;
  from: number; // in point in the source
  to: number; // out point in the source; length on the timeline = (to - from) / speed
  speed?: number; // 1 = normal
  volume?: number; // 0..2, 1 = as recorded
  fadeIn?: number;
  fadeOut?: number;
  // Framing in the film's frame: the clip covers the frame, scaled by
  // `zoom`, with its centre at (x, y) as 0..1 of the source. Lets a 16:9
  // interview become a 9:16 story by moving x onto the speaker.
  zoom?: number; // 1 = just covers
  x?: number; // 0.5 = centred
  y?: number;
  // The part of the frame the clip fills, as 0..1 of the frame (missing =
  // all of it). The clip covers this box the way it would cover the frame,
  // and nothing of it shows outside: a speaker on the top half of a
  // half-and-half reel is { x: 0, y: 0, w: 1, h: 0.5 }.
  box?: Box;
  // Show the media's cutout (the person without their background) instead
  // of the whole picture, so what's beneath shows round them: the reel's
  // pop-out, where the speaker's head rises into the graphic.
  cutout?: boolean;
  // The part of the frame the clip may show in, as 0..1 of the frame
  // (missing = all of it): it's placed by `box` and its framing as usual,
  // then cut to this. The pop-out uses it on two clips of one take framed
  // alike: the take in the bottom strip, its cutout above the line.
  window?: Box;
  // Rounds the corners of the window (or, without one, of the box), as
  // 0..0.25 of the frame's width; a corner that's the frame's own stays
  // square. The pop-out's strip rounds its top corners this way.
  radius?: number;
};

export type Box = { x: number; y: number; w: number; h: number };

// A box that fits in the frame and isn't too small to see, or null.
export function cleanBox(raw: unknown): Box | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number.NaN);
  const [x, y, w, h] = [n(b.x), n(b.y), n(b.w), n(b.h)];
  if (![x, y, w, h].every((v) => v >= 0 && v <= 1)) return null;
  if (w < 0.05 || h < 0.05 || x + w > 1.0001 || y + h > 1.0001) return null;
  return { x, y, w, h };
}

// A motion graphic on the film: one of the studio's own (studio/graphics/)
// or one Claude wrote for this film (films/<id>/graphics/<name>.jsx).
export type Graphic = {
  id: string;
  type: "graphic";
  graphic: string; // "lower-third", "title", "end-card", "logo", "quote", or a film's own
  start: number;
  duration: number;
  values: Record<string, Param["value"]>; // the graphic's params
  // Fixed to words (anchors.ts fills in start and duration from them).
  at?: Anchor; // where it starts
  until?: Anchor; // where it ends; without it, it lasts `duration` from `at`
};

export type TrackKind = "video" | "graphics" | "audio";

export type Track = {
  id: string;
  kind: TrackKind; // video tracks hold clips (footage, photos); audio tracks hold clips of audio
  name: string;
  muted?: boolean;
  hidden?: boolean;
  items: (Clip | Graphic)[];
};

// One word, a line at a time, a line with the spoken word lit, or one big
// serif word at a time with the key words in colour.
export type CaptionStyle = "words" | "lines" | "karaoke" | "serif";

export type Edit = {
  // 1: everything in seconds. 2: items may hang on words (anchors.ts).
  version: 1 | 2;
  tracks: Track[]; // drawn bottom to top: tracks[0] is underneath
  captions: {
    on: boolean;
    style: CaptionStyle;
    // Caption words on the FILM's timeline, made from the clips' transcripts
    // and editable on their own (fixing a misheard word changes only this).
    words: Word[];
    position: "bottom" | "middle";
    tag?: string; // a small series line under the captions: "Product tips | 1/10"
    // Fixes to single words by WordRef. When present, `words` is rebuilt
    // from the transcripts with these applied, so fixes outlive cuts.
    fixes?: Record<WordRef, CaptionFix>;
  };
  background: string; // what shows where nothing covers the frame
  marks?: EditMark[]; // named moments for the sound design, fixed to words
};

// films/<id>/edit.json for a video film. film.json's duration follows the
// edit's end, and its kind is "video".
export type FilmKind = "motion" | "video";

export const EMPTY_EDIT: Edit = {
  version: 1,
  tracks: [
    { id: "v1", kind: "video", name: "Footage", items: [] },
    { id: "g1", kind: "graphics", name: "Graphics", items: [] },
    { id: "a1", kind: "audio", name: "Music", items: [] },
  ],
  captions: { on: false, style: "lines", words: [], position: "bottom" },
  background: "#141414",
};

// The film's end: where the last item on any track finishes.
export function editEnd(edit: Edit): number {
  let end = 0;
  for (const track of edit.tracks) {
    for (const item of track.items) {
      const length = item.type === "clip" ? (item.to - item.from) / (item.speed ?? 1) : item.duration;
      end = Math.max(end, item.start + length);
    }
  }
  return end;
}

// ─── Routes, in addition to contract.ts ─────────────────────────────────────
//
// POST   /api/studio/films  {kind: "video", title?, width?, height?}
//                            → Film (kind "video", engine "react", empty edit)
// GET    /api/studio/films/<id>/edit             → Edit
// PUT    /api/studio/films/<id>/edit  Edit       → Edit (also updates film.json duration)
// GET    /api/studio/films/<id>/media            → Media[]
// POST   /api/studio/films/<id>/media            body = the file itself,
//        header `x-file-name` → Media (status "importing"; poll GET for ready)
// DELETE /api/studio/films/<id>/media/<mid>      → 204 (refused while the edit uses it)
// POST   /api/studio/films/<id>/media/<mid>/transcribe → Media (transcribing)
// GET    /api/studio/films/<id>/media/<mid>/<file>     → proxy.mp4, thumbs.jpg,
//        peaks.json, transcript.json (byte ranges for video)
// GET    /api/studio/graphics                    → GraphicInfo[] (the library)

export type GraphicInfo = {
  name: string; // "lower-third"
  label: string; // "Lower third"
  params: Param[]; // with defaults
  duration: number; // a good default length, seconds
};

// ─── The stage, in addition to contract.ts ──────────────────────────────────
//
// For video films the studio sends the edit live while you work on the
// timeline, so the stage follows without saving or rebuilding:
//   { type: "studio:edit"; edit: Edit }
// The stage plays proxies (smooth); renders use the originals.
export type StageEditMessage = { type: "studio:edit"; edit: Edit };
