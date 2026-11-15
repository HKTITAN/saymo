// Cutting a video edit by its words. Name the words to remove and the cut
// lands in the real silence around them, read from the footage's loudness
// (peaks.json, 100 samples a second), so a cut never clips a word or leaves
// half a breath. Everything after a cut moves up to close the gap, on every
// track; graphics fixed to words follow their words (anchors.ts).
//
// Plain TypeScript with no `@/` imports, so Node scripts (the media tool,
// edit-check.mjs) can import it too. The plan is
// docs/plans/words-are-the-timeline.md.

import { parseWordRef, type Transcripts, wordRef } from "./anchors.ts";
import { filmTime } from "./captions.ts";
import type { CaptionFix, Clip, Edit, Graphic, Word, WordRef } from "./edit.ts";

type Item = Clip | Graphic;

export type Peaks = Record<string, number[] | undefined>; // 0..1 loudness, 100 per second, by media id

const PER_SECOND = 100;
const CLEAR = 0.04; // a cut stays this far from a word's edge
const HARD = 0.06; // a gap shorter than this has no silence to cut in
const FADE = 0.01; // a cut with no silence gets this short fade, so it doesn't click

const round = (n: number) => Math.round(n * 1000) / 1000;
const middle = (w: Word) => (w.start + w.end) / 2;
const plays = (clip: Clip, w: Word) => middle(w) >= clip.from && middle(w) < clip.to;
const lengthOf = (item: Item) => (item.type === "clip" ? (item.to - item.from) / (item.speed ?? 1) : item.duration);

// Clips that carry speech: on video and audio tracks, hidden or not.
const speechClips = (edit: Edit): Clip[] =>
  edit.tracks.flatMap((t) => (t.kind === "graphics" ? [] : t.items.filter((i): i is Clip => i.type === "clip")));

// The quietest moment between two words, or the middle of the gap when it's
// too short to hold any silence. `hard` says there was no silence.
export function quietest(from: number, to: number, peaks: number[] | undefined): { t: number; hard: boolean } {
  if (to - from < HARD) return { t: round((from + to) / 2), hard: true };
  const lo = from + CLEAR;
  const hi = to - CLEAR;
  if (!peaks?.length || hi <= lo) return { t: round((from + to) / 2), hard: false };
  const a = Math.max(0, Math.floor(lo * PER_SECOND));
  const b = Math.min(peaks.length - 1, Math.ceil(hi * PER_SECOND));
  if (b < a) return { t: round((from + to) / 2), hard: false };
  let min = Infinity;
  for (let i = a; i <= b; i++) min = Math.min(min, peaks[i] ?? 0);
  // Of the samples within a hair of the quietest, the one nearest the
  // middle of the gap, so a long pause is shared evenly either side.
  const centre = ((lo + hi) / 2) * PER_SECOND;
  let best = a;
  for (let i = a; i <= b; i++) {
    if ((peaks[i] ?? 0) <= min + 0.02 && Math.abs(i - centre) < Math.abs(best - centre)) best = i;
  }
  const t = Math.min(hi, Math.max(lo, (best + 0.5) / PER_SECOND));
  return { t: round(t), hard: false };
}

// A stretch of one clip's source to take out.
type Cut = { clip: string; from: number; to: number; hard: boolean };

// Takes the stretches out, latest first, and closes each gap: the clip is
// split around the stretch and everything starting after it, on every
// track, moves up by its length.
function applyCuts(edit: Edit, cuts: Cut[]): Edit {
  const at = (e: Edit, id: string) => e.tracks.flatMap((t) => t.items).find((i): i is Clip => i.id === id && i.type === "clip");
  const placed = cuts
    .map((c) => {
      const clip = at(edit, c.clip);
      const start = clip ? filmTime(clip, c.from) : null;
      return clip && start !== null ? { ...c, start } : null;
    })
    .filter((c): c is Cut & { start: number } => c !== null)
    .sort((a, b) => b.start - a.start);
  const ids = new Set(edit.tracks.flatMap((t) => t.items.map((i) => i.id)));
  const newId = (base: string) => {
    let n = 2;
    while (ids.has(`${base}-${n}`.slice(0, 40))) n++;
    const id = `${base}-${n}`.slice(0, 40);
    ids.add(id);
    return id;
  };

  let out = edit;
  for (const c of placed) {
    const clip = at(out, c.clip);
    if (!clip) continue;
    const from = Math.max(clip.from, c.from);
    const to = Math.min(clip.to, c.to);
    if (to - from < 0.005) continue;
    const speed = clip.speed ?? 1;
    const cutStart = clip.start + (from - clip.from) / speed;
    const cutEnd = clip.start + (to - clip.from) / speed;
    const gone = cutEnd - cutStart;
    const pieces: Clip[] = [];
    if (from - clip.from >= 0.02) pieces.push({ ...clip, to: from, ...(c.hard ? { fadeOut: FADE } : { fadeOut: undefined }) });
    if (clip.to - to >= 0.02) {
      const id = pieces.length ? newId(clip.id) : clip.id;
      pieces.push({ ...clip, id, start: round(cutStart), from: to, ...(c.hard ? { fadeIn: FADE } : { fadeIn: undefined }) });
    }
    out = {
      ...out,
      tracks: out.tracks.map((track) => ({
        ...track,
        items: track.items
          .flatMap((item): Item[] => (item.id === clip.id ? pieces : [item]))
          .map((item) =>
            pieces.includes(item as Clip) || item.start < cutEnd - 1e-6 ? item : { ...item, start: round(Math.max(0, item.start - gone)) },
          )
          .sort((a, b) => a.start - b.start),
      })),
    };
  }
  return out;
}

export type CutResult = {
  edit: Edit;
  removed: { said: string; seconds: number }[]; // each run of words taken out, in film order
  skipped: string[]; // words named that the edit doesn't play
};

// Removes these words from the edit. With `keepPause`, the silence before
// each run of cut words stays, as in "keep the pause after 'machine'".
export function cutWords(
  edit: Edit,
  transcripts: Transcripts,
  peaks: Peaks,
  refs: WordRef[],
  { keepPause = false }: { keepPause?: boolean } = {},
): CutResult {
  const wanted = new Map<string, Set<number>>();
  const skipped: string[] = [];
  for (const ref of refs) {
    const r = parseWordRef(ref);
    if (!r || !transcripts[r.media]?.[r.index]) {
      skipped.push(ref);
      continue;
    }
    if (!wanted.has(r.media)) wanted.set(r.media, new Set());
    wanted.get(r.media)!.add(r.index);
  }
  const cuts: Cut[] = [];
  const removed: (CutResult["removed"][number] & { at: number })[] = [];
  const found = new Set<string>();
  for (const clip of speechClips(edit)) {
    const words = transcripts[clip.media];
    const picked = wanted.get(clip.media);
    if (!words || !picked) continue;
    // The words this clip plays, in order, with their numbers.
    const inClip = words.map((w, i) => ({ w, i })).filter((x) => plays(clip, x.w));
    for (let k = 0; k < inClip.length; k++) {
      if (!picked.has(inClip[k].i)) continue;
      let end = k;
      while (end + 1 < inClip.length && picked.has(inClip[end + 1].i)) end++;
      const run = inClip.slice(k, end + 1);
      const before = inClip[k - 1]?.w;
      const after = inClip[end + 1]?.w;
      const first = run[0].w;
      const last = run[run.length - 1].w;
      for (const x of run) found.add(wordRef(clip.media, x.i));
      const start = !before
        ? { t: clip.from, hard: false }
        : keepPause
          ? { t: round(Math.max(before.end + CLEAR, first.start - CLEAR)), hard: first.start - before.end < HARD }
          : quietest(before.end, first.start, peaks[clip.media]);
      const stop = !after ? { t: clip.to, hard: false } : quietest(last.end, after.start, peaks[clip.media]);
      cuts.push({ clip: clip.id, from: start.t, to: stop.t, hard: start.hard || stop.hard });
      removed.push({
        said: run.map((x) => x.w.text).join(" "),
        seconds: round((stop.t - start.t) / (clip.speed ?? 1)),
        at: filmTime(clip, start.t) ?? 0,
      });
      k = end;
    }
  }
  for (const ref of refs) if (!found.has(ref) && !skipped.includes(ref)) skipped.push(ref);
  return {
    edit: applyCuts(captionsByWord(edit, transcripts), cuts),
    removed: removed.sort((a, b) => a.at - b.at).map(({ said, seconds }) => ({ said, seconds })),
    skipped,
  };
}

// ─── Fillers and long pauses ─────────────────────────────────────────────────

const FILLER = /^(u+m+|u+h+|u+h+m+|e+r+m*|a+h+|h+m+|m{2,})[,.!?…]*$/i;
const clean = (t: string) => t.toLowerCase().replace(/[^a-z']/g, "");

// The filler words the edit plays: um, uh, erm, ah, hmm, plus "you know"
// and "like" when set off by a comma (where they carry no meaning).
export function fillers(edit: Edit, transcripts: Transcripts): WordRef[] {
  const out = new Set<WordRef>();
  for (const clip of speechClips(edit)) {
    const words = transcripts[clip.media];
    if (!words) continue;
    words.forEach((w, i) => {
      if (!plays(clip, w)) return;
      const next = words[i + 1];
      if (FILLER.test(w.text.trim())) out.add(wordRef(clip.media, i));
      else if (clean(w.text) === "like" && /,$/.test(w.text)) out.add(wordRef(clip.media, i));
      else if (clean(w.text) === "you" && next && clean(next.text) === "know" && /,$/.test(next.text) && plays(clip, next)) {
        out.add(wordRef(clip.media, i));
        out.add(wordRef(clip.media, i + 1));
      }
    });
  }
  return [...out];
}

// Shortens every pause longer than `longer` seconds to `keep` seconds,
// taken from the quiet in its middle.
export function cutPauses(
  edit: Edit,
  transcripts: Transcripts,
  peaks: Peaks,
  { longer = 0.8, keep = 0.3 }: { longer?: number; keep?: number } = {},
): CutResult {
  const cuts: Cut[] = [];
  const removed: (CutResult["removed"][number] & { at: number })[] = [];
  for (const clip of speechClips(edit)) {
    const words = transcripts[clip.media]?.filter((w) => plays(clip, w));
    if (!words) continue;
    for (let i = 1; i < words.length; i++) {
      const gap = words[i].start - words[i - 1].end;
      if (gap <= longer) continue;
      const centre = quietest(words[i - 1].end, words[i].start, peaks[clip.media]).t;
      const from = round(Math.max(words[i - 1].end + keep / 2, Math.min(centre, words[i].start - keep / 2) - (gap - keep) / 2));
      const to = round(from + (gap - keep));
      cuts.push({ clip: clip.id, from, to, hard: false });
      removed.push({ said: `the pause before "${words[i].text}"`, seconds: round((to - from) / (clip.speed ?? 1)), at: filmTime(clip, from) ?? 0 });
    }
  }
  return {
    edit: applyCuts(captionsByWord(edit, transcripts), cuts),
    removed: removed.sort((a, b) => a.at - b.at).map(({ said, seconds }) => ({ said, seconds })),
    skipped: [],
  };
}

// ─── Captions that follow the cut ────────────────────────────────────────────

// Before a cut, captions kept as a list of timed words become fixes by word
// (anchors.ts), so they're rebuilt after the cut with every fix kept. A
// caption word that differs from what the transcript heard becomes a fix;
// words without a source word can't follow and are left to the rebuild.
export function captionsByWord(edit: Edit, transcripts: Transcripts): Edit {
  const c = edit.captions;
  if (c.fixes || !c.words.length) return edit;
  const fixes: Record<WordRef, CaptionFix> = {};
  for (const w of c.words) {
    const r = w.ref ? parseWordRef(w.ref) : null;
    const heard = r ? transcripts[r.media]?.[r.index] : undefined;
    if (!w.ref || !heard) continue;
    const fix: CaptionFix = {};
    if (w.text !== heard.text) fix.text = w.text;
    if (w.hit) fix.hit = true;
    if (Object.keys(fix).length) fixes[w.ref] = fix;
  }
  return { ...edit, version: 2, captions: { ...c, fixes } };
}

export const filmEnd = (edit: Edit) =>
  edit.tracks.reduce((end, t) => t.items.reduce((e, i) => Math.max(e, i.start + lengthOf(i)), end), 0);

// ─── Bringing cut words back ─────────────────────────────────────────────────

// Puts cut words back: the clip before them grows to take them in (up to the
// quiet after the last one), or, for words cut from the start, the clip
// after them reaches back to the quiet before the first. Everything later
// moves along to make room, and two pieces of one take that meet again
// become one clip.
export function restoreWords(edit: Edit, transcripts: Transcripts, peaks: Peaks, refs: WordRef[]): CutResult {
  const byMedia = new Map<string, number[]>();
  for (const ref of refs) {
    const r = parseWordRef(ref);
    if (!r || !transcripts[r.media]?.[r.index]) continue;
    byMedia.set(r.media, [...(byMedia.get(r.media) ?? []), r.index]);
  }
  let out = edit;
  const removed: CutResult["removed"] = []; // here: what came back
  const skipped: string[] = [];
  const shiftAfter = (e: Edit, keep: string, from: number, by: number): Edit => ({
    ...e,
    tracks: e.tracks.map((t) => ({
      ...t,
      items: t.items
        .map((i) => (i.id === keep || i.start < from - 1e-6 ? i : { ...i, start: round(i.start + by) }))
        .sort((a, b) => a.start - b.start),
    })),
  });
  for (const [media, list] of byMedia) {
    const words = transcripts[media] ?? [];
    const indices = [...new Set(list)].sort((a, b) => a - b);
    // Runs of neighbouring cut words, latest first so earlier runs keep their places.
    const runs: number[][] = [];
    for (const i of indices) {
      const run = runs.at(-1);
      if (run && i === run[run.length - 1] + 1) run.push(i);
      else runs.push([i]);
    }
    for (const run of runs.reverse()) {
      const clips = speechClips(out).filter((c) => c.media === media);
      const first = words[run[0]];
      const last = words[run[run.length - 1]];
      if (clips.some((c) => run.some((i) => plays(c, words[i])))) {
        skipped.push(...run.map((i) => wordRef(media, i)));
        continue;
      }
      const before = clips.filter((c) => c.to <= middle(first)).sort((a, b) => b.to - a.to)[0];
      const after = clips.filter((c) => c.from >= middle(last)).sort((a, b) => a.from - b.from)[0];
      const said = run.map((i) => words[i].text).join(" ");
      if (before) {
        const next = words[run[run.length - 1] + 1];
        const meets = after && next && plays(after, next);
        const to = meets ? after.from : next ? quietest(last.end, next.start, peaks[media]).t : last.end + 0.2;
        const speed = before.speed ?? 1;
        const end = before.start + (before.to - before.from) / speed;
        const by = round((to - before.to) / speed);
        if (by <= 0) continue;
        out = shiftAfter(out, before.id, end, by);
        out = { ...out, tracks: out.tracks.map((t) => ({ ...t, items: t.items.map((i) => (i.id === before.id ? { ...before, to: round(to), fadeOut: undefined } : i)) })) };
        // The two pieces of the take meet again: one clip.
        if (meets && after && (after.speed ?? 1) === speed && Math.abs(after.start + by - (end + by)) < 0.002) {
          out = {
            ...out,
            tracks: out.tracks.map((t) => ({
              ...t,
              items: t.items
                .filter((i) => i.id !== after.id)
                .map((i) => (i.id === before.id ? { ...(i as Clip), to: after.to, fadeOut: after.fadeOut } : i)),
            })),
          };
        }
        removed.push({ said, seconds: by });
      } else if (after) {
        const prev = words[run[0] - 1];
        const from = prev ? quietest(prev.end, first.start, peaks[media]).t : Math.max(0, first.start - 0.2);
        const by = round((after.from - from) / (after.speed ?? 1));
        if (by <= 0) continue;
        out = shiftAfter(out, after.id, after.start, by);
        out = { ...out, tracks: out.tracks.map((t) => ({ ...t, items: t.items.map((i) => (i.id === after.id ? { ...after, from: round(from), fadeIn: undefined } : i)) })) };
        removed.push({ said, seconds: by });
      } else skipped.push(...run.map((i) => wordRef(media, i)));
    }
  }
  return { edit: out, removed, skipped };
}
