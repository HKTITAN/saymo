import { DEFAULT_BRAND } from "../brands/brand-tokens";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { chmod, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ConnectError, STUDIO_DIR } from "./connect-store";
import type { SaveState } from "./connect-types";
import type { Film, RenderStatus } from "../films/contract";
import { driveRecord } from "./drive-sync";
import { filmDir, outDir, readFilm, ROOT } from "../films/films";
import { githubIdentity, githubToken } from "./github";
import { listMedia, mediaDir } from "../films/media";

// The film library on GitHub: every film's SOURCE (what it's made of, not
// its footage or its videos), laid out so it stays easy to find with
// thousands of films and many people saving at once:
//
//   README.md                       index of every film (generated)
//   studio.json                     studio + schema versions
//   brands/<brand-id>/              brand.json, logos, fonts whose licence allows
//   films/<yyyy>/<mm>/<slug>--<id>/ one folder per film, by the month it was
//     README.md                     made; the id never changes, the slug
//     film.json, edit.json, ...     follows the title
//     media.json                    the footage it uses (names, sizes,
//                                   sha256), never the footage itself
//
// The studio keeps a working copy in .studio/github/<owner>__<repo>/ and
// treats GitHub as the truth: before each save it takes GitHub's latest,
// writes one film's folder (and the index), commits that and pushes. Each
// commit touches one film's folder, so saves from many people never clash.

const SCHEMA = { film: 1, edit: 1, sound: 1, brand: 1 };
const CLONES = path.join(STUDIO_DIR, "github");
const ASKPASS = path.join(STUDIO_DIR, "git-askpass.sh");

// What never goes to GitHub.
const SKIP_DIRS = new Set(["out", ".history", ".work", "node_modules", "target", ".hyperframes", "renders", ".git"]);
const SKIP_FILES = new Set([".DS_Store", "render-log.txt", "sound.wav", "peaks.json", "status.json", "chat.json"]);
const MEDIA_EXT = /\.(mp4|mov|m4v|webm|mkv|avi|mts|m2ts|3gp|mxf|mpg|mpeg|wav|mp3|m4a|aac|aif|aiff|flac|ogg|opus|caf|heic|heif)$/i;
const FONT_EXT = /\.(ttf|otf|woff2?)$/i;
const MAX_FILE = 10 * 1024 * 1024;

// ─── Git, with the token kept out of URLs, config and logs ────────────────

async function askpass() {
  await mkdir(STUDIO_DIR, { recursive: true, mode: 0o700 });
  // Reads the token from its own environment at the moment git asks.
  await writeFile(ASKPASS, '#!/bin/sh\ncase "$1" in\n  Username*) echo "x-access-token" ;;\n  *) printf "%s\\n" "$STUDIO_GIT_TOKEN" ;;\nesac\n', { mode: 0o700 });
  await chmod(ASKPASS, 0o700);
}

function git(cwd: string, args: string[], token?: string) {
  return new Promise<{ code: number; out: string; err: string }>((resolve) => {
    const proc = spawn(
      "git",
      // No credential helpers (the keychain, gh), no hooks: only our token.
      ["-c", "credential.helper=", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
      {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          LANG: process.env.LANG ?? "en_US.UTF-8",
          GIT_TERMINAL_PROMPT: "0",
          ...(token ? { GIT_ASKPASS: ASKPASS, STUDIO_GIT_TOKEN: token } : {}),
        } as unknown as NodeJS.ProcessEnv,
      },
    );
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => {
      out += String(d);
    });
    proc.stderr.on("data", (d) => {
      err += String(d);
    });
    proc.on("error", () => resolve({ code: 1, out, err: "git isn't installed." }));
    proc.on("close", (code) => resolve({ code: code ?? 1, out: out.trim(), err: err.trim() }));
  });
}

async function must(cwd: string, args: string[], token?: string) {
  const r = await git(cwd, args, token);
  if (r.code !== 0) {
    if (/Authentication failed|could not read Username|403|Permission/i.test(r.err)) {
      throw new ConnectError("GitHub refused the save: the sign-in can't push to this repository. Connect GitHub again or pick another repository.");
    }
    if (/Could not resolve host|unable to access/i.test(r.err)) throw new ConnectError("Unable to reach GitHub. Check the internet connection.");
    throw new ConnectError("Saving to GitHub stopped. Try again.");
  }
  return r.out;
}

// ─── The queue: one save at a time ────────────────────────────────────────

type Job = { id: string; message: string };
const g = globalThis as { __libraryQueue?: { queue: Job[]; running: string | null } };
const jobs = (g.__libraryQueue ??= { queue: [], running: null });

const recordFile = (id: string) => path.join(outDir(id), "github.json");
export async function githubRecord(id: string): Promise<SaveState> {
  try {
    const saved = JSON.parse(await readFile(recordFile(id), "utf8")) as SaveState;
    if (saved.state === "saving" && jobs.running !== id && !jobs.queue.some((j) => j.id === id)) {
      return { state: "failed", message: "Saving to GitHub stopped when the studio restarted. Try again.", at: new Date().toISOString() };
    }
    return saved;
  } catch {
    return { state: "none" };
  }
}
async function writeRecord(id: string, state: SaveState) {
  await mkdir(outDir(id), { recursive: true });
  const file = recordFile(id);
  await writeFile(`${file}.tmp`, JSON.stringify(state, null, 2));
  await rename(`${file}.tmp`, file);
}

export function saveToGithub(id: string, message: string) {
  const waiting = jobs.queue.find((j) => j.id === id);
  if (waiting) waiting.message = message;
  else jobs.queue.push({ id, message });
  void writeRecord(id, { state: "saving", step: "Waiting to save to GitHub" }).catch(() => {});
  void next();
}

async function next() {
  if (jobs.running || !jobs.queue.length) return;
  const job = jobs.queue.shift()!;
  jobs.running = job.id;
  try {
    await save(job);
  } catch (error) {
    const message = error instanceof ConnectError ? error.message : "Saving to GitHub stopped. Try again.";
    await writeRecord(job.id, { state: "failed", message, at: new Date().toISOString() }).catch(() => {});
  } finally {
    jobs.running = null;
    void next();
  }
}

// What to call a save, from the render that prompted it.
export function renderMessage(film: Film, quality: "draft" | "final", files: string[]) {
  const what = quality === "draft" ? "draft" : files.includes("4k.mp4") ? "final 4K" : "final 1080p";
  return `Render ${film.title}: ${what} (${film.id})`;
}

// ─── One save ─────────────────────────────────────────────────────────────

async function save({ id, message }: Job) {
  const film = await readFilm(id);
  if (!film) return;
  const step = (text: string) => writeRecord(id, { state: "saving", step: text });
  const { token, saved } = await githubToken();
  if (!saved.repo) throw new ConnectError("Pick a repository for the film library first.");
  const [owner, name] = saved.repo.fullName.split("/");
  const dir = path.join(CLONES, `${owner}__${name}`);
  await askpass();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const remote = `https://github.com/${saved.repo.fullName}.git`;

  for (let attempt = 1; ; attempt++) {
    await step("Getting the library's latest");
    await sync(dir, remote, token);
    await step("Writing the film's source");
    const folder = await writeFilm(dir, film);
    await writeIndex(dir, saved.repo.fullName);
    await must(dir, ["add", "-A"]);
    const changed = (await git(dir, ["diff", "--cached", "--quiet"])).code !== 0;
    if (!changed) {
      const head = (await git(dir, ["rev-parse", "HEAD"])).out;
      await writeRecord(id, { state: "saved", at: new Date().toISOString(), link: `${saved.repo.url}/tree/main/${folder}`, files: head ? [{ name: head.slice(0, 7), link: `${saved.repo.url}/commit/${head}` }] : [] });
      return;
    }
    const who = await githubIdentity();
    await must(dir, ["-c", `user.name=${who.name}`, "-c", `user.email=${who.email}`, "commit", "-q", "-m", message, "-m", `Saved by Saymo, the open-source motion studio. Film ${film.id}.`]);
    await step("Sending it to GitHub");
    const pushed = await git(dir, ["push", "-q", "origin", "HEAD:refs/heads/main"], token);
    if (pushed.code === 0) {
      const sha = (await git(dir, ["rev-parse", "HEAD"])).out;
      await writeRecord(id, {
        state: "saved",
        at: new Date().toISOString(),
        link: `${saved.repo.url}/tree/main/${folder}`,
        files: [{ name: sha.slice(0, 7), link: `${saved.repo.url}/commit/${sha}` }],
      });
      return;
    }
    // Someone else saved in between: start again from GitHub's latest.
    if (/rejected|fetch first|non-fast-forward/i.test(pushed.err) && attempt < 3) continue;
    await must(dir, ["push", "-q", "origin", "HEAD:refs/heads/main"], token);
  }
}

// The working copy, made to match GitHub exactly (it holds nothing of its own).
async function sync(dir: string, remote: string, token: string) {
  if (!existsSync(path.join(dir, ".git"))) {
    await must(dir, ["init", "-q", "-b", "main"]);
    await must(dir, ["remote", "add", "origin", remote]);
  } else {
    await must(dir, ["remote", "set-url", "origin", remote]);
  }
  await must(dir, ["fetch", "-q", "--prune", "origin"], token);
  const hasMain = (await git(dir, ["rev-parse", "--verify", "-q", "refs/remotes/origin/main"])).code === 0;
  if (hasMain) {
    await must(dir, ["checkout", "-q", "-B", "main", "origin/main"]);
    await must(dir, ["reset", "-q", "--hard", "origin/main"]);
    await must(dir, ["clean", "-q", "-fdx"]);
  } else {
    // A new, empty repository: start from nothing.
    const hasHead = (await git(dir, ["rev-parse", "--verify", "-q", "HEAD"])).code === 0;
    if (hasHead) {
      await must(dir, ["update-ref", "-d", "HEAD"]);
      await must(dir, ["rm", "-q", "-r", "--cached", "--ignore-unmatch", "."]);
    }
    for (const entry of await readdir(dir)) if (entry !== ".git") await rm(path.join(dir, entry), { recursive: true, force: true });
  }
}

const slugify = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "film";

// Finds the film's folder by its id wherever it is (the title may have
// changed), moves it to its current name, and fills it afresh.
async function writeFilm(dir: string, film: Film): Promise<string> {
  const made = new Date(film.createdAt);
  const want = path.posix.join(
    "films",
    String(made.getUTCFullYear()),
    String(made.getUTCMonth() + 1).padStart(2, "0"),
    `${slugify(film.title)}--${film.id}`,
  );
  const existing = await findFilmFolder(dir, film.id);
  if (existing && existing !== want) {
    await mkdir(path.join(dir, path.dirname(want)), { recursive: true });
    await must(dir, ["mv", existing, want]);
  }
  const target = path.join(dir, want);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await copySource(filmDir(film.id), target, film.kind === "video");
  if (film.kind === "video") await writeMediaManifest(film.id, target);
  await copyBrand(dir, film.brand ?? DEFAULT_BRAND);
  await writeFile(path.join(target, "README.md"), await filmReadme(film));
  return want;
}

async function findFilmFolder(dir: string, id: string): Promise<string | null> {
  const films = path.join(dir, "films");
  for (const year of await readdir(films).catch(() => [])) {
    for (const month of await readdir(path.join(films, year)).catch(() => [])) {
      for (const name of await readdir(path.join(films, year, month)).catch(() => [])) {
        if (name.endsWith(`--${id}`)) return path.posix.join("films", year, month, name);
      }
    }
  }
  return null;
}

// Copies a film's source: everything but footage, renders, history,
// installs and build output. Font files go only with their licence beside
// them. A video film's media/ is footage and stays home (see media.json);
// a rust film's media/ holds its fonts and goes.
async function copySource(from: string, to: string, isVideo: boolean, top = true) {
  const entries = await readdir(from, { withFileTypes: true }).catch(() => []);
  const names = new Set(entries.map((e) => e.name));
  const licensed = [...names].some((n) => /^(OFL|LICEN[CS]E)(\.txt|\.md)?$/i.test(n));
  for (const entry of entries) {
    const src = path.join(from, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || (top && isVideo && entry.name === "media")) continue;
      await copySource(src, path.join(to, entry.name), isVideo, false);
      continue;
    }
    if (SKIP_FILES.has(entry.name) || entry.name.startsWith(".env") || /\.(log|tmp|part)$/i.test(entry.name)) continue;
    if (MEDIA_EXT.test(entry.name)) continue;
    if (FONT_EXT.test(entry.name) && !licensed) continue;
    const size = (await stat(src)).size;
    if (size > MAX_FILE) continue;
    await mkdir(to, { recursive: true });
    await cp(src, path.join(to, entry.name));
  }
}

// What footage the film uses, so it can be found again without being stored.
async function writeMediaManifest(id: string, target: string) {
  const media = await listMedia(id);
  const items = [];
  for (const m of media) {
    const file = path.join(mediaDir(id, m.id), m.original);
    const info = await stat(file).catch(() => null);
    items.push({
      id: m.id,
      name: m.name,
      kind: m.kind,
      duration: m.duration,
      width: m.width,
      height: m.height,
      fps: m.fps,
      size: info?.size ?? null,
      sha256: info ? await sha256(file, info.size, info.mtimeMs, mediaDir(id, m.id)) : null,
      drive: null,
    });
  }
  await writeFile(path.join(target, "media.json"), `${JSON.stringify({ note: "The footage this film uses. The files themselves are not kept here.", media: items }, null, 2)}\n`);
}

// Hashing gigabytes takes a moment, so each file's hash is kept beside it.
async function sha256(file: string, size: number, mtimeMs: number, folder: string) {
  const cache = path.join(folder, "sha256.json");
  try {
    const c = JSON.parse(await readFile(cache, "utf8")) as { size: number; mtimeMs: number; sha256: string };
    if (c.size === size && c.mtimeMs === mtimeMs) return c.sha256;
  } catch {}
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    createReadStream(file)
      .on("data", (d) => hash.update(d))
      .on("end", () => resolve())
      .on("error", reject);
  });
  const value = hash.digest("hex");
  await writeFile(cache, JSON.stringify({ size, mtimeMs, sha256: value })).catch(() => {});
  return value;
}

// The film's brand kit, once per brand, beside the films. Only the kit, its
// logos and fonts whose licence allows sharing; the guideline files it was
// made from stay on this Mac.
async function copyBrand(dir: string, brand: string) {
  if (!/^[a-z0-9-]{1,40}$/.test(brand)) return;
  const source = [path.join(ROOT, "brands", brand), path.join(ROOT, "studio/brands", brand)].find((p) => existsSync(path.join(p, "brand.json")));
  if (!source) return;
  const target = path.join(dir, "brands", brand);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await cp(path.join(source, "brand.json"), path.join(target, "brand.json"));
  if (existsSync(path.join(source, "logos"))) await copySource(path.join(source, "logos"), path.join(target, "logos"), false, false);
  if (existsSync(path.join(source, "fonts"))) {
    await copySource(path.join(source, "fonts"), path.join(target, "fonts"), false, false);
    if (!existsSync(path.join(target, "fonts"))) {
      await mkdir(path.join(target, "fonts"), { recursive: true });
      await writeFile(path.join(target, "fonts", "README.md"), "The brand's fonts aren't stored here because their licence doesn't allow sharing. They are on the studio's Mac.\n");
    }
  }
}

// ─── READMEs ──────────────────────────────────────────────────────────────

const KIND = (f: Film) => (f.kind === "video" ? "Video edit" : "Motion graphics");
const length = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

async function filmReadme(film: Film) {
  const render = await readFile(path.join(outDir(film.id), "render.json"), "utf8")
    .then((t) => JSON.parse(t) as RenderStatus)
    .catch(() => null);
  const drive = await driveRecord(film.id);
  const lines = [
    `# ${film.title}`,
    "",
    `${KIND(film)}, ${film.width} x ${film.height}, ${length(film.duration)} at ${film.fps} fps. Brand: ${film.brand ?? DEFAULT_BRAND}. Film id \`${film.id}\`.`,
    "",
    "## Renders",
    "",
  ];
  if (render?.state === "done") lines.push(`Last render: ${render.quality === "final" ? "final" : "draft"}, ${render.at.slice(0, 10)}.`);
  else lines.push("Not rendered yet.");
  if (drive.state === "saved" && drive.files?.length) {
    lines.push("", ...drive.files.map((f) => `- [${f.name}](${f.link}) on Google Drive`));
  }
  lines.push(
    "",
    "## What's here",
    "",
    "- `film.json`: the film's size, length, settings and named moments.",
    film.kind === "video" ? "- `edit.json`: the cut: clips, graphics, music and captions. `media.json` lists the footage it uses (the footage itself isn't stored)." : "- The film's own code (`index.html`, `src/` or a Cargo crate), as the studio wrote it.",
    "- `sound/score.js`, if the film has sound design.",
    "",
    "Open it in Saymo, the open-source motion studio, to change or render it.",
    "",
  );
  return lines.join("\n");
}

async function writeIndex(dir: string, fullName: string) {
  // "saymo" is the marker that identifies a library repo.
  await writeFile(path.join(dir, "studio.json"), `${JSON.stringify({ studio: "saymo", layout: 1, schemas: SCHEMA }, null, 2)}\n`);
  await writeFile(path.join(dir, ".gitattributes"), "* text=auto eol=lf\n*.png binary\n*.jpg binary\n*.ttf binary\n*.otf binary\n*.woff binary\n*.woff2 binary\n");
  await writeFile(
    path.join(dir, ".gitignore"),
    "# Kept out by the studio: footage, renders and build output.\n*.mp4\n*.mov\n*.wav\n*.aiff\n*.mp3\nnode_modules/\ntarget/\nout/\n.history/\n.DS_Store\n",
  );
  const rows: string[] = [];
  const films = path.join(dir, "films");
  const found: { film: Film; folder: string }[] = [];
  for (const year of (await readdir(films).catch(() => [])).sort().reverse()) {
    for (const month of (await readdir(path.join(films, year)).catch(() => [])).sort().reverse()) {
      for (const name of (await readdir(path.join(films, year, month)).catch(() => [])).sort()) {
        const f = await readFile(path.join(films, year, month, name, "film.json"), "utf8")
          .then((t) => JSON.parse(t) as Film)
          .catch(() => null);
        if (f) found.push({ film: f, folder: path.posix.join("films", year, month, name) });
      }
    }
  }
  for (const { film, folder } of found) {
    rows.push(`| [${film.title.replace(/\|/g, "/")}](${folder}) | ${KIND(film)} | ${film.brand ?? DEFAULT_BRAND} | ${film.width} x ${film.height} | ${length(film.duration)} | ${film.updatedAt.slice(0, 10)} |`);
  }
  const readme = [
    "# Saymo film library",
    "",
    `The source of every film made in Saymo, the open-source motion studio, saved by the studio itself (${fullName}). Videos live on Google Drive; this repository keeps what they're made from.`,
    "",
    `## Films (${found.length})`,
    "",
    "| Film | Kind | Brand | Size | Length | Last saved |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "## How it's organised",
    "",
    "```",
    "README.md                        this index (the studio rewrites it)",
    "studio.json                      studio and schema versions",
    "brands/<brand-id>/               brand.json, logos, fonts whose licence allows",
    "films/<yyyy>/<mm>/<slug>--<id>/  one folder per film, by the month it was made",
    "  README.md                      what it is, its renders",
    "  film.json                      size, length, settings, moments",
    "  edit.json, media.json          video edits: the cut, and the footage it uses",
    "  index.html | src/ | Cargo.toml the film's own code",
    "  sound/score.js                 sound design",
    "```",
    "",
    "- A film's folder is named by its title and its id; the id never changes, so a renamed film moves, it doesn't duplicate.",
    "- Each save is one commit touching one film's folder (and this index), so many people can save at once.",
    "- Footage and rendered videos are never stored here. `media.json` lists each file's name, size and sha256.",
    "",
  ].join("\n");
  await writeFile(path.join(dir, "README.md"), readme);
}
