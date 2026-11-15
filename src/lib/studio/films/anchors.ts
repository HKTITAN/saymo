// Words as the timeline: graphics, caption fixes and sound marks can hang on
// spoken words (edit.ts Anchor) instead of seconds, so a cut moves them with
// the words they belong to. resolveEdit turns the anchors back into seconds
// for everything that plays or renders the edit; remapAnchors keeps them on
// the right words when a file is transcribed again.
//
// Plain TypeScript with no `@/` imports, so Node scripts can import it too
// (scripts/studio/edit-check.mjs checks it). The plan is
// docs/plans/words-are-the-timeline.md.

import { captionWords, filmTime } from "./captions.ts";
import type { Anchor, CaptionFix, Clip, Edit, Graphic, Word, WordRef } from "./edit.ts";

export type Transcripts = Record<string, Word[] | undefined>;

export const wordRef = (media: string, index: number): WordRef => `${media}:${index}`;

export function parseWordRef(ref: WordRef): { media: string; index: number } | null {
  const m = /^([A-Za-z0-9_-]+):(\d+)$/.exec(ref);
  return m ? { media: m[1], index: Number(m[2]) } : null;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const middleOf = (w: Word) => (w.start + w.end) / 2;
const plays = (clip: Clip, w: Word) => middleOf(w) >= clip.from && middleOf(w) < clip.to;

// Clips that can carry an anchor, topmost track first and earliest first
// within a track. Hidden tracks don't count; muted ones do, since a word is
// still on screen when its sound is off.
function anchorClips(edit: Edit): Clip[] {
  const out: Clip[] = [];
  for (const track of [...edit.tracks].reverse()) {
    if (track.kind === "graphics" || track.hidden) continue;
    const clips = track.items.filter((i): i is Clip => i.type === "clip");
    out.push(...clips.sort((a, b) => a.start - b.start));
  }
  return out;
}

type Placed = { t: number; word: Word; moved: boolean };

// Where an anchor lands on the film, or null if its file isn't in the edit
// at all. A word that was cut moves to the nearest word of the same file
// that still plays, and `moved` says so.
function place(anchor: Anchor, clips: Clip[], transcripts: Transcripts): Placed | null {
  const ref = parseWordRef(anchor.word);
  if (!ref) return null;
  const words = transcripts[ref.media];
  if (!words?.[ref.index]) return null;
  const candidates = clips.filter((c) => c.media === ref.media);
  if (!candidates.length) return null;
  const pinned = anchor.clip ? candidates.find((c) => c.id === anchor.clip) : undefined;
  const order = pinned ? [pinned, ...candidates.filter((c) => c !== pinned)] : candidates;

  const at = (index: number): { clip: Clip; word: Word } | null => {
    const word = words[index];
    if (!word) return null;
    const clip = order.find((c) => plays(c, word));
    return clip ? { clip, word } : null;
  };
  let found = at(ref.index);
  let moved = false;
  // Nearest kept word, looking later first at each distance (a title on a
  // cut word should land on what's said next, not what came before).
  for (let d = 1; !found && d < words.length; d++) {
    found = at(ref.index + d) ?? at(ref.index - d);
    moved = true;
  }
  if (!found) return null;
  const { clip, word } = found;
  const edge = anchor.edge === "end" ? word.end : word.start;
  const source = Math.min(clip.to, Math.max(clip.from, edge));
  const t = filmTime(clip, source);
  if (t === null) return null;
  return { t: round(Math.max(0, t + (anchor.offset ?? 0))), word, moved };
}

const graphicName = (g: Graphic) => g.graphic.replace(/-/g, " ");
const wordText = (ref: WordRef, transcripts: Transcripts) => {
  const r = parseWordRef(ref);
  return r ? transcripts[r.media]?.[r.index]?.text : undefined;
};

export type ResolvedMark = { label: string; t: number };

export type Resolved = {
  edit: Edit; // the same edit with every anchored time filled in, in seconds
  marks: ResolvedMark[]; // the sound design's moments, on the film's timeline
  notes: string[]; // what moved or couldn't be placed, in plain words
};

// Fills in seconds from anchors. An item without anchors keeps its seconds,
// so a version 1 edit comes back unchanged.
export function resolveEdit(edit: Edit, transcripts: Transcripts): Resolved {
  const clips = anchorClips(edit);
  const notes: string[] = [];
  // A word as the notes quote it, or "its word" when it can't be read.
  const said = (ref: WordRef) => {
    const text = wordText(ref, transcripts);
    return text ? `"${text}"` : "its word";
  };

  const tracks = edit.tracks.map((track) => {
    if (track.kind !== "graphics") return track;
    const items = track.items.map((item) => {
      if (item.type !== "graphic" || (!item.at && !item.until)) return item;
      const g = { ...item };
      const start = item.at ? place(item.at, clips, transcripts) : null;
      const end = item.until ? place(item.until, clips, transcripts) : null;
      if (item.at && !start) notes.push(`The ${graphicName(item)} couldn't find ${said(item.at.word)} in the edit, so it stays where it was.`);
      if (start) {
        g.start = start.t;
        if (start.moved) notes.push(`The ${graphicName(item)} now starts on "${start.word.text}" because ${said(item.at!.word)} was cut.`);
      }
      if (item.until && !end) notes.push(`The ${graphicName(item)} couldn't find ${said(item.until.word)} in the edit, so it keeps its length.`);
      if (end) {
        if (end.moved) notes.push(`The ${graphicName(item)} now ends on "${end.word.text}" because ${said(item.until!.word)} was cut.`);
        g.duration = round(Math.max(0.1, end.t - g.start));
      }
      return g;
    });
    return { ...track, items };
  });

  const marks: ResolvedMark[] = [];
  for (const mark of edit.marks ?? []) {
    const p = place(mark.at, clips, transcripts);
    if (!p) {
      notes.push(`The moment "${mark.label}" couldn't find ${said(mark.at.word)} in the edit, so the sound skips it.`);
      continue;
    }
    if (p.moved) notes.push(`The moment "${mark.label}" now lands on "${p.word.text}" because ${said(mark.at.word)} was cut.`);
    marks.push({ label: mark.label, t: p.t });
  }
  marks.sort((a, b) => a.t - b.t);

  const resolved: Edit = { ...edit, tracks };
  const fixes = edit.captions.fixes;
  if (fixes) {
    resolved.captions = { ...edit.captions, words: applyFixes(captionWords(resolved, transcripts), fixes) };
  }
  return { edit: resolved, marks, notes };
}

// Caption words with the person's fixes applied: new text, a key word, or
// the word left out.
export function applyFixes(words: Word[], fixes: Record<WordRef, CaptionFix>): Word[] {
  const out: Word[] = [];
  for (const w of words) {
    const fix = w.ref ? fixes[w.ref] : undefined;
    if (!fix) {
      out.push(w);
      continue;
    }
    if (fix.hidden) continue;
    out.push({ ...w, ...(fix.text !== undefined ? { text: fix.text } : {}), ...(fix.hit !== undefined ? { hit: fix.hit } : {}) });
  }
  return out;
}

// ─── A file transcribed again ────────────────────────────────────────────────

// When a file's transcript is made again, word numbers can shift. Every
// anchor and caption fix on that file moves to the new word that overlaps
// its old word's time most (or, if none overlaps, the one whose middle is
// nearest). `lost` lists what couldn't be moved, in plain words.
export function remapAnchors(edit: Edit, media: string, before: Word[], after: Word[]): { edit: Edit; lost: string[] } {
  const lost: string[] = [];
  const moveRef = (ref: WordRef): WordRef | null => {
    const r = parseWordRef(ref);
    if (!r || r.media !== media) return ref;
    const old = before[r.index];
    if (!old || !after.length) {
      lost.push(old ? `"${old.text}"` : `word ${r.index}`);
      return null;
    }
    let best = -1;
    let bestScore = -Infinity;
    after.forEach((w, i) => {
      const overlap = Math.min(old.end, w.end) - Math.max(old.start, w.start);
      const score = overlap > 0 ? overlap : -Math.abs(middleOf(w) - middleOf(old));
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    return wordRef(media, best);
  };
  const moveAnchor = (a: Anchor | undefined): Anchor | undefined => {
    if (!a) return a;
    const word = moveRef(a.word);
    return word ? { ...a, word } : undefined;
  };

  const tracks = edit.tracks.map((track) => ({
    ...track,
    items: track.items.map((item) => {
      if (item.type !== "graphic" || (!item.at && !item.until)) return item;
      const g: Graphic = { ...item };
      // An anchor that can't be moved is dropped; the graphic keeps the
      // seconds it last resolved to.
      if (item.at) {
        const at = moveAnchor(item.at);
        if (at) g.at = at;
        else delete g.at;
      }
      if (item.until) {
        const until = moveAnchor(item.until);
        if (until) g.until = until;
        else delete g.until;
      }
      return g;
    }),
  }));

  let fixes = edit.captions.fixes;
  if (fixes) {
    const next: Record<WordRef, CaptionFix> = {};
    for (const [ref, fix] of Object.entries(fixes)) {
      const moved = moveRef(ref);
      if (moved) next[moved] = fix;
    }
    fixes = next;
  }

  const marks = edit.marks?.flatMap((m) => {
    const at = moveAnchor(m.at);
    return at ? [{ ...m, at }] : [];
  });

  return {
    edit: { ...edit, tracks, captions: { ...edit.captions, ...(fixes ? { fixes } : {}) }, ...(marks ? { marks } : {}) },
    lost,
  };
}

// ─── Retyping a caption line ─────────────────────────────────────────────────

// A caption line retyped by hand, as fixes on the words it's made of, so the
// change outlives later cuts. The new words go onto the old ones in order:
// spare old words are left out, and spare new words join the last one.
// Returns null when a word in the line doesn't know where it came from (an
// edit from before words had addresses); the caller edits the copy then.
export function fixLine(
  lineWords: Word[],
  text: string,
  fixes: Record<WordRef, CaptionFix>,
): Record<WordRef, CaptionFix> | null {
  if (!lineWords.length || lineWords.some((w) => !w.ref)) return null;
  const parts = text.split(/\s+/).filter(Boolean);
  const next = { ...fixes };
  lineWords.forEach((w, k) => {
    const ref = w.ref as WordRef;
    const was = next[ref] ?? {};
    const last = k === lineWords.length - 1;
    const said = last ? parts.slice(k).join(" ") : parts[k];
    if (!said) {
      next[ref] = { ...was, hidden: true };
      return;
    }
    const fix: CaptionFix = { ...was, text: said };
    delete fix.hidden;
    next[ref] = fix;
  });
  return next;
}
