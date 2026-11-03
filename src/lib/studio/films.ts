import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { tokenMatches } from "./api-token";
import { kitForFilm } from "./brand-tokens";
import type { Engine, Film, FilmEdit, FilmSummary, Folder, Version } from "./contract";

// Copies are APFS clones where the disk allows: instant, and no extra space
// until one side changes. Matters once a film holds gigabytes of footage.
const CLONE = { mode: constants.COPYFILE_FICLONE };

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
  // A film still being made briefly holds its starter's film.json, with no
  // id yet; it shows up once it's ready.
  // Versions Claude is trying (takes.ts) belong to their film, not the list.
  const films = (await Promise.all(ids.map(readFilm))).filter((f): f is Film => typeof f?.id === "string" && !f.take);
  const summaries = await Promise.all(
    films.map(async (f) => ({
      id: f.id,
      title: f.title,
      engine: f.engine,
      kind: f.kind ?? "motion",
      folder: f.folder,
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
// What undo leaves alone: imported footage (media/) never changes once it's
// in, so snapshots skip it and restoring keeps it.
const keepInHistory = (name: string) => keep(name) && name !== "media";

export async function createFilm({
  title = "Untitled film",
  engine: asked = "html",
  kind = "motion",
  width = 1920,
  height = 1080,
}: { title?: string; engine?: Engine; kind?: "motion" | "video"; width?: number; height?: number } = {}): Promise<Film> {
  const id = newId();
  const dir = filmDir(id);
  // A video film is an edit of footage, played by a React film (edit.ts).
  const engine: Engine = kind === "video" ? "react" : asked;
  await mkdir(FILMS_DIR, { recursive: true });
  await cp(path.join(STARTERS_DIR, kind === "video" ? "video" : engine), dir, { recursive: true, filter: keep });
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
    ...(kind === "video" ? { kind } : {}),
    width,
    height,
    createdAt: now,
    updatedAt: now,
    session: undefined,
  };
  // The starter's colours are Aerchain orange; a film starts on the default
  // kit, so it takes that kit's accent instead.
  const kit = await kitForFilm(ROOT, undefined);
  const accent = kit?.colors.roles.accent;
  if (accent) film.params = film.params.map((p) => (p.type === "color" && String(p.value).toUpperCase() === "#F55A00" ? { ...p, value: accent } : p));
  await writeFilm(film);
  return film;
}

export async function editFilm(id: string, edit: FilmEdit): Promise<Film | null> {
  return withFilm(id, async () => {
    const film = await readFilm(id);
    if (!film) return null;
    const { params, folder, ...rest } = edit;
    // Filing a film in a folder isn't an edit of the film: it keeps its
    // "last edited" time, so the list order doesn't jump.
    const edited = Object.keys(rest).length > 0 || params !== undefined;
    const next: Film = { ...film, ...rest, updatedAt: edited ? new Date().toISOString() : film.updatedAt };
    // A title typed by the person is theirs: the studio stops naming it.
    if (rest.title !== undefined && rest.title !== film.title) next.named = true;
    if (folder === null) delete next.folder;
    else if (folder !== undefined) next.folder = folder;
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
    ...CLONE,
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
// returns n. Called before each Claude turn, and before going back to an
// earlier version. Keeps the last 30, never dropping `spare` (the version
// being gone back to).
export async function snapshotFilm(id: string, { spare }: { spare?: number } = {}): Promise<number> {
  const dir = filmDir(id);
  const turns = await historyTurns(id);
  const n = (turns.at(-1) ?? 0) + 1;
  const snap = path.join(historyDir(id), String(n));
  await mkdir(snap, { recursive: true });
  // Entry by entry: copying the folder whole into its own .history/ is
  // copying a folder into itself, which cp refuses.
  for (const name of await readdir(dir)) {
    if (!keepInHistory(name)) continue;
    await cp(path.join(dir, name), path.join(snap, name), { ...CLONE, recursive: true });
  }
  const old = turns.filter((t) => t !== spare);
  for (const t of old.slice(0, Math.max(0, old.length + 1 - 30))) {
    await rm(path.join(historyDir(id), String(t)), { recursive: true, force: true });
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
  const film = await putBack(id, n);
  await rm(path.join(historyDir(id), String(n)), { recursive: true, force: true });
  await pruneVersions(id);
  return film;
}

// Copies snapshot n's files over the film. What a snapshot never holds
// stays as it is: renders (out/), history, footage (media/) and the Claude
// session.
async function putBack(id: string, n: number): Promise<Film | null> {
  const dir = filmDir(id);
  const snap = path.join(historyDir(id), String(n));
  const session = (await readFilm(id))?.session;
  for (const name of await readdir(dir)) {
    if (name === "out" || name === ".history" || !keepInHistory(name)) continue;
    await rm(path.join(dir, name), { recursive: true, force: true });
  }
  await cp(snap, dir, { ...CLONE, recursive: true });
  const film = await readFilm(id);
  if (!film) return null;
  const next = { ...film, session, updatedAt: new Date().toISOString() };
  await writeFilm(next);
  return next;
}

export const canUndo = async (id: string) => (await historyTurns(id)).length > 0;

// ─── Versions: the film after each prompt ────────────────────────────────────

// .history/versions.json has a row for each snapshot: what came right after
// it was taken (the prompt sent, or going back to another version) and the
// snapshot's own label. A snapshot holds the film as it stood after the
// prompt before it, or the starting point for the first one. Labels are
// worked out when the snapshot is taken, from the row before it, so
// trimming old rows never changes one. Rows whose snapshot is gone (undone,
// a turn that changed nothing, past the last 30) are dropped.
type Made = { prompt: string; t: number }; // the prompt that made a version
export type VersionRow = {
  n: number;
  at: string; // ISO, when the snapshot was taken
  prompt: string; // what came next: the prompt, or "Went back to …"
  context: { t: number }; // the playhead when that was asked
  label: string; // the snapshot itself: "Start", "After: …", "Before going back to …"
  made?: Made;
  back?: { about: string; made?: Made }; // on a row that went back: where to
};

const versionsFile = (id: string) => path.join(historyDir(id), "versions.json");

export async function readVersions(id: string): Promise<VersionRow[]> {
  const turns = new Set(await historyTurns(id));
  try {
    const rows = JSON.parse(await readFile(versionsFile(id), "utf8")) as VersionRow[];
    return Array.isArray(rows) ? rows.filter((r) => turns.has(r.n)).sort((a, b) => a.n - b.n) : [];
  } catch {
    return [];
  }
}

// Written aside and renamed, so a crash never leaves half a file.
async function writeVersions(id: string, rows: VersionRow[]) {
  const turns = new Set(await historyTurns(id));
  const file = versionsFile(id);
  await mkdir(historyDir(id), { recursive: true });
  await writeFile(`${file}.tmp`, `${JSON.stringify(rows.filter((r) => turns.has(r.n)), null, 2)}\n`);
  await rename(`${file}.tmp`, file);
}

// Drops the rows whose snapshot is gone.
export const pruneVersions = async (id: string) => writeVersions(id, await readVersions(id));

// About 60 characters, cut between words.
function shorten(text: string, max = 60) {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, "")}…`;
}

// What the film became after a row's prompt or going back.
function after(row: VersionRow | undefined, earlier: boolean): { label: string; made?: Made } {
  if (!row) return { label: earlier ? "An earlier version" : "Start" };
  if (row.back) return { label: `Back to ${row.back.about}`, made: row.back.made };
  return { label: `After: ${shorten(row.prompt)}`, made: { prompt: row.prompt, t: row.context.t } };
}

// Where going back went, by what the version holds: "the version after:
// …" (the prompt that made it), "the start" or "an earlier version".
function aboutOf(row: VersionRow | undefined) {
  if (row?.made) return `the version after: ${shorten(row.made.prompt)}`;
  if (!row || row.label.includes("earlier version")) return "an earlier version";
  return "the start";
}

// "Went back to the start.", with no full stop after a shortened prompt.
export const wentBackTo = (about: string) => `Went back to ${about}${about.endsWith("…") ? "" : "."}`;

// Records snapshot n, taken just before `prompt` (asked with the playhead
// at t). Call it in the same withFilm as the snapshot.
export async function recordVersion(id: string, n: number, prompt: string, t: number, back?: VersionRow["back"]) {
  const rows = (await readVersions(id)).filter((r) => r.n !== n);
  const prev = rows.filter((r) => r.n < n).at(-1);
  const earlier = !prev && (await historyTurns(id)).some((x) => x < n);
  const was = after(prev, earlier);
  const row: VersionRow = {
    n,
    at: new Date().toISOString(),
    prompt,
    context: { t },
    label: back ? `Before going back to ${back.about}` : was.label,
    ...(was.made ? { made: was.made } : {}),
    ...(back ? { back } : {}),
  };
  await writeVersions(id, [...rows, row]);
}

// The prompts in the film's chat, oldest first.
async function promptsOf(id: string): Promise<{ at: number; text: string; t: number | null }[]> {
  try {
    const raw = JSON.parse(await readFile(path.join(historyDir(id), "chat.json"), "utf8")) as unknown;
    const list = Array.isArray(raw) ? raw : ((raw as { messages?: unknown[] })?.messages ?? []);
    return (list as { role?: string; text?: string; at?: string; context?: { t?: number } }[])
      .filter((m) => m.role === "you" && m.text && m.at)
      .map((m) => ({ at: Date.parse(m.at as string), text: m.text as string, t: typeof m.context?.t === "number" ? m.context.t : null }))
      .sort((x, y) => x.at - y.at);
  } catch {
    return [];
  }
}

// Every version, newest first, with the film as it is now at the top.
export async function listVersions(id: string, film: Film): Promise<Version[]> {
  const rows = await readVersions(id);
  const byN = new Map(rows.map((r) => [r.n, r]));
  const turns = await historyTurns(id);
  const prompts = await promptsOf(id);
  // A version saved before rows were kept is named from the chat: it was
  // taken as a prompt was sent, so it holds the film after the prompt before.
  const fromChat = (at: string) => {
    const when = Date.parse(at) + 5000;
    const sent = prompts.filter((p) => p.at <= when);
    const made = sent.at(-2);
    if (!sent.length) return null;
    return made ? { label: `After: ${shorten(made.text)}`, prompt: made.text, t: made.t } : { label: "Start", prompt: null, t: null };
  };
  const versions: Version[] = [];
  for (const n of turns) {
    const row = byN.get(n);
    // Snapshots from before versions were recorded have no row.
    const at = row?.at ?? (await stat(path.join(historyDir(id), String(n))).then((s) => s.mtime.toISOString(), () => film.updatedAt));
    const guess = !row || row.label === "An earlier version" ? fromChat(at) : null;
    versions.push({
      n,
      at,
      label: guess?.label ?? row?.label ?? "An earlier version",
      prompt: row?.made?.prompt ?? guess?.prompt ?? null,
      t: row?.made?.t ?? guess?.t ?? null,
    });
  }
  // Now is the film after the newest row's prompt (or going back), or
  // after the chat's last prompt.
  const last = prompts.at(-1);
  const now = rows.length
    ? after(rows.at(-1), false)
    : last
      ? { label: `After: ${shorten(last.text)}`, made: { prompt: last.text, t: last.t ?? 0 } }
      : null;
  versions.push({
    n: null,
    at: film.updatedAt,
    label: "Now",
    ...(now ? { detail: now.label } : {}),
    prompt: now?.made?.prompt ?? null,
    t: now?.made?.t ?? null,
    current: true,
  });
  return versions.reverse();
}

// Puts the film back as it was in snapshot n. The film as it is now is
// kept first, as a new version, so you can always come forward again.
// Returns the film and where it went ("the version after: …"), or null if
// there's no such version.
export async function restoreVersion(id: string, n: number, t: number): Promise<{ film: Film; about: string } | null> {
  if (!(await historyTurns(id)).includes(n)) return null;
  const target = (await readVersions(id)).find((r) => r.n === n);
  const about = aboutOf(target);
  const back = { about, ...(target?.made ? { made: target.made } : {}) };
  const m = await snapshotFilm(id, { spare: n });
  await recordVersion(id, m, wentBackTo(about), t, back);
  const film = await putBack(id, n);
  return film ? { film, about } : null;
}

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
// Apps outside the browser (the MCP server, the command line, Raycast) send
// the local API token instead: see fromApp below and docs/security.md.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function allowed(request: Request) {
  const host = (request.headers.get("host") ?? "").replace(/:\d+$/, "");
  if (!LOCAL_HOSTS.has(host)) return false;
  const auth = request.headers.get("authorization");
  if (auth !== null) return fromApp(request, auth);
  if (request.method === "GET" || request.method === "HEAD") return true;
  // The page's own origin: this Mac by any of its names, on the same port
  // (Next reports its own address as localhost even when the page was
  // opened at 127.0.0.1).
  const origin = request.headers.get("origin");
  if (origin !== null) {
    let from: URL;
    try {
      from = new URL(origin);
    } catch {
      return false;
    }
    const port = (request.headers.get("host") ?? "").match(/:(\d+)$/)?.[1] ?? "";
    if (!LOCAL_HOSTS.has(from.hostname) || from.port !== port) return false;
  }
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return false;
  return request.headers.get("x-studio") === "1";
}

// An app on this Mac with the token. Never a web page: a browser only sends
// an Authorization header to another site after asking the server first
// (CORS), which the studio never allows, and anything a browser marks as
// coming from a page is refused here too.
function fromApp(request: Request, auth: string) {
  if (request.headers.get("origin") !== null) return false;
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "none") return false;
  return tokenMatches(auth);
}

// Only the studio page itself, for what only the page may do (showing and
// replacing the token): same-origin as the browser reports it, with the
// studio's header, and no token.
export function fromPage(request: Request) {
  if (request.headers.get("authorization") !== null) return false;
  if (request.headers.get("sec-fetch-site") !== "same-origin") return false;
  if (request.headers.get("x-studio") !== "1") return false;
  return allowed(request);
}

export const refused = () => new Response("The studio only answers its own page on this computer.", { status: 403 });

// ─── Folders ──────────────────────────────────────────────────────────────────

// films/folders.json: the folders on the home page, in the order they were
// made. A film names its folder by id, so renaming a folder touches nothing
// else.
const foldersFile = path.join(FILMS_DIR, "folders.json");

export async function listFolders(): Promise<Folder[]> {
  try {
    const raw = JSON.parse(await readFile(foldersFile, "utf8")) as { folders?: Folder[] };
    return Array.isArray(raw.folders) ? raw.folders.filter((f) => isId(f.id) && typeof f.name === "string") : [];
  } catch {
    return [];
  }
}

async function writeFolders(folders: Folder[]) {
  await mkdir(FILMS_DIR, { recursive: true });
  await writeFile(`${foldersFile}.tmp`, `${JSON.stringify({ folders }, null, 2)}\n`);
  await rename(`${foldersFile}.tmp`, foldersFile);
}

// One change to the folder list at a time.
const withFolders = <T,>(job: () => Promise<T>) => withFilm("folders", job);

export function createFolder(name: string): Promise<Folder> {
  return withFolders(async () => {
    const folders = await listFolders();
    const folder: Folder = { id: newId(), name, createdAt: new Date().toISOString() };
    await writeFolders([...folders, folder]);
    return folder;
  });
}

export function renameFolder(id: string, name: string): Promise<Folder | null> {
  return withFolders(async () => {
    const folders = await listFolders();
    const folder = folders.find((f) => f.id === id);
    if (!folder) return null;
    folder.name = name;
    await writeFolders(folders);
    return folder;
  });
}

// Removes a folder; its films stay, back under All films.
export function deleteFolder(id: string): Promise<boolean> {
  return withFolders(async () => {
    const folders = await listFolders();
    if (!folders.some((f) => f.id === id)) return false;
    await writeFolders(folders.filter((f) => f.id !== id));
    const ids = (await readdir(FILMS_DIR).catch(() => [])).filter(isId);
    for (const filmId of ids) {
      const film = await readFilm(filmId);
      if (film?.folder === id) await editFilm(filmId, { folder: null });
    }
    return true;
  });
}

// ─── Words changed on the film that aren't a text param ───────────────────
//
// Any words on the film can be clicked and retyped. When the old words appear
// exactly once in the film's own files, they're swapped there directly (the
// film as it was is kept as a version first, so it can be undone). Otherwise
// it's not clear which copy to change, and the caller asks Claude instead.

const WORD_FILES = /\.(html|js|jsx|mjs|ts|tsx|css)$/;
const SKIP_DIRS = new Set(["node_modules", ".history", "out", "sound", "assets", "refs", "media", ".hyperframes", "dist", "target", "public"]);

async function filmTextFiles(dir: string, base = dir): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith(".") && entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) found.push(...(await filmTextFiles(full, base)));
    } else if (WORD_FILES.test(entry.name)) found.push(full);
  }
  return found;
}

// Where `from` sits as whole words (not inside a longer word).
function wordsAt(text: string, from: string): number[] {
  const at: number[] = [];
  const edge = /[\p{L}\p{N}_]/u;
  for (let i = text.indexOf(from); i !== -1; i = text.indexOf(from, i + from.length)) {
    if (edge.test(text[i - 1] ?? "") || edge.test(text[i + from.length] ?? "")) continue;
    at.push(i);
  }
  return at;
}

export async function replaceWords(id: string, from: string, to: string, t: number): Promise<"done" | "ask"> {
  const old = from.trim();
  const next = to.trim();
  if (!old || old === next) return "done";
  // Characters that would need escaping in code are left to Claude.
  if (/["'`\\<>&{}$]/.test(next) || /["'`\\<>&{}$]/.test(old)) return "ask";
  const files = await filmTextFiles(filmDir(id));
  const hits: { file: string; text: string; at: number }[] = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const at of wordsAt(text, old)) hits.push({ file, text, at });
    if (hits.length > 1) return "ask";
  }
  if (hits.length !== 1) return "ask";
  const [hit] = hits;
  await withFilm(id, async () => {
    const n = await snapshotFilm(id);
    await recordVersion(id, n, `Changed “${old}” to “${next}” on the film`, t);
    await writeFile(hit.file, hit.text.slice(0, hit.at) + next + hit.text.slice(hit.at + old.length));
  });
  return "done";
}
