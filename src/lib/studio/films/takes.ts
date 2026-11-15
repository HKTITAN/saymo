import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProviderId } from "../agent/ai-types";
import { asksForThree, TAKE_COUNT, TAKE_WAYS, type Take, type Takes } from "./takes-shared";
import { isRunning, notePicked, readChat, runTurn, stopTurn } from "../agent/claude";
import type { ChatContext, ChatEvent, Film } from "./contract";
import { deleteFilm, duplicateFilm, filmDir, readFilm, recordVersion, snapshotFilm, withFilm, writeFilm } from "./films";
import { startSound } from "../sound/sound-render";

// Three versions at once: only when the person asks (the chat's "Try 3"
// button, or a prompt asking for three versions). Each version is a hidden
// copy of the film (film.json `take`) with a normal turn run on it, all
// three at the same time, each told to go a different way. The person
// watches them side by side and picks one: its files replace the film's as
// one step (undo and Versions bring the old one back), and the copies are
// deleted. Nothing changes the film until a pick.

export type { Take, Takes } from "./takes-shared";

const file = (id: string) => path.join(filmDir(id), ".history", "takes.json");

const g = globalThis as { __studioTakes?: Map<string, Takes> };
const live = (g.__studioTakes ??= new Map<string, Takes>());

async function save(id: string, takes: Takes) {
  live.set(id, takes);
  await mkdir(path.dirname(file(id)), { recursive: true });
  await writeFile(`${file(id)}.tmp`, `${JSON.stringify(takes, null, 2)}\n`);
  await rename(`${file(id)}.tmp`, file(id));
}

export async function readTakes(id: string): Promise<Takes | null> {
  const known =
    live.get(id) ??
    (await readFile(file(id), "utf8")
      .then((t) => JSON.parse(t) as Takes)
      .catch(() => null));
  if (!known) return null;
  // A version still marked working with no turn running stopped with the
  // studio (a restart, say).
  return { ...known, takes: known.takes.map((t: Take) => (t.state === "working" && !isRunning(t.id) ? { ...t, state: "stopped" as const } : t)) };
}

const takeNote = (n: number) =>
  `<takes>They asked for ${TAKE_COUNT} versions of this change at once. Each is made in its own copy of the film, at the same time, and they'll pick one. This is version ${n} of ${TAKE_COUNT}: ${TAKE_WAYS[n - 1].note} Make it clearly different from the other two. Finish it without asking questions, and end with one short sentence on what makes this version different.</takes>`;

export async function startTakes(id: string, prompt: string, context: ChatContext, provider: ProviderId): Promise<Takes | string> {
  const film = await readFilm(id);
  if (!film || film.take) return "That film no longer exists.";
  if (isRunning(id)) return "Claude is still working on this film. Wait for it, or stop it first.";
  const before = await readTakes(id);
  if (before?.takes.some((t) => t.state === "working")) return "Three versions are already being made for this film.";
  if (before) await discardTakes(id);

  const takes: Takes = { prompt, at: new Date().toISOString(), provider, takes: [] };
  const chat = await readChat(id).catch(() => []);
  for (let n = 1; n <= TAKE_COUNT; n++) {
    const copy = await duplicateFilm(id);
    if (!copy) return "Unable to copy the film. Try again.";
    await writeFilm({ ...copy, title: `${film.title} (version ${n})`, take: { of: id, n } });
    // The chat so far, so each version knows what came before.
    if (chat.length) {
      await mkdir(path.join(filmDir(copy.id), ".history"), { recursive: true });
      await writeFile(path.join(filmDir(copy.id), ".history", "chat.json"), `${JSON.stringify(chat, null, 2)}\n`);
    }
    takes.takes.push({ id: copy.id, n, state: "working", step: "Starting", reply: "", error: null });
  }
  await save(id, takes);

  for (const take of takes.takes) {
    const update = (patch: Partial<Take>) => {
      const now = live.get(id);
      if (!now) return;
      const next = { ...now, takes: now.takes.map((t) => (t.id === take.id ? { ...t, ...patch } : t)) };
      void save(id, next).catch(() => {});
    };
    let reply = "";
    const emit = (e: ChatEvent) => {
      if (e.kind === "step") update({ step: e.label });
      else if (e.kind === "text") reply += e.text;
      else if (e.kind === "error") update({ error: e.message });
    };
    void runTurn(take.id, { prompt: `${prompt}\n\n${takeNote(take.n)}`, context, provider }, emit)
      .then(async () => {
        const now = live.get(id)?.takes.find((t: Take) => t.id === take.id);
        if (!now || now.state === "stopped") return;
        // Its words as the turn saved them (the streamed pieces can be empty).
        const last = (await readChat(take.id).catch(() => [])).findLast((m) => m.role === "claude")?.text ?? "";
        const saved = last === "Done." ? "" : last;
        update({ state: now.error ? "failed" : "done", step: null, reply: (saved || reply).trim().slice(-600) });
      })
      .catch((e) => update({ state: "failed", step: null, error: String((e as Error)?.message ?? e) }));
  }
  return takes;
}

// Keeps version `takeId`: the film's files become that version's, as one
// step, and all three copies go.
export async function pickTake(id: string, takeId: string): Promise<string | null> {
  const takes = await readTakes(id);
  const take = takes?.takes.find((t: Take) => t.id === takeId);
  if (!takes || !take) return "Those versions are gone. Ask for them again.";
  if (take.state === "working") return "That version isn't finished yet.";
  const chosen = await readFilm(take.id);
  const film = await readFilm(id);
  if (!chosen || !film) return "That version is gone. Ask for them again.";
  for (const t of takes.takes) if (t.id !== take.id) stopTurn(t.id);

  await withFilm(id, async () => {
    // Before it changes: a version to go back to, named after the prompt.
    const n = await snapshotFilm(id);
    await recordVersion(id, n, asksForThree(takes.prompt) ? takes.prompt : `Make 3 versions: ${takes.prompt}`, 0);
    const dir = filmDir(id);
    const from = filmDir(take.id);
    const own = new Set(["out", ".history", "film.json", "media", "node_modules", "target", ".hyperframes"]);
    for (const name of await readdir(dir)) if (!own.has(name)) await rm(path.join(dir, name), { recursive: true, force: true });
    for (const name of await readdir(from)) {
      if (own.has(name)) continue;
      await cp(path.join(from, name), path.join(dir, name), { recursive: true });
    }
    // film.json: the version's settings, the film's own name and place.
    const next: Film = {
      ...chosen,
      id,
      title: film.title,
      folder: film.folder,
      createdAt: film.createdAt,
      session: film.session,
      updatedAt: new Date().toISOString(),
    };
    delete next.take;
    await writeFilm(next);
  });
  await notePicked(id, takes.prompt, take.n, take.reply);
  await discardTakes(id);
  if (existsSync(path.join(filmDir(id), "sound"))) void startSound(id);
  return null;
}

// Stops any version still being made and deletes the copies.
export async function discardTakes(id: string) {
  const takes = await readTakes(id);
  live.delete(id);
  await rm(file(id), { force: true });
  for (const t of takes?.takes ?? []) {
    stopTurn(t.id);
    // A stopped turn takes a moment to let go of its files.
    for (let i = 0; i < 20 && isRunning(t.id); i++) await new Promise((r) => setTimeout(r, 150));
    const copy = await readFilm(t.id);
    if (copy?.take?.of === id) await deleteFilm(t.id);
  }
}
