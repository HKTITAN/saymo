import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { STUDIO_DIR } from "./connect-store";

// The person's list of things to make, on the Ideas page: reels, demos and
// videos, each still to make, made, or let go. Kept on this Mac in
// .studio/ideas.json, out of the project's history like the rest of .studio.

export type IdeaKind = "reel" | "demo" | "video";
export type IdeaState = "todo" | "made" | "skip";
// `at`: when it was added; `doneAt`: when it was ticked off as made.
export type Idea = { id: string; kind: IdeaKind; text: string; state: IdeaState; at: string; doneAt?: string };

const FILE = path.join(STUDIO_DIR, "ideas.json");
const KINDS: readonly IdeaKind[] = ["reel", "demo", "video"];
const STATES: readonly IdeaState[] = ["todo", "made", "skip"];
export const MAX_IDEAS = 500;

// Only what the page needs, checked, from whatever came in.
export function cleanIdeas(raw: unknown): Idea[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const out: Idea[] = [];
  for (const item of raw.slice(0, MAX_IDEAS)) {
    const x = (item ?? {}) as Partial<Record<keyof Idea, unknown>>;
    const id = typeof x.id === "string" && /^[a-z0-9]{6,16}$/.test(x.id) ? x.id : null;
    const text = typeof x.text === "string" ? x.text.replace(/\s+/g, " ").trim().slice(0, 280) : "";
    if (!id || !text || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      kind: KINDS.includes(x.kind as IdeaKind) ? (x.kind as IdeaKind) : "reel",
      text,
      state: STATES.includes(x.state as IdeaState) ? (x.state as IdeaState) : "todo",
      at: typeof x.at === "string" && !Number.isNaN(Date.parse(x.at)) ? x.at : new Date().toISOString(),
      ...(x.state === "made" && typeof x.doneAt === "string" && !Number.isNaN(Date.parse(x.doneAt)) ? { doneAt: x.doneAt } : {}),
    });
  }
  return out;
}

export async function readIdeas(): Promise<Idea[]> {
  try {
    return cleanIdeas(JSON.parse(await readFile(FILE, "utf8"))) ?? [];
  } catch {
    return [];
  }
}

export async function writeIdeas(list: Idea[]) {
  await mkdir(STUDIO_DIR, { recursive: true, mode: 0o700 });
  await writeFile(`${FILE}.tmp`, `${JSON.stringify(list, null, 2)}\n`, { mode: 0o600 });
  await rename(`${FILE}.tmp`, FILE);
}
