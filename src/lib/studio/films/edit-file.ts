// A video film's edit.json as everything that plays it should see it: with
// words turned into seconds (anchors.ts). The server, the stage, renders,
// the sound design and the film checker all read the edit through here, so
// a graphic on a word lands in the same place everywhere.
//
// Plain TypeScript with no `@/` imports, so Node scripts can import it too.

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { type Resolved, resolveEdit, type Transcripts } from "./anchors.ts";
import type { Edit, Word } from "./edit.ts";

// The files whose words the edit can hang on: every file a clip plays.
const usedMedia = (edit: Edit) =>
  [...new Set(edit.tracks.flatMap((t) => t.items.flatMap((i) => (i.type === "clip" ? [i.media] : []))))].filter((m) =>
    /^[A-Za-z0-9_-]{1,40}$/.test(m),
  );

const transcriptFile = (filmDir: string, media: string) => path.join(filmDir, "media", media, "transcript.json");
const asWords = (raw: unknown): Word[] | undefined => (Array.isArray(raw) ? (raw as Word[]) : undefined);

export async function readTranscripts(filmDir: string, edit: Edit): Promise<Transcripts> {
  const entries = await Promise.all(
    usedMedia(edit).map(async (m) => {
      const raw = await readFile(transcriptFile(filmDir, m), "utf8").catch(() => null);
      return [m, raw ? asWords(JSON.parse(raw)) : undefined] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export function readTranscriptsSync(filmDir: string, edit: Edit): Transcripts {
  const out: Transcripts = {};
  for (const m of usedMedia(edit)) {
    try {
      out[m] = asWords(JSON.parse(readFileSync(transcriptFile(filmDir, m), "utf8")));
    } catch {
      out[m] = undefined;
    }
  }
  return out;
}

// The edit with every anchor turned into seconds, its sound marks and any
// notes, or null if edit.json is missing or unreadable.
export async function readResolvedEdit(filmDir: string): Promise<Resolved | null> {
  let edit: Edit;
  try {
    edit = JSON.parse(await readFile(path.join(filmDir, "edit.json"), "utf8")) as Edit;
  } catch {
    return null;
  }
  if (!Array.isArray(edit?.tracks)) return null;
  return resolveEdit(edit, await readTranscripts(filmDir, edit));
}
