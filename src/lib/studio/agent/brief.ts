import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { filmDir } from "../films/films";

// The blank-page brief for a motion film (the blank-page skill's "In Motion
// Studio" section): the look, its references, the beats and up to three
// creative calls. Claude writes it to films/<id>/brief.json from a one-line
// prompt, before building; the studio shows it on the empty stage, where
// the person flips a call to its alternative, then makes the film from it
// or asks for another look.

export type BriefRef = { id: string; kind: "look" | "motion" | "asset"; role: string; use: string; file: string };
export type BriefCall = { choice: string; alternative: string; swapped?: boolean };
export type Brief = { look: string; refs: BriefRef[]; beats: string[]; frame: string; calls: BriefCall[]; state: "brief" | "made" };

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
// A reference's file: a plain path inside the film's look/ folder.
const lookFile = (v: unknown) => (typeof v === "string" && /^look\/[\w.-]+(\/[\w.-]+)*$/.test(v) && !v.split("/").includes("..") ? v : "");
const record = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export function cleanBrief(raw: unknown): Brief | null {
  const r = record(raw);
  const beats = (Array.isArray(r.beats) ? r.beats : []).map((b) => text(b, 400)).filter(Boolean).slice(0, 12);
  if (!beats.length) return null;
  const refs = (Array.isArray(r.refs) ? r.refs : []).flatMap((x): BriefRef[] => {
    const o = record(x);
    const file = lookFile(o.file);
    const kind = o.kind === "motion" || o.kind === "asset" ? o.kind : "look";
    return file ? [{ id: text(o.id, 8), kind, role: text(o.role, 40), use: text(o.use, 160), file }] : [];
  });
  const calls = (Array.isArray(r.calls) ? r.calls : []).flatMap((x): BriefCall[] => {
    const o = record(x);
    const choice = text(o.choice, 120);
    const alternative = text(o.alternative, 120);
    return choice && alternative ? [{ choice, alternative, ...(o.swapped === true ? { swapped: true } : {}) }] : [];
  });
  return {
    look: text(r.look, 60) || "Untitled look",
    refs: refs.slice(0, 12),
    beats,
    frame: text(r.frame, 200),
    calls: calls.slice(0, 3),
    state: r.state === "made" ? "made" : "brief",
  };
}

export async function readBrief(id: string): Promise<Brief | null> {
  try {
    return cleanBrief(JSON.parse(await readFile(path.join(filmDir(id), "brief.json"), "utf8")));
  } catch {
    return null;
  }
}

export async function writeBrief(id: string, brief: Brief) {
  const file = path.join(filmDir(id), "brief.json");
  await writeFile(`${file}.tmp`, `${JSON.stringify(brief, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
}
