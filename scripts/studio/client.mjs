// The studio's local API, for apps outside the browser: the MCP server
// (mcp.mjs) and the command line (cli.mjs) both go through here. It talks to
// a studio that is already running (`npm run dev`); it never starts one and
// never opens a film's files itself, except to say where renders were saved.
//
// Every request carries the local API token from .studio/api-token (or
// MOTION_STUDIO_TOKEN). If the file is missing it is made here, the same way
// the studio makes it (src/lib/studio/api-token.ts): random, mode 600. The
// token is never printed or logged.
//
// MOTION_STUDIO_URL points at another studio, e.g. http://127.0.0.1:3333.

import { randomBytes } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const TOKEN_FILE = path.join(ROOT, ".studio", "api-token");
export const STUDIO_URL = (process.env.MOTION_STUDIO_URL ?? "http://127.0.0.1:3200").replace(/\/+$/, "");

// The address to give a person: the same studio, as localhost.
export const PAGE_URL = (() => {
  const url = new URL(STUDIO_URL);
  if (url.hostname === "127.0.0.1" || url.hostname === "[::1]") url.hostname = "localhost";
  return url.origin;
})();

export const FORMATS = {
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
};

export class StudioError extends Error {
  constructor(message, code = "failed") {
    super(message);
    this.code = code;
  }
}

export const NOT_RUNNING =
  `The studio isn't running at ${PAGE_URL}. Open Terminal in the motion-studio folder, run \`npm run dev\`, then try again.`;
const REFUSED =
  "The studio turned the request away. If it was started before this update, restart it (`npm run dev`). Otherwise the token may have been replaced: copy it again from the studio, under Where films are saved, Use the studio from other apps.";

const validToken = (t) => /^ms_[A-Za-z0-9_-]{43}$/.test(t);

// The token, made the first time if the studio hasn't made it yet.
export async function readToken({ create = true } = {}) {
  const fromEnv = process.env.MOTION_STUDIO_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  let saved = null;
  try {
    saved = (await readFile(TOKEN_FILE, "utf8")).trim();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (saved !== null) {
    if (validToken(saved)) return saved;
    throw new StudioError(`The token in ${TOKEN_FILE} isn't one the studio made. Make a new one in the studio.`, "bad_token");
  }
  if (!create) return null;
  const token = `ms_${randomBytes(32).toString("base64url")}`;
  await mkdir(path.dirname(TOKEN_FILE), { recursive: true, mode: 0o700 });
  try {
    // Only if there still isn't one: another app may have just made it.
    await writeFile(TOKEN_FILE, `${token}\n`, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error?.code === "EEXIST") return readToken({ create: false });
    throw error;
  }
  return token;
}

// The token file's permissions, for `doctor`: null if there's no file.
export async function tokenFileMode() {
  return stat(TOKEN_FILE).then((s) => s.mode & 0o777, () => null);
}

// One request to /api/studio/<route>. Returns the parsed JSON, or the
// Response itself with { stream: true }.
async function call(method, route, { body, signal, stream = false } = {}) {
  const token = await readToken();
  let res;
  try {
    res = await fetch(`${STUDIO_URL}/api/studio${route}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new StudioError(NOT_RUNNING, "not_running");
  }
  if (res.status === 403 || res.status === 401) throw new StudioError(REFUSED, "refused");
  if (stream && res.ok) return res;
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const film = route.match(/^\/films\/([a-z0-9]{8})(?:\/|$)/)?.[1];
    if (res.status === 404 && film && /no longer exists/.test(String(data?.error))) {
      throw new StudioError(`There's no film with the id ${film}. List the films to find one.`, "not_found");
    }
    const said = data && typeof data === "object" && "error" in data ? String(data.error) : null;
    throw new StudioError(said ?? `The studio answered with error ${res.status}. Try again in a moment.`, res.status === 404 ? "not_found" : "failed");
  }
  return data;
}

export const filmLink = (id) => `${PAGE_URL}/studio?film=${id}`;

const isId = (id) => typeof id === "string" && /^[a-z0-9]{8}$/.test(id);
function checkId(id) {
  if (!isId(id)) throw new StudioError(`"${id}" isn't a film id. Film ids are 8 lower-case letters and digits; list the films to find one.`, "invalid");
}

const formatOf = (w, h) => Object.entries(FORMATS).find(([, s]) => s.width * h === s.height * w)?.[0] ?? `${w}×${h}`;

function summary(f) {
  return {
    id: f.id,
    title: f.title,
    kind: f.kind ?? "motion",
    format: formatOf(f.width, f.height),
    width: f.width,
    height: f.height,
    duration: f.duration,
    brand: f.brand ?? "clean",
    updatedAt: f.updatedAt,
    link: filmLink(f.id),
  };
}

// A title from the first words of a prompt, as the studio page makes it.
export function titleFrom(prompt) {
  const first = prompt.split(/[.:;,\n]/)[0].trim().split(/\s+/).slice(0, 6).join(" ");
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : "Untitled film";
}

// Is the studio there, and does it take the token? Never throws.
export async function ping() {
  try {
    await call("GET", "/films");
    return { ok: true };
  } catch (error) {
    return { ok: false, code: error.code ?? "failed", message: error.message };
  }
}

export async function listFilms() {
  return (await call("GET", "/films")).map(summary);
}

export async function getFilm(id) {
  checkId(id);
  const film = await call("GET", `/films/${id}`);
  const render = await call("GET", `/films/${id}/render`).catch(() => null);
  return {
    ...summary(film),
    fps: film.fps,
    settings: (film.params ?? []).map((p) => ({ key: p.key, label: p.label, type: p.type, value: p.value })),
    render: render ? withPaths(id, render) : null,
  };
}

export async function listBrands() {
  return (await call("GET", "/brands")).map((b) => ({ id: b.id, name: b.name }));
}

// A brand kit by id or by name (any case).
async function findBrand(brand) {
  const kits = await listBrands();
  const want = brand.trim().toLowerCase();
  const kit = kits.find((k) => k.id === brand) ?? kits.find((k) => k.name.trim().toLowerCase() === want);
  if (!kit) {
    throw new StudioError(`There's no brand kit called "${brand}". The kits are: ${kits.map((k) => `${k.name} (${k.id})`).join(", ") || "none yet"}.`, "invalid");
  }
  return kit;
}

// A new film, filed like one made on the studio's home page. With a prompt,
// Claude makes the first version straight away (see changeFilm).
export async function createFilm({ prompt = "", format = "16:9", kind = "motion", brand, title, at, onEvent, signal } = {}) {
  const size = FORMATS[format];
  if (!size) throw new StudioError(`The format is one of ${Object.keys(FORMATS).join(", ")}.`, "invalid");
  if (kind !== "motion" && kind !== "video") throw new StudioError('The kind is "motion" or "video".', "invalid");
  const kit = brand ? await findBrand(brand) : null;
  const text = prompt.trim();
  const film = await call("POST", "/films", {
    body: { title: title?.trim() || (text ? titleFrom(text) : kind === "video" ? "Untitled video" : "Untitled film"), ...size, ...(kind === "video" ? { kind } : {}) },
    signal,
  });
  if (kit) await call("PATCH", `/films/${film.id}`, { body: { brand: kit.id }, signal });
  if (!text) return { film: summary({ ...film, brand: kit?.id }), reply: null };
  const turn = await changeFilm(film.id, text, { at, onEvent, signal });
  return { ...turn, film: turn.film ?? summary({ ...film, brand: kit?.id }) };
}

// Sends one prompt to the film's Claude and waits for the turn to end.
// onEvent gets each ChatEvent as it comes (start, text, step, changed).
// If the caller stops waiting, the turn carries on in the studio.
export async function changeFilm(id, prompt, { at, onEvent, signal, attachments } = {}) {
  checkId(id);
  const text = String(prompt ?? "").trim();
  if (!text) throw new StudioError("Say what you'd like changed.", "invalid");
  const t = Number.isFinite(at) && at >= 0 ? at : 0;
  const context = { t, pick: null, ...(attachments?.length ? { attachments } : {}) };
  const res = await call("POST", `/films/${id}/chat`, { body: { prompt: text, context }, signal, stream: true });
  let reply = "";
  const steps = [];
  let film = null;
  let failure = null;
  let changed = false;
  const decoder = new TextDecoder();
  let buffer = "";
  const handle = (event) => {
    if (event.kind === "text") reply += event.text;
    else if (event.kind === "step") steps.push(event.label);
    else if (event.kind === "changed") changed = true;
    else if (event.kind === "done") film = event.film;
    else if (event.kind === "error") failure = event.message;
    onEvent?.(event);
  };
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let cut = buffer.indexOf("\n\n");
    while (cut !== -1) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      for (const line of block.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try {
          handle(JSON.parse(line.slice(5).trim()));
        } catch {
          // A line that isn't an event; skip it.
        }
      }
      cut = buffer.indexOf("\n\n");
    }
  }
  if (failure && !film) throw new StudioError(failure, "turn_failed");
  return { reply: reply.trim() || null, steps, changed, error: failure, film: film ? summary(film) : null, link: filmLink(id) };
}

// Where a render's files are on this Mac, and their addresses.
function withPaths(id, status) {
  if (status.state !== "done") return status;
  return {
    ...status,
    files: status.files.map((name) => ({
      name,
      path: path.join(ROOT, "films", id, "out", name),
      url: `${PAGE_URL}/api/studio/films/${id}/out/${name}`,
    })),
  };
}

const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Stopped"));
    }, { once: true });
  });

// Starts a render and waits for it. onProgress gets { state, progress }
// (progress 0 to 1 while it runs). A final render makes 4K and the film's
// own size; a draft is quick, at the film's own size.
export async function renderFilm(id, quality = "final", { onProgress, signal } = {}) {
  checkId(id);
  if (quality !== "draft" && quality !== "final") throw new StudioError('The quality is "draft" or "final".', "invalid");
  const asked = Date.now() - 2000;
  let status = await call("POST", `/films/${id}/render`, { body: { quality }, signal });
  for (;;) {
    const finished = (status.state === "done" || status.state === "failed") && Date.parse(status.at) >= asked;
    if (finished) break;
    onProgress?.(status);
    await wait(1000, signal);
    status = await call("GET", `/films/${id}/render`, { signal });
  }
  if (status.state === "failed") throw new StudioError(`The render failed: ${status.message}`, "render_failed");
  return withPaths(id, status);
}

export async function listVersions(id) {
  checkId(id);
  const { versions } = await call("GET", `/films/${id}/versions`);
  return versions.map((v) => ({
    version: v.n,
    label: v.label,
    ...(v.detail ? { detail: v.detail } : {}),
    at: v.at,
    prompt: v.prompt,
    ...(v.current ? { current: true } : {}),
  }));
}

// Puts the film back as it was in that version. The film as it is now is
// kept as a new version first, so nothing is lost.
export async function goBack(id, version) {
  checkId(id);
  const n = Number(version);
  if (!Number.isInteger(n) || n < 1) throw new StudioError("The version is a whole number from the film's list of versions.", "invalid");
  const film = await call("POST", `/films/${id}/versions/${n}/restore`, { body: { t: 0 } });
  return summary(film);
}

// ─── The reference library ──────────────────────────────────────────────────

const LIBRARY = path.join(ROOT, "library");

// Everything saved in the library (not the brand kits' own files, which
// films use through their kit), newest first. `query` matches names, tags
// and notes; `tag` keeps one tag.
export async function listLibrary({ query, tag } = {}) {
  const { items, folders } = await call("GET", "/library");
  const folderName = new Map(folders.map((f) => [f.id, f.name]));
  const q = String(query ?? "").trim().toLowerCase();
  const t = String(tag ?? "").trim().toLowerCase();
  return items
    .filter((i) => !q || [i.name, i.note, i.site ?? "", ...i.tags].some((s) => s.toLowerCase().includes(q)))
    .filter((i) => !t || i.tags.some((x) => x.toLowerCase() === t))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((i) => ({
      id: i.id,
      kind: i.kind,
      name: i.name,
      tags: i.tags,
      ...(i.note ? { note: i.note } : {}),
      folder: i.folder ? (folderName.get(i.folder) ?? null) : null,
      ...(i.duration ? { seconds: i.duration } : {}),
      ...(i.url ? { url: i.url } : {}),
      ...(i.file ? { path: path.join(LIBRARY, i.id, i.file) } : {}),
      updatedAt: i.updatedAt,
    }));
}

// Copies library items into a film's refs/, as the studio does when one is
// picked in a prompt box (a clip comes in as four stills, a note or link as
// text). Returns the attachments, to send with change_film.
export async function attachFromLibrary(id, items) {
  checkId(id);
  const list = (Array.isArray(items) ? items : [items]).map(String);
  if (!list.length) throw new StudioError("Name at least one library item.", "invalid");
  const out = [];
  for (const item of list) {
    if (!isId(item)) throw new StudioError(`"${item}" isn't a library item id. List the library to find one.`, "invalid");
    out.push(...(await call("POST", `/library/${item}/attach`, { body: { film: id } })));
  }
  return out;
}
