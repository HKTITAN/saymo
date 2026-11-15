// Captions for a video film, made from what's said in its clips. Each
// clip's transcript is in SOURCE time; the captions are on the FILM's
// timeline, so a word shows up where the clip that holds it plays, at the
// clip's speed, and words cut out of a clip are left out.
//
// Shared by the timeline (to show and fix captions), Claude (to rebuild
// them after cutting) and the server. Plain TypeScript with no `@/`
// imports, so Node scripts can import it too.

import type { Clip, Edit, Word } from "./edit";

const lengthOf = (clip: Clip) => (clip.to - clip.from) / (clip.speed ?? 1);

// Film time for a moment in a clip's source, or null if it's cut out.
export function filmTime(clip: Clip, source: number): number | null {
  if (source < clip.from - 1e-6 || source > clip.to + 1e-6) return null;
  return clip.start + (source - clip.from) / (clip.speed ?? 1);
}

// Source time for a moment on the film inside a clip, or null if the clip
// isn't playing then.
export function sourceTime(clip: Clip, t: number): number | null {
  if (t < clip.start - 1e-6 || t > clip.start + lengthOf(clip) + 1e-6) return null;
  return clip.from + (t - clip.start) * (clip.speed ?? 1);
}

// What's under the playhead at film time `t`, top track first: each clip
// with the moment it shows in its source file, each graphic with how far
// into it the playhead is. Lets a request like "cut here" or "add a title
// at this point" land exactly where the playhead stopped.
export type AtPlayhead =
  | { track: string; trackKind: string; type: "clip"; id: string; media: string; source: number; intoClip: number; left: number }
  | { track: string; trackKind: string; type: "graphic"; id: string; graphic: string; intoGraphic: number; left: number };

export function atPlayhead(edit: Edit, t: number): AtPlayhead[] {
  const out: AtPlayhead[] = [];
  for (const track of [...edit.tracks].reverse()) {
    for (const item of track.items) {
      if (item.type === "clip") {
        const source = sourceTime(item, t);
        if (source === null) continue;
        out.push({ track: track.id, trackKind: track.kind, type: "clip", id: item.id, media: item.media, source: round(source), intoClip: round(t - item.start), left: round(item.start + lengthOf(item) - t) });
      } else if (t >= item.start && t <= item.start + item.duration) {
        out.push({ track: track.id, trackKind: track.kind, type: "graphic", id: item.id, graphic: item.graphic, intoGraphic: round(t - item.start), left: round(item.start + item.duration - t) });
      }
    }
  }
  return out;
}

// Every word heard in the film, in order, on the film's timeline. A word
// counts when its middle falls inside what the clip keeps. Clips on muted
// or hidden tracks, and silenced clips, are left out. Where two clips play
// at once, the higher track's words win.
export function captionWords(edit: Edit, transcripts: Record<string, Word[] | undefined>): Word[] {
  const placed: (Word & { track: number })[] = [];
  edit.tracks.forEach((track, index) => {
    if (track.muted || track.hidden) return;
    for (const item of track.items) {
      if (item.type !== "clip" || (item.volume ?? 1) <= 0) continue;
      const words = transcripts[item.media];
      if (!words?.length) continue;
      for (const w of words) {
        const middle = (w.start + w.end) / 2;
        if (middle < item.from || middle >= item.to) continue;
        const start = filmTime(item, Math.max(w.start, item.from));
        const end = filmTime(item, Math.min(w.end, item.to));
        if (start === null || end === null) continue;
        placed.push({ text: w.text, start: round(start), end: round(Math.max(end, start + 0.02)), confidence: w.confidence, track: index });
      }
    }
  });
  placed.sort((a, b) => a.start - b.start || b.track - a.track);
  const out: Word[] = [];
  for (const w of placed) {
    const prev = out.at(-1) as (Word & { track?: number }) | undefined;
    // Overlapping speech from a lower track is dropped.
    if (prev && w.start < prev.end - 0.05) continue;
    out.push({ text: w.text, start: w.start, end: w.end, ...(w.confidence !== undefined ? { confidence: w.confidence } : {}) });
  }
  return out;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

// Groups caption words into the lines shown on screen: a new line after a
// pause, at the end of a sentence, or when a line would get too long.
export type CaptionLine = { start: number; end: number; words: Word[] };

export function captionLines(words: Word[], { maxChars = 34, maxGap = 0.7, maxLength = 3.2 } = {}): CaptionLine[] {
  const lines: CaptionLine[] = [];
  let line: CaptionLine | null = null;
  for (const w of words) {
    const chars = line ? line.words.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length : 0;
    const ended = line && /[.!?]$/.test(line.words.at(-1)!.text);
    if (!line || w.start - line.end > maxGap || chars > maxChars || w.end - line.start > maxLength || ended) {
      line = { start: w.start, end: w.end, words: [w] };
      lines.push(line);
    } else {
      line.words.push(w);
      line.end = w.end;
    }
  }
  return lines;
}
