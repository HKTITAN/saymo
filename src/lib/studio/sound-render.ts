import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { filmDir, readFilm, ROOT } from "./films";
import { claim, release } from "./heavy";
import type { SoundStatus } from "./sound";

// Renders films' sound with `scripts/studio/sound.mjs <id>`, one at a time
// and never while a video render runs (heavy.ts). The script keeps the
// film's status in sound/status.json as it goes, so the studio reads it
// from there; this queue only adds "waiting".

const g = globalThis as { __studioSounds?: { queue: string[]; running: string | null } };
const jobs = (g.__studioSounds ??= { queue: [], running: null });

export const soundDir = (id: string) => path.join(filmDir(id), "sound");
const statusFile = (id: string) => path.join(soundDir(id), "status.json");

async function record(id: string, status: SoundStatus) {
  const file = statusFile(id);
  mkdirSync(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, `${JSON.stringify(status, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
}

// Is sound.wav made from the score as it is now, at the film's length?
export async function soundIsCurrent(id: string) {
  const dir = soundDir(id);
  const [score, wav] = await Promise.all([
    stat(path.join(dir, "score.js")).catch(() => null),
    stat(path.join(dir, "sound.wav")).catch(() => null),
  ]);
  if (!score || !wav || wav.mtimeMs < score.mtimeMs) return false;
  const film = await readFilm(id);
  // A video film's sound follows its edit too (graphics, who speaks when).
  if (film?.kind === "video") {
    const edit = await stat(path.join(filmDir(id), "edit.json")).catch(() => null);
    if (edit && wav.mtimeMs < edit.mtimeMs) return false;
  }
  const saved = await readStatus(id);
  return Boolean(film && saved.state === "ready" && Math.abs(saved.duration - film.duration) < 0.002);
}

// Asks for the film's sound. Unless `force`, a sound that is already
// current is left as it is.
export async function startSound(id: string, force = false) {
  if (!existsSync(path.join(soundDir(id), "score.js"))) return;
  if (jobs.running === id || jobs.queue.includes(id)) return;
  if (!force && (await soundIsCurrent(id))) return;
  jobs.queue.push(id);
  await record(id, { state: "rendering", step: "Waiting for the other render to finish" }).catch(() => {});
  next();
}

// For changes that come in bursts (dragging on the timeline, a slider):
// renders once things have been still for a moment.
const timers = new Map<string, ReturnType<typeof setTimeout>>();
export function soundLater(id: string, wait = 2500) {
  clearTimeout(timers.get(id));
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      void startSound(id);
    }, wait),
  );
}

function next() {
  if (jobs.running || !jobs.queue.length) return;
  if (!claim("sound", next)) return;
  const id = jobs.queue.shift()!;
  jobs.running = id;
  const child = spawn(process.execPath, ["scripts/studio/sound.mjs", id, "--quiet"], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let said = "";
  child.stderr?.on("data", (c: Buffer) => {
    said = (said + c).slice(-2000);
  });
  let ended = false;
  const done = async (ok: boolean) => {
    if (ended) return;
    ended = true;
    // The script records its own success and most failures; this covers a
    // crash before it could.
    const saved = await readStatus(id);
    if (!ok && saved.state !== "failed") {
      await record(id, { state: "failed", message: plain(said), at: new Date().toISOString() }).catch(() => {});
    }
    jobs.running = null;
    release("sound");
    next();
  };
  child.on("exit", (code) => done(code === 0));
  child.on("error", () => done(false));
}

function plain(text: string) {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .find((l) => !/^at |^node:|^Node\.js v/.test(l));
  return line ? line.slice(0, 240) : "The sound stopped before it finished.";
}

export async function readStatus(id: string): Promise<SoundStatus> {
  const saved = await readFile(statusFile(id), "utf8")
    .then((t) => JSON.parse(t) as SoundStatus)
    .catch(() => null);
  return saved ?? { state: "none" };
}

export async function soundStatus(id: string): Promise<SoundStatus> {
  if (jobs.queue.includes(id)) return { state: "rendering", step: "Waiting for the other render to finish" };
  const saved = await readStatus(id);
  // A render the chat started runs outside this queue and keeps its status
  // fresh; one left behind by a restart mid-render goes stale.
  if (saved.state === "rendering" && jobs.running !== id) {
    const age = Date.now() - ((await stat(statusFile(id)).catch(() => null))?.mtimeMs ?? 0);
    if (age > 5 * 60_000) {
      return { state: "failed", message: "The last sound render stopped part way. Render it again.", at: new Date().toISOString() };
    }
  }
  return saved;
}
