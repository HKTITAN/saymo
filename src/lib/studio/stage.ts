import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { bridgeScript, STAGE_STYLE } from "./bridge";
import type { Film } from "./contract";
import { FILMS_DIR, filmDir, outDir, ROOT } from "./films";
import { fontFaces, kitForFilm, stageFileUrl, tokensOf } from "./brand-tokens";
import { brandScript, globalsScript, paramValues, prepareHtml, scriptJson } from "./inject";
import { listMedia } from "./media";

// The stage: one page per film that plays it at its own pixel size, for the
// studio to scale, seek and point at. Every engine gets the same bridge
// (bridge.ts); inside, an HTML film runs as it is, a React film runs in the
// Remotion Player, and a Rust film shows its draft video.

export const stageBase = (id: string) => `/studio/stage/${id}/`;

const head = (film: Film, extra = "") =>
  `<meta charset="utf-8"><base href="${stageBase(film.id)}">${STAGE_STYLE}` +
  globalsScript(film, paramValues(film)) +
  bridgeScript({ id: film.id, engine: film.engine }) +
  extra;

// The film's brand kit, as tokens on window.__brand with its fonts.
async function brandHead(film: Film) {
  const kit = await kitForFilm(ROOT, film.brand);
  if (!kit) return "";
  const tokens = tokensOf(kit, stageFileUrl(kit.id));
  return brandScript(tokens, fontFaces(tokens));
}

export async function stagePage(film: Film): Promise<string> {
  const brand = await brandHead(film);
  if (film.engine === "html") {
    const html = await readFile(path.join(filmDir(film.id), "index.html"), "utf8").catch(() => null);
    if (html === null) return errorPage(film, "This film has no index.html.");
    // The globals go first, then the brand and the bridge, then the film's own head.
    return prepareHtml(html, film, paramValues(film), `<base href="${stageBase(film.id)}">${STAGE_STYLE}${brand}${bridgeScript({ id: film.id, engine: "html" })}`);
  }
  if (film.engine === "react") {
    const key = await sourceKey(film.id);
    // Files under public/ are the film's staticFile()s.
    const statics =
      `<script>window.remotion_staticBase=${JSON.stringify(`${stageBase(film.id)}public`.replace(/\/$/, ""))};</script>` +
      (film.kind === "video" ? await videoGlobals(film) : "") +
      brand;
    return `<!doctype html><html><head>${head(film, statics)}</head><body><div id="root"></div><script src="${stageBase(film.id)}__stage.js?v=${key}"></script></body></html>`;
  }
  return rustPage(film);
}

// A video film's stage starts with its edit (edit.json) and the preview
// copies of its files; the studio then sends the edit live as it changes.
async function videoGlobals(film: Film) {
  const edit = await readFile(path.join(filmDir(film.id), "edit.json"), "utf8")
    .then((t) => JSON.parse(t))
    .catch(() => null);
  return `<script>window.__filmId=${scriptJson(film.id)};window.__edit=${scriptJson(edit)};window.__media=${scriptJson(await previewMedia(film.id))};</script>`;
}

// Where the stage finds each ready file: its preview copy.
export async function previewMedia(id: string) {
  const out: Record<string, { src: string; kind: string; width: number | null; height: number | null; name: string }> = {};
  for (const m of await listMedia(id)) {
    if (m.status !== "ready" || !m.proxy) continue;
    out[m.id] = { src: `/api/studio/films/${id}/media/${m.id}/${m.proxy}`, kind: m.kind, width: m.width, height: m.height, name: m.name };
  }
  return out;
}

function errorPage(film: Film, message: string) {
  return `<!doctype html><html><head>${head(film)}</head><body style="background:#141414"><script>window.__studioStage.error(${JSON.stringify(message)})</script></body></html>`;
}

// ─── React: the stage bundle ──────────────────────────────────────────────────

// Changes whenever any file the bundle reads changes: everything but the
// film's statics, renders, history and footage, plus the studio's graphics
// and kit. A video film's edit.json reaches the stage on its own, so it
// isn't part of the bundle.
const SKIP = new Set(["out", ".history", "public", "node_modules", "target", "media"]);
const SHARED = [path.join(ROOT, "studio/graphics"), path.join(ROOT, "studio/kit")];
async function sourceKey(id: string) {
  const hash = createHash("sha1");
  const walk = async (dir: string, base: string) => {
    for (const entry of (await readdir(dir, { withFileTypes: true }).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name))) {
      if (SKIP.has(entry.name) || entry.name.startsWith(".") || entry.name === "edit.json") continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(p, base);
      else {
        const s = await stat(p);
        hash.update(`${path.relative(base, p)}:${s.size}:${s.mtimeMs}\n`);
      }
    }
  };
  await walk(filmDir(id), filmDir(id));
  for (const dir of SHARED) await walk(dir, ROOT);
  return hash.digest("hex").slice(0, 12);
}

const g = globalThis as { __stageBundles?: Map<string, Promise<string>> };
const bundling = (g.__stageBundles ??= new Map());

// The film's stage bundle as JavaScript; made once per version of its code.
// A failure comes back as a script that reports it through the bridge.
export async function stageBundle(id: string): Promise<string> {
  const key = await sourceKey(id);
  const file = path.join(FILMS_DIR, ".work", id, `stage-${key}.js`);
  const cached = await readFile(file, "utf8").catch(() => null);
  if (cached !== null) return cached;
  const job =
    bundling.get(file) ??
    new Promise<string>((resolve) => {
      const child = spawn(process.execPath, ["scripts/studio/stage-bundle.mjs", filmDir(id), file], {
        cwd: ROOT,
        stdio: ["ignore", "ignore", "pipe"],
      });
      let said = "";
      child.stderr.on("data", (chunk) => (said += chunk));
      child.on("close", async (code) => {
        bundling.delete(file);
        if (code === 0) resolve(await readFile(file, "utf8"));
        else resolve(failure(said.trim().split("\n").at(-1) || "The film's code could not be built."));
      });
      child.on("error", () => resolve(failure("The film's code could not be built.")));
    });
  bundling.set(file, job);
  return job;
}

const failure = (message: string) => `window.__studioStage.error(${JSON.stringify(message)});`;

// ─── Rust: the draft video ────────────────────────────────────────────────────

// Has the film changed since its draft was made?
export async function draftIsCurrent(id: string) {
  const draft = await stat(path.join(outDir(id), "draft.mp4")).catch(() => null);
  return !!draft && draft.mtimeMs >= (await newestChange(id));
}

// When the film's own files last changed (not its renders or history).
export async function newestChange(id: string) {
  let newest = 0;
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name) && entry.name !== "public") continue;
      if (entry.name.startsWith(".") || entry.name === "params.json") continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(p);
      else newest = Math.max(newest, (await stat(p)).mtimeMs);
    }
  };
  await walk(filmDir(id));
  return newest;
}

function rustPage(film: Film) {
  const src = `/api/studio/films/${film.id}/out/draft.mp4`;
  const script = `<script>(${rustStage.toString()})(${JSON.stringify({ id: film.id, src })});</script>`;
  return `<!doctype html><html><head>${head(film)}</head><body style="background:#141414"><video id="film" muted playsinline preload="auto" style="display:block;width:${film.width}px;height:${film.height}px"></video>${script}</body></html>`;
}

// Runs in the stage page: waits for a current draft (the route has asked
// for one if needed), then plays it by setting the video's time.
function rustStage({ id, src }: { id: string; src: string }) {
  const stage = (window as unknown as {
    __studioStage: { register(a: { seek(t: number): void }): void; ready(): void; error(m: string): void; loading(): void };
    __film: { fps: number; duration: number };
  }).__studioStage;
  const film = (window as unknown as { __film: { fps: number; duration: number } }).__film;
  const video = document.getElementById("film") as HTMLVideoElement;
  const show = (version: string) => {
    video.src = `${src}?v=${version}`;
    video.addEventListener(
      "loadeddata",
      () => {
        stage.register({ seek: (t) => (video.currentTime = Math.min(t, film.duration - 0.5 / film.fps)) });
        stage.ready();
      },
      { once: true },
    );
    video.addEventListener("error", () => stage.error("The draft video could not be played."), { once: true });
  };
  let told = false;
  const check = async () => {
    const res = await fetch(`/api/studio/films/${id}/render?stage=1`, { cache: "no-store" });
    const status = (await res.json()) as { state: string; at?: string; message?: string; current?: boolean };
    if (status.current) return show(String(status.at ?? Date.now()));
    if (status.state === "failed") return stage.error(status.message ?? "The draft could not be made.");
    if (!told) stage.loading();
    told = true;
    setTimeout(check, 700);
  };
  check();
}
