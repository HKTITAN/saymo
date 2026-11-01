import { randomBytes } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Engine, Film, FilmEdit, FilmSummary } from "./contract";

// The studio's films live in films/<id>/: film.json plus whatever the
// film's engine needs (see contract.ts). Nothing else stores them, so the
// folder is the backup. Shared by the engines, the Claude bridge and the
// routes; keep it free of anything engine-specific.

export const ROOT = process.cwd();
export const FILMS_DIR = path.join(ROOT, "films");
export const STARTERS_DIR = path.join(ROOT, "studio/starters");
export const isId = (id: string) => /^[a-z0-9]{8}$/.test(id);
export const filmDir = (id: string) => path.join(FILMS_DIR, id);
export const outDir = (id: string) => path.join(filmDir(id), "out");
const filmFile = (id: string) => path.join(filmDir(id), "film.json");
const historyDir = (id: string) => path.join(filmDir(id), ".history");

const g = globalThis as { __filmLocks?: Map<string, Promise<unknown>> };

// One change at a time per film: edits, Claude turns, undo and renders read
// the folder, change it and write it back, and must not overlap.
const locks = (g.__filmLocks ??= new Map());
export function withFilm<T>(id: string, job: () => Promise<T>): Promise<T> {
  const run = (locks.get(id) ?? Promise.resolve()).catch(() => {}).then(job);
  locks.set(id, run);
  return run;
}

export async function readFilm(id: string): Promise<Film | null> {
  if (!isId(id)) return null;
  try {
    return JSON.parse(await readFile(filmFile(id), "utf8")) as Film;
  } catch {
    return null;
  }
}

export async function writeFilm(film: Film) {
  // Written aside and renamed, so a crash never leaves half a file.
  const file = filmFile(film.id);
  await writeFile(`${file}.tmp`, `${JSON.stringify(film, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
}

const exists = (p: string) => stat(p).then(() => true, () => false);

export async function listFilms(): Promise<FilmSummary[]> {
  const ids = (await readdir(FILMS_DIR).catch(() => [])).filter(isId);
  const films = (await Promise.all(ids.map(readFilm))).filter((f): f is Film => f !== null);
  const summaries = await Promise.all(
    films.map(async (f) => ({
      id: f.id,
      title: f.title,
      engine: f.engine,
      width: f.width,
      height: f.height,
      duration: f.duration,
      updatedAt: f.updatedAt,
      poster: (await exists(path.join(outDir(f.id), "poster.png")))
        ? `/api/studio/films/${f.id}/out/poster.png?v=${Date.parse(f.updatedAt).toString(36)}`
        : null,
    })),
  );
  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// Eight lower-case letters and digits.
export const newId = () =>
  Array.from(randomBytes(8), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

// What is copied into a new film: everything in the starter but its own
// build output and installs.
const SKIP = new Set(["node_modules", "target", "out", ".history", ".hyperframes"]);
const keep = (src: string) => !SKIP.has(path.basename(src));

export async function createFilm({
  title = "Untitled film",
  engine = "html",
  width = 1920,
  height = 1080,
}: { title?: string; engine?: Engine; width?: number; height?: number } = {}): Promise<Film> {
  const id = newId();
  const dir = filmDir(id);
  await mkdir(FILMS_DIR, { recursive: true });
  await cp(path.join(STARTERS_DIR, engine), dir, { recursive: true, filter: keep });
  // The starter's film.json supplies params, marks, fps and duration.
  const starter = (await readFilm(id)) ?? ({} as Partial<Film>);
  const now = new Date().toISOString();
  const film: Film = {
    params: [],
    marks: [],
    fps: 60,
    duration: 4,
    ...starter,
    id,
    title,
    engine,
    width,
    height,
    createdAt: now,
    updatedAt: now,
    session: undefined,
  };
  await writeFilm(film);
  return film;
}

export async function editFilm(id: string, edit: FilmEdit): Promise<Film | null> {
  return withFilm(id, async () => {
    const film = await readFilm(id);
    if (!film) return null;
    const { params, ...rest } = edit;
    const next: Film = { ...film, ...rest, updatedAt: new Date().toISOString() };
    if (params) {
      next.params = film.params.map((p) => (p.key in params ? { ...p, value: params[p.key] } : p));
    }
    await writeFilm(next);
    return next;
  });
}

export async function deleteFilm(id: string) {
  if (!isId(id)) return;
  await withFilm(id, () => rm(filmDir(id), { recursive: true, force: true }));
}

export async function duplicateFilm(id: string): Promise<Film | null> {
  const film = await readFilm(id);
  if (!film) return null;
  const copy = newId();
  const skip = new Set(["out", ".history"]);
  await cp(filmDir(id), filmDir(copy), {
    recursive: true,
    filter: (src) => !skip.has(path.basename(src)) || path.dirname(src) !== filmDir(id),
  });
  const now = new Date().toISOString();
  const next: Film = { ...film, id: copy, title: `${film.title} copy`, createdAt: now, updatedAt: now, session: undefined };
  await writeFilm(next);
  return next;
}

// ─── History, for undo ───────────────────────────────────────────────────────

// Copies the film as it is now into .history/<n>/ (n counting up) and
// returns n. Called before each Claude turn. Keeps the last 30.
export async function snapshotFilm(id: string): Promise<number> {
  const dir = filmDir(id);
  const turns = await historyTurns(id);
  const n = (turns.at(-1) ?? 0) + 1;
  const snap = path.join(historyDir(id), String(n));
  await mkdir(snap, { recursive: true });
  // Entry by entry: copying the folder whole into its own .history/ is
  // copying a folder into itself, which cp refuses.
  for (const name of await readdir(dir)) {
    if (!keep(name)) continue;
    await cp(path.join(dir, name), path.join(snap, name), { recursive: true });
  }
  for (const old of turns.slice(0, Math.max(0, turns.length + 1 - 30))) {
    await rm(path.join(historyDir(id), String(old)), { recursive: true, force: true });
  }
  return n;
}

async function historyTurns(id: string) {
  return (await readdir(historyDir(id)).catch(() => []))
    .map(Number)
    .filter(Number.isInteger)
    .sort((a, b) => a - b);
}

// Puts the film back as it was in its newest snapshot and drops that
// snapshot. Keeps renders (out/) and history; returns null if there's
// nothing to undo. The Claude session is kept, so the chat continues.
export async function restoreLast(id: string): Promise<Film | null> {
  const turns = await historyTurns(id);
  const n = turns.at(-1);
  if (n === undefined) return null;
  const dir = filmDir(id);
  const snap = path.join(historyDir(id), String(n));
  const session = (await readFilm(id))?.session;
  for (const name of await readdir(dir)) {
    if (name === "out" || name === ".history" || !keep(name)) continue;
    await rm(path.join(dir, name), { recursive: true, force: true });
  }
  await cp(snap, dir, { recursive: true });
  await rm(snap, { recursive: true, force: true });
  const film = await readFilm(id);
  if (!film) return null;
  const next = { ...film, session, updatedAt: new Date().toISOString() };
  await writeFilm(next);
  return next;
}

export const canUndo = async (id: string) => (await historyTurns(id)).length > 0;

// ─── Only this machine ───────────────────────────────────────────────────────

// The chat can edit files and run commands, so every /api/studio route
// checks who is asking. The dev server listens on this Mac only
// (`next dev -H 127.0.0.1`); on top of that:
//  - the Host must be this Mac, which stops a web page that points its own
//    domain at 127.0.0.1 (DNS rebinding);
//  - anything that changes something must come from the studio page itself:
//    same-origin, with the `x-studio: 1` header. A web page elsewhere can't
//    add that header without the server's permission, which it never gives.
// (x-forwarded-for is no help: Next passes on whatever the caller sends.)
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function allowed(request: Request) {
  const host = (request.headers.get("host") ?? "").replace(/:\d+$/, "");
  if (!LOCAL_HOSTS.has(host)) return false;
  if (request.method === "GET" || request.method === "HEAD") return true;
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin) return false;
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return false;
  return request.headers.get("x-studio") === "1";
}

export const refused = () => new Response("The studio only answers its own page on this computer.", { status: 403 });
