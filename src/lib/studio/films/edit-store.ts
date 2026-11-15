import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Param } from "./contract";
import { resolveEdit } from "./anchors";
import { type Anchor, type CaptionFix, type Clip, cleanBox, type Edit, type EditMark, editEnd, type Graphic, type Track, type Word } from "./edit";
import { readResolvedEdit, readTranscripts } from "./edit-file";
import { filmDir, readFilm, withFilm, writeFilm } from "./films";
import { graphicNames } from "./graphics";
import { listMedia } from "./media";

// A video film's edit.json: read, checked and saved. Saving also keeps
// film.json's length in step with where the edit ends. Both reading and
// saving turn words into seconds (anchors.ts), so the file always holds the
// seconds its anchors resolve to, even right after Claude wrote it.

const editFile = (id: string) => path.join(filmDir(id), "edit.json");

export async function readEdit(id: string): Promise<Edit | null> {
  return (await readResolvedEdit(filmDir(id)))?.edit ?? null;
}

export async function saveEdit(id: string, raw: Edit) {
  const edit = resolveEdit(raw, await readTranscripts(filmDir(id), raw)).edit;
  return withFilm(id, async () => {
    const film = await readFilm(id);
    if (!film) return null;
    const file = editFile(id);
    await writeFile(`${file}.tmp`, `${JSON.stringify(edit, null, 2)}\n`);
    await rename(`${file}.tmp`, file);
    const duration = Math.max(1, Math.round(editEnd(edit) * 1000) / 1000);
    await writeFilm({ ...film, duration, updatedAt: new Date().toISOString() });
    return edit;
  });
}

// ─── Checking what the page sends ────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, min = -Infinity, max = Infinity) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const optNum = (v: unknown, min: number, max: number) => v === undefined || num(v, min, max);
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const WORD_REF = /^[A-Za-z0-9_-]{1,40}:\d{1,7}$/;

// A word anchor as edit.ts has it, or null if it isn't one.
function cleanAnchor(raw: unknown): Anchor | null {
  if (!isObject(raw) || typeof raw.word !== "string" || !WORD_REF.test(raw.word)) return null;
  const a: Anchor = { word: raw.word };
  if (raw.edge !== undefined) {
    if (raw.edge !== "start" && raw.edge !== "end") return null;
    a.edge = raw.edge;
  }
  if (raw.offset !== undefined) {
    if (!num(raw.offset, -60, 60)) return null;
    a.offset = raw.offset as number;
  }
  if (raw.clip !== undefined) {
    if (typeof raw.clip !== "string" || !ID.test(raw.clip)) return null;
    a.clip = raw.clip;
  }
  return a;
}
const TRACK_KINDS = ["video", "graphics", "audio"];
const LONGEST = 4 * 60 * 60; // four hours

export async function checkEdit(id: string, body: unknown): Promise<Edit | string> {
  if (!isObject(body) || (body.version !== 1 && body.version !== 2) || !Array.isArray(body.tracks)) return "That isn't an edit the studio can read.";
  const media = new Map((await listMedia(id)).map((m) => [m.id, m]));
  const graphics = new Set(await graphicNames(id));
  const ids = new Set<string>();
  const tracks: Track[] = [];
  if (body.tracks.length > 40) return "An edit holds up to 40 tracks.";
  for (const raw of body.tracks) {
    if (!isObject(raw) || typeof raw.id !== "string" || !ID.test(raw.id) || !TRACK_KINDS.includes(raw.kind as string)) {
      return "One of the tracks isn't set up right.";
    }
    if (ids.has(raw.id)) return "Two tracks share a name.";
    ids.add(raw.id);
    if (!Array.isArray(raw.items)) return "One of the tracks has no list of items.";
    const items: (Clip | Graphic)[] = [];
    for (const it of raw.items) {
      if (!isObject(it) || typeof it.id !== "string" || !ID.test(it.id)) return "One of the items on the timeline has no proper name.";
      if (ids.has(it.id)) return "Two items on the timeline share a name.";
      ids.add(it.id);
      if (!num(it.start, 0, LONGEST)) return "An item starts at a time the studio can't use.";
      if (it.type === "clip") {
        const m = typeof it.media === "string" ? media.get(it.media) : undefined;
        if (!m) return "A clip uses a file that isn't in this film.";
        if (!num(it.from, 0, LONGEST) || !num(it.to, 0, LONGEST) || (it.to as number) - (it.from as number) < 0.01) {
          return "A clip's in and out points don't make sense.";
        }
        if (m.kind !== "image" && m.duration !== null && (it.to as number) > m.duration + 0.05) {
          return `A clip runs past the end of ${m.name}.`;
        }
        if (!optNum(it.speed, 0.1, 8)) return "Clip speed goes from 0.1 to 8 times.";
        if (!optNum(it.volume, 0, 2)) return "Clip volume goes from 0 to 2.";
        if (!optNum(it.fadeIn, 0, 30) || !optNum(it.fadeOut, 0, 30)) return "Fades are 0 to 30 seconds.";
        if (!optNum(it.zoom, 1, 10)) return "Zoom goes from 1 to 10.";
        if (!optNum(it.x, 0, 1) || !optNum(it.y, 0, 1)) return "A clip's framing is between 0 and 1.";
        if (!optNum(it.radius, 0, 0.25)) return "A clip's corner radius goes from 0 to 0.25 of the frame's width.";
        const clip: Clip = { id: it.id, type: "clip", media: m.id, start: it.start as number, from: it.from as number, to: it.to as number };
        for (const k of ["speed", "volume", "fadeIn", "fadeOut", "zoom", "x", "y", "radius"] as const) {
          if (it[k] !== undefined) clip[k] = it[k] as number;
        }
        if (it.box !== undefined) {
          const box = cleanBox(it.box);
          if (!box) return "A clip's box must sit inside the frame (x, y, w and h from 0 to 1).";
          clip.box = box;
        }
        if (it.cutout !== undefined) {
          if (typeof it.cutout !== "boolean") return "A clip's cutout is true or false.";
          if (it.cutout) clip.cutout = true;
        }
        if (it.window !== undefined) {
          const shown = cleanBox(it.window);
          if (!shown) return "A clip's window must sit inside the frame (x, y, w and h from 0 to 1).";
          clip.window = shown;
        }
        items.push(clip);
      } else if (it.type === "graphic") {
        if (typeof it.graphic !== "string" || !graphics.has(it.graphic)) return "A graphic on the timeline isn't one the studio has.";
        if (!num(it.duration, 0.1, LONGEST)) return "A graphic's length doesn't make sense.";
        const values: Record<string, Param["value"]> = {};
        if (it.values !== undefined) {
          if (!isObject(it.values)) return "A graphic's settings aren't readable.";
          for (const [k, v] of Object.entries(it.values)) {
            if (typeof v === "string") values[k] = v.slice(0, 2000);
            else if (typeof v === "boolean" || num(v)) values[k] = v as number | boolean;
          }
        }
        const g: Graphic = { id: it.id, type: "graphic", graphic: it.graphic, start: it.start as number, duration: it.duration as number, values };
        for (const k of ["at", "until"] as const) {
          if (it[k] === undefined) continue;
          const anchor = cleanAnchor(it[k]);
          if (!anchor) return "A graphic is fixed to a word the studio can't read.";
          g[k] = anchor;
        }
        items.push(g);
      } else return "The timeline holds clips and graphics only.";
    }
    const track: Track = { id: raw.id, kind: raw.kind as Track["kind"], name: typeof raw.name === "string" ? raw.name.slice(0, 60) : "Track", items };
    if (raw.muted === true) track.muted = true;
    if (raw.hidden === true) track.hidden = true;
    tracks.push(track);
  }
  const c = isObject(body.captions) ? body.captions : {};
  const words: Word[] = [];
  if (c.words !== undefined) {
    if (!Array.isArray(c.words) || c.words.length > 200000) return "The captions aren't readable.";
    for (const w of c.words) {
      if (!isObject(w) || typeof w.text !== "string" || !num(w.start, 0, LONGEST) || !num(w.end, 0, LONGEST)) return "One of the caption words isn't readable.";
      words.push({
        text: w.text.slice(0, 80),
        start: w.start as number,
        end: w.end as number,
        ...(num(w.confidence, 0, 1) ? { confidence: w.confidence as number } : {}),
        ...(w.hit === true ? { hit: true } : {}),
      });
    }
  }
  const style = ["words", "lines", "karaoke", "serif"].includes(c.style as string) ? (c.style as Edit["captions"]["style"]) : "lines";
  const position = c.position === "middle" ? "middle" : "bottom";
  const background = typeof body.background === "string" && /^#[0-9a-f]{6}$/i.test(body.background) ? body.background.toUpperCase() : "#141414";
  const tag = typeof c.tag === "string" ? c.tag.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  let fixes: Record<string, CaptionFix> | undefined;
  if (c.fixes !== undefined) {
    if (!isObject(c.fixes) || Object.keys(c.fixes).length > 200000) return "The caption fixes aren't readable.";
    fixes = {};
    for (const [ref, raw] of Object.entries(c.fixes)) {
      if (!WORD_REF.test(ref) || !isObject(raw)) return "One of the caption fixes isn't readable.";
      const fix: CaptionFix = {};
      if (typeof raw.text === "string") fix.text = raw.text.slice(0, 80);
      if (typeof raw.hit === "boolean") fix.hit = raw.hit;
      if (raw.hidden === true) fix.hidden = true;
      fixes[ref] = fix;
    }
  }
  let marks: EditMark[] | undefined;
  if (body.marks !== undefined) {
    if (!Array.isArray(body.marks) || body.marks.length > 200) return "The edit's moments aren't readable (up to 200).";
    marks = [];
    for (const raw of body.marks) {
      const at = isObject(raw) ? cleanAnchor(raw.at) : null;
      if (!isObject(raw) || typeof raw.label !== "string" || !raw.label.trim() || !at) return "One of the edit's moments isn't readable.";
      marks.push({ label: raw.label.replace(/\s+/g, " ").trim().slice(0, 60), at });
    }
  }
  const anchored = Boolean(fixes || marks || tracks.some((t) => t.items.some((i) => i.type === "graphic" && (i.at || i.until))));
  return {
    version: anchored ? 2 : 1,
    tracks,
    captions: { on: c.on === true, style, words, position, ...(tag ? { tag } : {}), ...(fixes ? { fixes } : {}) },
    background,
    ...(marks ? { marks } : {}),
  };
}
