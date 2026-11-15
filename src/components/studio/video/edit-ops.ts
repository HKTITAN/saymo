import type { Clip, Edit, Graphic, Media, Track, Word } from "@/lib/studio/films/edit";

// What you can do to an edit by hand on the timeline, as plain functions:
// each takes an edit and returns a new one, so undo is a list of edits.
// Times are seconds; `start` is on the film's timeline, `from`/`to` in the
// source file (see edit.ts).

export type Item = Clip | Graphic;

// A still photo has no length of its own; it plays this long when added.
export const PHOTO_SECONDS = 4;
// The shortest anything can be trimmed to.
export const MIN_LENGTH = 0.1;

export const lengthOf = (item: Item) => (item.type === "clip" ? (item.to - item.from) / (item.speed ?? 1) : item.duration);
export const endOf = (item: Item) => item.start + lengthOf(item);

// Eight lower-case letters and digits, like the server's ids.
export const newItemId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

export function findItem(edit: Edit, id: string): { track: Track; item: Item } | null {
  for (const track of edit.tracks) {
    const item = track.items.find((i) => i.id === id);
    if (item) return { track, item };
  }
  return null;
}

// Changes the items with these ids, wherever they are.
export function mapItems(edit: Edit, ids: Set<string>, fn: (item: Item, track: Track) => Item): Edit {
  return {
    ...edit,
    tracks: edit.tracks.map((track) => ({
      ...track,
      items: track.items.map((item) => (ids.has(item.id) ? fn(item, track) : item)),
    })),
  };
}

export const updateItem = (edit: Edit, id: string, patch: Partial<Clip> | Partial<Graphic>) =>
  mapItems(edit, new Set([id]), (item) => ({ ...item, ...patch }) as Item);

export function updateTrack(edit: Edit, id: string, patch: Partial<Track>): Edit {
  return { ...edit, tracks: edit.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
}

const sortItems = (items: Item[]) => [...items].sort((a, b) => a.start - b.start);

// Where a new item of this kind goes: the first track that holds its kind,
// made if there isn't one.
function trackFor(edit: Edit, kind: Track["kind"]): { edit: Edit; track: Track } {
  const found = edit.tracks.find((t) => t.kind === kind);
  if (found) return { edit, track: found };
  const names = { video: "Footage", graphics: "Graphics", audio: "Music" } as const;
  const track: Track = { id: `${kind[0]}${newItemId().slice(0, 4)}`, kind, name: names[kind], items: [] };
  return { edit: { ...edit, tracks: [...edit.tracks, track] }, track };
}

// The kind of track that takes a piece of media.
export const kindForMedia = (media: Media): Track["kind"] => (media.kind === "audio" ? "audio" : "video");

export function clipFromMedia(media: Media, start: number): Clip {
  const length = media.kind === "image" ? PHOTO_SECONDS : (media.duration ?? PHOTO_SECONDS);
  return { id: newItemId(), type: "clip", media: media.id, start, from: 0, to: length, speed: 1, volume: 1 };
}

// Puts a clip of this media at `start` on the first track of its kind.
// Returns the new edit and the clip's id.
export function addMedia(edit: Edit, media: Media, start: number, trackId?: string): { edit: Edit; id: string } {
  const wanted = edit.tracks.find((t) => t.id === trackId && t.kind === kindForMedia(media));
  const placed = wanted ? { edit, track: wanted } : trackFor(edit, kindForMedia(media));
  const clip = clipFromMedia(media, Math.max(0, start));
  return {
    edit: {
      ...placed.edit,
      tracks: placed.edit.tracks.map((t) => (t.id === placed.track.id ? { ...t, items: sortItems([...t.items, clip]) } : t)),
    },
    id: clip.id,
  };
}

// Lays media end to end after whatever is already on its track.
export function appendMedia(edit: Edit, list: Media[]): Edit {
  let next = edit;
  for (const media of list) {
    const { track } = trackFor(next, kindForMedia(media));
    const end = track.items.reduce((e, i) => Math.max(e, endOf(i)), 0);
    next = addMedia(next, media, end).edit;
  }
  return next;
}

export function addGraphic(
  edit: Edit,
  graphic: { name: string; duration: number; values: Graphic["values"] },
  start: number,
  trackId?: string,
): { edit: Edit; id: string } {
  const wanted = edit.tracks.find((t) => t.id === trackId && t.kind === "graphics");
  const placed = wanted ? { edit, track: wanted } : trackFor(edit, "graphics");
  const item: Graphic = {
    id: newItemId(),
    type: "graphic",
    graphic: graphic.name,
    start: Math.max(0, start),
    duration: graphic.duration,
    values: graphic.values,
  };
  return {
    edit: {
      ...placed.edit,
      tracks: placed.edit.tracks.map((t) => (t.id === placed.track.id ? { ...t, items: sortItems([...t.items, item]) } : t)),
    },
    id: item.id,
  };
}

// Cuts each of these items in two at `t` (those that span it). The right
// half gets a new id. Returns the ids of the right halves.
export function split(edit: Edit, ids: Set<string>, t: number): { edit: Edit; made: string[] } {
  const made: string[] = [];
  const tracks = edit.tracks.map((track) => {
    const items: Item[] = [];
    for (const item of track.items) {
      const inside = t > item.start + MIN_LENGTH / 2 && t < endOf(item) - MIN_LENGTH / 2;
      if (!ids.has(item.id) || !inside) {
        items.push(item);
        continue;
      }
      const left = t - item.start;
      const id = newItemId();
      made.push(id);
      if (item.type === "clip") {
        const cut = item.from + left * (item.speed ?? 1);
        items.push({ ...item, to: cut, fadeOut: undefined }, { ...item, id, start: t, from: cut, fadeIn: undefined });
      } else {
        items.push({ ...item, duration: left }, { ...item, id, start: t, duration: item.duration - left });
      }
    }
    return { ...track, items: sortItems(items) };
  });
  return { edit: { ...edit, tracks }, made };
}

// Removes these items. With `closeGap`, everything after each removed item
// on its track moves left by its length, so no hole is left.
export function remove(edit: Edit, ids: Set<string>, closeGap = false): Edit {
  return {
    ...edit,
    tracks: edit.tracks.map((track) => {
      const gone = track.items.filter((i) => ids.has(i.id));
      let items = track.items.filter((i) => !ids.has(i.id));
      if (closeGap) {
        // From the latest hole back, so earlier shifts don't move later holes.
        for (const g of [...gone].sort((a, b) => b.start - a.start)) {
          const length = lengthOf(g);
          items = items.map((i) => (i.start >= endOf(g) - 1e-6 ? { ...i, start: Math.max(0, i.start - length) } : i));
        }
      }
      return { ...track, items: sortItems(items) };
    }),
  };
}

// Copies these items to just after their originals, or to the end of
// their track when that spot is taken. Returns the copies' ids.
export function duplicate(edit: Edit, ids: Set<string>): { edit: Edit; made: string[] } {
  const made: string[] = [];
  const tracks = edit.tracks.map((track) => {
    let items = [...track.items];
    for (const item of track.items.filter((i) => ids.has(i.id))) {
      const length = lengthOf(item);
      const after = endOf(item);
      const free = !items.some((o) => o.start < after + length - 1e-6 && endOf(o) > after + 1e-6);
      const end = items.reduce((e, i) => Math.max(e, endOf(i)), 0);
      const id = newItemId();
      made.push(id);
      items = [...items, { ...item, id, start: free ? after : end }];
    }
    return { ...track, items: sortItems(items) };
  });
  return { edit: { ...edit, tracks }, made };
}

// ─── Captions ────────────────────────────────────────────────────────────────

// Caption words on the film's timeline, from the clips' transcripts: each
// clip contributes the words it actually plays, moved to where it sits.
export function captionsFromClips(edit: Edit, transcripts: Map<string, Word[]>): Word[] {
  const words: Word[] = [];
  for (const track of edit.tracks) {
    if (track.kind === "graphics" || track.muted) continue;
    for (const item of track.items) {
      if (item.type !== "clip") continue;
      const said = transcripts.get(item.media);
      if (!said) continue;
      const speed = item.speed ?? 1;
      for (const w of said) {
        // A word belongs to the clip that plays most of it, so a word cut in
        // two by a split still shows once.
        const middle = (w.start + w.end) / 2;
        if (middle < item.from || middle >= item.to) continue;
        words.push({
          ...w,
          start: item.start + Math.max(0, w.start - item.from) / speed,
          end: item.start + Math.max(0, Math.min(item.to, w.end) - item.from) / speed,
        });
      }
    }
  }
  return words.sort((a, b) => a.start - b.start);
}

// Words grouped into caption lines: a new line after 7 words, a pause of
// more than 0.6 s, or a full stop.
export type CaptionLine = { first: number; last: number; start: number; end: number; text: string };

export function captionLines(words: Word[]): CaptionLine[] {
  const lines: CaptionLine[] = [];
  let first = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    const count = i - first + 1;
    const breaks = !next || count >= 7 || next.start - w.end > 0.6 || /[.!?]$/.test(w.text);
    if (breaks) {
      const run = words.slice(first, i + 1);
      lines.push({ first, last: i, start: run[0].start, end: w.end, text: run.map((x) => x.text).join(" ") });
      first = i + 1;
    }
  }
  return lines;
}

// Replaces one caption line's words with new text, spreading the line's
// time across the new words by their length.
export function retypeLine(words: Word[], line: CaptionLine, text: string): Word[] {
  const parts = text.split(/\s+/).filter(Boolean);
  const span = line.end - line.start;
  const total = parts.reduce((n, p) => n + p.length + 1, 0) || 1;
  let at = line.start;
  const made: Word[] = parts.map((p) => {
    const length = (span * (p.length + 1)) / total;
    const word = { text: p, start: at, end: at + length };
    at += length;
    return word;
  });
  return [...words.slice(0, line.first), ...made, ...words.slice(line.last + 1)];
}
