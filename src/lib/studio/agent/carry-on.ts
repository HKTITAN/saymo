import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProviderId } from "./ai-types";
import type { ChatContext } from "../films/contract";
import { FILMS_DIR, filmDir } from "../films/films";

// When a turn can't finish, the studio carries on by itself so nobody has to
// type "carry on":
// - "time": the turn ran into the studio's 15-minute cap. The next turn
//   starts a moment later, up to MAX_IN_A_ROW times in a row.
// - "limit": the AI plan's usage limit was reached. The next turn starts
//   when the limit resets (read from the AI's message), or after a wait
//   that grows each time if it doesn't say.
// The plan is saved beside the film (.history/carry-on.json), so it survives
// the page closing and the studio restarting. Sending a new prompt or
// pressing Stop cancels it; a new prompt is told to finish the old work too.

export type CarryOnReason = "time" | "limit";
export type CarryOn = {
  reason: CarryOnReason;
  at: string; // ISO: when the next turn starts
  count: number; // automatic turns in a row so far
  provider: ProviderId;
  context: ChatContext;
};

export const MAX_IN_A_ROW = 5;
export const CARRY_ON_PROMPT =
  "Carry on where you stopped. Read the film's files to see what's already done, finish the rest of the earlier request, and don't redo finished parts.";

const file = (id: string) => path.join(filmDir(id), ".history", "carry-on.json");

// Timers live on globalThis so a hot reload in development doesn't start a
// second one for the same film.
type Timers = Map<string, ReturnType<typeof setTimeout>>;
const g = globalThis as unknown as { __studioCarryOn?: Timers; __studioCarryOnRestored?: boolean };
const timers: Timers = (g.__studioCarryOn ??= new Map());

export async function readCarryOn(id: string): Promise<CarryOn | null> {
  try {
    const raw = JSON.parse(await readFile(file(id), "utf8")) as CarryOn;
    return raw && (raw.reason === "time" || raw.reason === "limit") && typeof raw.at === "string" ? raw : null;
  } catch {
    return null;
  }
}

export async function cancelCarryOn(id: string) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  await rm(file(id), { force: true });
}

// Plans the next automatic turn. `run` starts it; it's passed in so this file
// doesn't import the turn runner (which imports this one).
export async function planCarryOn(id: string, plan: CarryOn, run: (id: string, plan: CarryOn) => void) {
  await writeFile(file(id), `${JSON.stringify(plan, null, 2)}\n`);
  arm(id, plan, run);
}

function arm(id: string, plan: CarryOn, run: (id: string, plan: CarryOn) => void) {
  clearTimeout(timers.get(id));
  // setTimeout can't wait longer than about 24 days; limits reset far sooner.
  const wait = Math.min(Math.max(0, Date.parse(plan.at) - Date.now()), 2 ** 31 - 1);
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      void (async () => {
        const now = await readCarryOn(id);
        if (!now || now.at !== plan.at) return; // cancelled or replanned
        await rm(file(id), { force: true });
        run(id, now);
      })();
    }, wait),
  );
}

// After a restart, picks the saved plans back up (once per server).
export async function restoreCarryOns(run: (id: string, plan: CarryOn) => void) {
  if (g.__studioCarryOnRestored) return;
  g.__studioCarryOnRestored = true;
  const ids = await readdir(FILMS_DIR).catch(() => [] as string[]);
  for (const id of ids) {
    const plan = await readCarryOn(id);
    if (plan && !timers.has(id)) arm(id, plan, run);
  }
}

// When a usage limit resets, from the AI's own words. Returns null when the
// message doesn't say.
export function limitResetsAt(raw: string, now = new Date()): Date | null {
  // Claude Code's older form: "...limit reached|1730550000" (seconds).
  const epoch = /\|\s*(\d{10})\b/.exec(raw);
  if (epoch) return new Date(Number(epoch[1]) * 1000);
  // "try again in 23 minutes", "in 2 hours"
  const inMatch = /\bin\s+(\d+)\s*(second|minute|min|hour|hr)s?\b/i.exec(raw);
  if (inMatch) {
    const n = Number(inMatch[1]);
    const unit = inMatch[2].toLowerCase();
    const ms = unit.startsWith("s") ? n * 1000 : unit.startsWith("h") ? n * 3600_000 : n * 60_000;
    return new Date(now.getTime() + ms);
  }
  // "resets 7pm", "resets at 7:30 pm", "reset at 19:00"
  const at = /reset[s]?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(raw);
  if (at) {
    let hour = Number(at[1]) % 24;
    const minute = at[2] ? Number(at[2]) : 0;
    const ampm = at[3]?.toLowerCase();
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    const when = new Date(now);
    when.setHours(hour, minute, 0, 0);
    if (when.getTime() <= now.getTime()) when.setDate(when.getDate() + 1);
    return when;
  }
  return null;
}

export const isUsageLimit = (raw: string) => /usage limit|limit reached|hit your limit|rate limit|too many requests|\b429\b/i.test(raw);

// "7:05 pm" in the person's own clock.
export const clockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).toLowerCase();
