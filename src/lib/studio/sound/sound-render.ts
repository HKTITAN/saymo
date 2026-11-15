import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { filmDir, readFilm, ROOT } from "../films/films";
import { claim, release } from "../server/heavy";
import type { SoundMix, SoundSpan, SoundStatus } from "./sound";
import { GAIN_MAX, GAIN_MIN, placeSpan } from "./sound-mix";

// Renders films' sound with `scripts/studio/sound.mjs <id>`, one at a time
// and never while a video render runs (heavy.ts). The script keeps the
// film's status in sound/status.json as it goes, so the studio reads it
// from there; this queue only adds "waiting".

const g = globalThis as {
  __studioSounds?: { queue: string[]; running: string | null };
  __studioMixes?: { mixing: Map<string, Promise<void>>; after: Set<string> };
};
const jobs = (g.__studioSounds ??= { queue: [], running: null });
// Mixing the stems again for volume edits (remixSound). Light, so it skips
// the heavy queue; but never at the same time as a render of the same film.
const mixes = (g.__studioMixes ??= { mixing: new Map(), after: new Set() });

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
  const [score, wav, voice] = await Promise.all([
    stat(path.join(dir, "score.js")).catch(() => null),
    stat(path.join(dir, "sound.wav")).catch(() => null),
    stat(path.join(dir, "voice.json")).catch(() => null),
  ]);
  if ((!score && !voice) || !wav || wav.mtimeMs < (score?.mtimeMs ?? 0)) return false;
  // A slide film's voiceover moved or changed.
  if (voice && wav.mtimeMs < voice.mtimeMs) return false;
  // Volume edits saved but not mixed in yet.
  const mix = await stat(path.join(dir, "mix.json")).catch(() => null);
  if (mix && wav.mtimeMs < mix.mtimeMs) return false;
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
  // A score, or a voiceover (a film made from slides) with or without one.
  if (!existsSync(path.join(soundDir(id), "score.js")) && !existsSync(path.join(soundDir(id), "voice.json"))) return;
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
  // A film being mixed again waits for that (which calls this when done).
  const i = jobs.queue.findIndex((q) => !mixes.mixing.has(q));
  if (i < 0) return;
  if (!claim("sound", next)) return;
  const id = jobs.queue.splice(i, 1)[0];
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
    // Volume edits made while it rendered: the render may have read the old
    // ones, so mix again.
    if (mixes.after.delete(id)) void remixSound(id);
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

// ─── Volume edits (mix.json) ──────────────────────────────────────────────

const mixFile = (id: string) => path.join(soundDir(id), "mix.json");

export async function readMix(id: string): Promise<SoundMix> {
  const raw = await readFile(mixFile(id), "utf8")
    .then((t) => JSON.parse(t) as unknown)
    .catch(() => null);
  return { spans: cleanSpans((raw as { spans?: unknown } | null)?.spans, Infinity) };
}

// Only well-formed spans, inside the film, that change something; a later
// span wins where it overlaps an earlier one on the same stem.
export function cleanSpans(raw: unknown, duration: number): SoundSpan[] {
  if (!Array.isArray(raw)) return [];
  let out: SoundSpan[] = [];
  for (const s of raw.slice(0, 200) as Partial<SoundSpan>[]) {
    if (!s || (s.stem !== "music" && s.stem !== "effects" && s.stem !== "voice")) continue;
    const from = Math.max(0, Math.min(duration, Number(s.from)));
    const to = Math.max(0, Math.min(duration, Number(s.to)));
    if (!Number.isFinite(from) || !Number.isFinite(to) || to - from < 0.001) continue;
    const gain = Number.isFinite(Number(s.gain)) ? Math.max(GAIN_MIN, Math.min(GAIN_MAX, Number(s.gain))) : 0;
    out = placeSpan(out, { stem: s.stem, from, to, gain, mute: s.mute === true });
  }
  return out;
}

export async function writeMix(id: string, spans: SoundSpan[]) {
  const file = mixFile(id);
  mkdirSync(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, `${JSON.stringify({ spans }, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
}

// Mixes the kept stems again with mix.json: no score is played, so it's
// about a second. A sound rendered before stems existed is rendered whole
// instead (which applies the edits too). Edits that arrive while the film's
// sound renders are mixed in once it ends.
export function remixSound(id: string): Promise<void> {
  if (jobs.running === id || jobs.queue.includes(id)) {
    mixes.after.add(id);
    return Promise.resolve();
  }
  const before = mixes.mixing.get(id) ?? Promise.resolve();
  const run = before.then(
    () =>
      new Promise<void>((resolve) => {
        const child = spawn(process.execPath, ["scripts/studio/sound.mjs", id, "--mix", "--quiet"], {
          cwd: ROOT,
          stdio: ["ignore", "ignore", "ignore"],
        });
        child.on("exit", (code) => {
          // No stems yet: render it whole.
          if (code === 3) void startSound(id, true);
          resolve();
        });
        child.on("error", () => resolve());
      }),
  );
  mixes.mixing.set(id, run);
  void run.finally(() => {
    if (mixes.mixing.get(id) === run) mixes.mixing.delete(id);
    next();
  });
  return run;
}
