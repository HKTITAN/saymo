import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createReadStream, createWriteStream, existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import sharp from "sharp";
import type { BrandKit } from "./brand";
import { kitDir, listBrands, readBrand } from "./brands";
import { isBrandId } from "./brand-tokens";
import type { Attachment } from "./contract";
import { AttachmentError, saveAttachment } from "./attachments";
import { filmDir, isId, newId, readFilm, ROOT } from "./films";
import { mediaDir, readMedia } from "./media";
import {
  cleanTags,
  EXTS,
  type LibraryList,
  MAX_BYTES,
  MB,
  type RefEntry,
  type RefFolder,
  type RefItem,
  type RefKind,
  refKindOf,
} from "./references-shared";

// The reference library on disk (see references-shared.ts for the layout).
// Every file keeps its original; the studio makes a picture for its card
// (sharp, ffmpeg, pdftoppm or Quick Look) and, for clips, a few stills
// Claude can look at, since a prompt can't carry video.

export const LIBRARY_DIR = path.join(ROOT, "library");
const TRASH_DIR = path.join(LIBRARY_DIR, ".trash");
const CACHE_DIR = path.join(LIBRARY_DIR, ".cache");
const foldersFile = path.join(LIBRARY_DIR, "folders.json");
export const itemDir = (id: string) => path.join(LIBRARY_DIR, id);
const itemFile = (id: string) => path.join(itemDir(id), "item.json");
const CLONE = constants.COPYFILE_FICLONE;
const TRASH_KEPT = 24 * 60 * 60 * 1000;

export class LibraryError extends Error {}

const g = globalThis as { __libraryLocks?: Map<string, Promise<unknown>> };
const locks = (g.__libraryLocks ??= new Map());
// One change at a time per item (and one to the folder list).
function withItem<T>(key: string, job: () => Promise<T>): Promise<T> {
  const run = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(job);
  locks.set(key, run);
  return run;
}

// ─── Items ────────────────────────────────────────────────────────────────────

export async function readItem(id: string): Promise<RefItem | null> {
  if (!isId(id)) return null;
  try {
    return JSON.parse(await readFile(itemFile(id), "utf8")) as RefItem;
  } catch {
    return null;
  }
}

async function writeItem(item: RefItem) {
  const file = itemFile(item.id);
  await writeFile(`${file}.tmp`, `${JSON.stringify(item, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
}

const fileUrl = (id: string, file: string) => `/api/studio/library/${id}/${encodeURIComponent(file)}`;
const extOf = (name: string) => (name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "");

// Where each file is and what is attached when it's picked.
export function toEntry(item: RefItem): RefEntry {
  const v = `?v=${Date.parse(item.updatedAt).toString(36)}`;
  const file = item.file ? fileUrl(item.id, item.file) : null;
  const safe = item.name.replace(/[/\\:]+/g, " ").replace(/\s+/g, " ").trim() || "Reference";
  const attachName = (ext: string) => `${safe}.${ext}`;
  let attach: RefEntry["attach"] = [];
  if (item.kind === "video") {
    attach = (item.stills ?? []).map((s, i) => ({ url: fileUrl(item.id, s), name: `${safe} frame ${i + 1}.jpg` }));
  } else if (item.kind === "note") {
    attach = [{ url: fileUrl(item.id, "note.md"), name: attachName("md") }];
  } else if (item.kind === "link") {
    attach = [{ url: fileUrl(item.id, "link.md"), name: attachName("md") }];
  } else if (item.attachFile) {
    attach = [{ url: fileUrl(item.id, item.attachFile), name: attachName(extOf(item.attachFile)) }];
  } else if (item.file && item.ext) {
    attach = [{ url: file as string, name: attachName(item.ext) }];
  }
  return {
    ...item,
    thumbUrl: item.thumb ? `${fileUrl(item.id, item.thumb)}${v}` : null,
    fileUrl: item.kind === "link" ? (item.url ?? null) : file,
    previewUrl: item.kind === "video" && item.preview ? fileUrl(item.id, item.preview) : item.kind === "gif" ? file : null,
    attach,
  };
}

export async function listItems(): Promise<RefItem[]> {
  const ids = (await readdir(LIBRARY_DIR).catch(() => [])).filter(isId);
  const items = (await Promise.all(ids.map(readItem))).filter((i): i is RefItem => i !== null);
  void purgeTrash();
  return items;
}

export async function listLibrary(): Promise<LibraryList> {
  const [items, folders, brands] = await Promise.all([listItems(), listLibraryFolders(), brandEntries().catch(() => [])]);
  return { items: items.map(toEntry), folders, brands };
}

// The name on the card: the file's name without its extension, tidied.
const nameFrom = (fileName: string) =>
  path
    .basename(fileName, path.extname(fileName))
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[_]+/g, " ")
    .trim()
    .slice(0, 80) || "Untitled";

const cleanName = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, "").trim().replace(/\s+/g, " ").slice(0, 80) : "");

async function checkFolder(folder: unknown): Promise<string | null> {
  if (typeof folder !== "string" || !isId(folder)) return null;
  return (await listLibraryFolders()).some((f) => f.id === folder) ? folder : null;
}

function blank(kind: RefKind, name: string, folder: string | null): RefItem {
  const now = new Date().toISOString();
  return { id: newId(), kind, name, folder, tags: [], note: "", createdAt: now, updatedAt: now, file: null, thumb: null };
}

// A file as it arrives: streamed to disk with a size cap, then given its
// card picture.
export async function addUpload(fileName: string, body: ReadableStream<Uint8Array>, folderId: unknown): Promise<RefItem> {
  const clean = path.basename(fileName).replace(/[\u0000-\u001f]/g, "").trim().slice(0, 200);
  const kind = refKindOf(clean);
  if (!kind) throw new LibraryError(`The library can't keep .${extOf(clean) || "?"} files. Add a picture, clip, GIF, sound, PDF or text file.`);
  const limit = MAX_BYTES[kind];
  const item = blank(kind, nameFrom(clean), await checkFolder(folderId));
  const ext = extOf(clean);
  item.ext = ext;
  item.file = `original.${ext}`;
  const dir = itemDir(item.id);
  await mkdir(dir, { recursive: true });
  const part = path.join(dir, `.${item.file}.part`);
  let bytes = 0;
  const cap = new Transform({
    transform(chunk: Buffer, _enc, done) {
      bytes += chunk.length;
      if (bytes > limit) done(new LibraryError(`${clean} is over ${limit / MB} MB. Add a smaller file${kind === "video" || kind === "audio" ? " or a shorter clip" : ""}.`));
      else done(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream), cap, createWriteStream(part));
    await rename(part, path.join(dir, item.file));
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    if (error instanceof LibraryError) throw error;
    throw new LibraryError(`${clean} didn't arrive in full. Add it again.`);
  }
  item.size = bytes;
  return finish(item);
}

// A file already on this Mac (a film's attachment or footage), copied in.
async function addCopy(source: string, displayName: string, folder: string | null, from?: RefItem["from"]): Promise<RefItem> {
  const kind = refKindOf(displayName);
  if (!kind) throw new LibraryError(`The library can't keep .${extOf(displayName) || "?"} files.`);
  const info = await stat(source).catch(() => null);
  if (!info?.isFile()) throw new LibraryError("That file isn't in the film any more.");
  if (info.size > MAX_BYTES[kind]) throw new LibraryError(`${displayName} is over ${MAX_BYTES[kind] / MB} MB, too big for the library.`);
  const item = blank(kind, nameFrom(displayName), folder);
  item.ext = extOf(displayName);
  item.file = `original.${item.ext}`;
  item.size = info.size;
  if (from) item.from = from;
  await mkdir(itemDir(item.id), { recursive: true });
  try {
    await copyFile(source, path.join(itemDir(item.id), item.file), CLONE);
  } catch {
    await rm(itemDir(item.id), { recursive: true, force: true });
    throw new LibraryError("Unable to copy the file into the library. Try again.");
  }
  return finish(item);
}

// Makes the card picture and the rest; a file that can't be read at all
// is removed again with a sentence saying why.
async function finish(item: RefItem): Promise<RefItem> {
  const dir = itemDir(item.id);
  try {
    await prepare(item, dir);
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    if (error instanceof LibraryError) throw error;
    throw new LibraryError(`${item.name} couldn't be read. Try saving it in another format.`);
  }
  await writeItem(item);
  return item;
}

// Saved from a film: a file attached to one of its prompts (refs/), or a
// piece of its footage.
export async function addFromFilm(body: Record<string, unknown>): Promise<RefItem> {
  const film = typeof body.film === "string" ? body.film : "";
  const record = await readFilm(film);
  if (!record) throw new LibraryError("That film no longer exists.");
  const folder = await checkFolder(body.folder);
  const from = { film, title: record.title };
  if (typeof body.media === "string") {
    const media = await readMedia(film, body.media);
    if (!media) throw new LibraryError("That footage isn't in the film any more.");
    return addCopy(path.join(mediaDir(film, media.id), media.original), media.name, folder, from);
  }
  const rel = typeof body.path === "string" ? body.path : "";
  if (!/^refs\/[A-Za-z0-9._-]{1,120}$/.test(rel) || rel.includes("..")) throw new LibraryError("That isn't one of the film's attached files.");
  // The name it was attached as, with the extension of the file as kept
  // (Word files are kept as text, phone photos as JPEG).
  const ext = extOf(rel);
  const given = cleanName(body.name) || path.basename(rel);
  const display = `${path.basename(given, path.extname(given)) || "Attachment"}.${ext}`;
  return addCopy(path.join(filmDir(film), rel), display, folder, from);
}

// ─── Notes and links ──────────────────────────────────────────────────────────

export async function addNote(text: unknown, folderId: unknown, name?: unknown): Promise<RefItem> {
  const body = typeof text === "string" ? text.replace(/\r\n/g, "\n").trim().slice(0, 20_000) : "";
  if (!body) throw new LibraryError("Write the note first.");
  const first = body.split("\n")[0].replace(/^#+\s*/, "").trim();
  const item = blank("note", cleanName(name) || first.split(/\s+/).slice(0, 6).join(" ").slice(0, 60) || "Note", await checkFolder(folderId));
  item.note = "";
  item.excerpt = body.slice(0, 600);
  await mkdir(itemDir(item.id), { recursive: true });
  await writeFile(path.join(itemDir(item.id), "note.md"), `${body}\n`);
  await writeItem(item);
  return item;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();

function meta(html: string, key: string) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  return tag ? decode(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? "") : "";
}

async function fetchCapped(url: string, max: number, ms: number) {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(ms),
    headers: { "user-agent": "Mozilla/5.0 (Macintosh) MotionStudio/1.0", accept: "text/html,image/*;q=0.9,*/*;q=0.5" },
  });
  if (!res.ok || !res.body) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > max) break;
    chunks.push(chunk);
  }
  return { res, body: Buffer.concat(chunks) };
}

// A link: the page's title, its summary and its picture, where it has them.
export async function addLink(raw: unknown, folderId: unknown, note?: unknown): Promise<RefItem> {
  let url: URL;
  try {
    url = new URL(typeof raw === "string" ? raw.trim() : "");
  } catch {
    throw new LibraryError("Paste a full link, starting with https://.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new LibraryError("Paste a web link, starting with https://.");
  const site = url.hostname.replace(/^www\./, "");
  const item = blank("link", site, await checkFolder(folderId));
  item.url = url.toString();
  item.site = site;
  if (typeof note === "string") item.note = note.trim().slice(0, 2000);
  await mkdir(itemDir(item.id), { recursive: true });
  try {
    const page = await fetchCapped(item.url, 768 * 1024, 7000);
    if (page && /html/i.test(page.res.headers.get("content-type") ?? "")) {
      const html = page.body.toString("utf8");
      const title = meta(html, "og:title") || decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "");
      if (title) item.name = title.slice(0, 80);
      const description = meta(html, "og:description") || meta(html, "description");
      if (description) item.description = description.slice(0, 400);
      const image = meta(html, "og:image") || meta(html, "twitter:image");
      if (image) {
        const pic = await fetchCapped(new URL(image, page.res.url).toString(), 8 * MB, 7000).catch(() => null);
        if (pic && pic.body.length) {
          await sharp(pic.body, { animated: false })
            .resize({ width: 720, height: 720, fit: "inside", withoutEnlargement: true })
            .webp({ quality: 82 })
            .toFile(path.join(itemDir(item.id), "thumb.webp"));
          item.thumb = "thumb.webp";
        }
      }
    }
  } catch {
    // Kept as a plain link: the page didn't answer, or had nothing to show.
  }
  await writeItem(item);
  return item;
}

// What Claude reads for a link or a note.
export async function textFor(item: RefItem, file: "note.md" | "link.md"): Promise<string | null> {
  if (file === "note.md" && item.kind === "note") {
    const body = await readFile(path.join(itemDir(item.id), "note.md"), "utf8").catch(() => "");
    return item.note ? `${body.trim()}\n\nNote: ${item.note}\n` : body;
  }
  if (file === "link.md" && item.kind === "link") {
    return [
      `# ${item.name}`,
      "",
      `Link: ${item.url}`,
      item.description ? `\nWhat the page says about itself: ${item.description}` : "",
      item.note ? `\nWhy it was saved: ${item.note}` : "",
      item.tags.length ? `\nTags: ${item.tags.join(", ")}` : "",
      "",
    ].join("\n");
  }
  return null;
}

// ─── Making the pictures ──────────────────────────────────────────────────────

function run(cmd: string, args: string[], { timeout = 120_000 }: { timeout?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err = (err + c).slice(-2000)));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} ${code}: ${err.trim().slice(-300)}`));
    });
  });
}

const SEARCH = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", ...(process.env.PATH ?? "").split(":")];
const which = (cmd: string) => SEARCH.map((d) => path.join(d, cmd)).find((p) => existsSync(p)) ?? null;

type Probe = {
  streams?: { codec_type?: string; width?: number; height?: number; side_data_list?: { rotation?: number }[]; tags?: { rotate?: string }; disposition?: { attached_pic?: number } }[];
  format?: { duration?: string };
};
const probe = async (file: string) => JSON.parse(await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file])) as Probe;

const THUMB = { width: 720, height: 720, fit: "inside" as const, withoutEnlargement: true };

async function prepare(item: RefItem, dir: string) {
  const original = path.join(dir, item.file as string);
  const ext = item.ext ?? "";
  if (item.kind === "image" || item.kind === "gif") {
    let source = original;
    if (ext === "heic" || ext === "heif") {
      source = path.join(dir, ".converted.jpg");
      await run("sips", ["-s", "format", "jpeg", original, "--out", source]);
    }
    const picture = sharp(source, { animated: false, density: ext === "svg" ? 216 : undefined }).rotate();
    const info = await picture.metadata();
    item.width = info.width;
    item.height = info.height;
    await picture.clone().resize(THUMB).webp({ quality: 84 }).toFile(path.join(dir, "thumb.webp"));
    item.thumb = "thumb.webp";
    // Claude reads PNG, JPEG, WebP and GIF; the rest go as a PNG.
    if (["svg", "avif", "tif", "tiff", "bmp"].includes(ext)) {
      await picture.clone().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: ext !== "svg" }).png().toFile(path.join(dir, "attach.png"));
      item.attachFile = "attach.png";
    }
    if (source !== original) await rm(source, { force: true });
    return;
  }
  if (item.kind === "video") {
    const info = await probe(original).catch(() => null);
    const video = info?.streams?.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
    const duration = Number(info?.format?.duration ?? 0);
    if (!video || !duration) throw new LibraryError(`${item.name} has no picture the studio can read. Try exporting it as an MP4.`);
    const turned = Math.abs(video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? Number(video.tags?.rotate ?? 0)) % 180 === 90;
    item.width = turned ? video.height : video.width;
    item.height = turned ? video.width : video.height;
    item.duration = Math.round(duration * 100) / 100;
    // Four frames across the clip: the first is the card's picture, and
    // all four go to Claude in place of the clip.
    const stills: string[] = [];
    for (const [i, at] of [0.1, 0.35, 0.6, 0.85].entries()) {
      const name = `still-${i + 1}.jpg`;
      await run("ffmpeg", [
        "-y", "-loglevel", "error", "-ss", (duration * at).toFixed(2), "-i", original,
        "-frames:v", "1", "-vf", "scale='min(1600,iw)':-2", "-q:v", "3", path.join(dir, name),
      ]).catch(() => undefined);
      if (existsSync(path.join(dir, name))) stills.push(name);
    }
    if (!stills.length) throw new LibraryError(`${item.name} has no picture the studio can read. Try exporting it as an MP4.`);
    item.stills = stills;
    await sharp(path.join(dir, stills[0])).resize(THUMB).webp({ quality: 82 }).toFile(path.join(dir, "thumb.webp"));
    item.thumb = "thumb.webp";
    // A small silent copy that plays when the card is hovered.
    await run(
      "ffmpeg",
      [
        "-y", "-loglevel", "error", "-t", "15", "-i", original, "-an",
        "-vf", "scale='if(gt(iw,ih),640,-2)':'if(gt(iw,ih),-2,640)',format=yuv420p",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-movflags", "+faststart", "-f", "mp4", path.join(dir, "preview.mp4"),
      ],
      { timeout: 300_000 },
    )
      .then(() => {
        item.preview = "preview.mp4";
      })
      .catch(() => undefined);
    return;
  }
  if (item.kind === "audio") {
    const info = await probe(original).catch(() => null);
    const duration = Number(info?.format?.duration ?? 0);
    if (!info?.streams?.some((s) => s.codec_type === "audio") || !duration) {
      throw new LibraryError(`${item.name} has no sound the studio can hear. Try saving it as an MP3 or WAV.`);
    }
    item.duration = Math.round(duration * 100) / 100;
    item.peaks = await peaks(original, 96).catch(() => undefined);
    return;
  }
  if (item.kind === "pdf") {
    await pdfThumb(original, dir).catch(() => undefined);
    if (existsSync(path.join(dir, "thumb.webp"))) item.thumb = "thumb.webp";
    const pdfinfo = which("pdfinfo");
    if (pdfinfo) {
      const out = await run(pdfinfo, [original]).catch(() => "");
      const pages = Number(out.match(/^Pages:\s+(\d+)/m)?.[1]);
      if (pages) item.pages = pages;
    }
    return;
  }
  if (item.kind === "text") {
    item.excerpt = (await readFile(original, "utf8").catch(() => "")).slice(0, 600);
    return;
  }
  if (item.kind === "doc") {
    item.excerpt = (await run("textutil", ["-convert", "txt", "-stdout", original]).catch(() => "")).trim().slice(0, 600);
  }
}

// A PDF's first page as the card's picture: poppler when it's installed,
// else Quick Look.
async function pdfThumb(pdf: string, dir: string) {
  const out = path.join(dir, "thumb.webp");
  const pdftoppm = which("pdftoppm");
  if (pdftoppm) {
    const prefix = path.join(dir, ".page");
    await run(pdftoppm, ["-png", "-f", "1", "-l", "1", "-singlefile", "-scale-to", "900", pdf, prefix]);
    await sharp(`${prefix}.png`).resize(THUMB).webp({ quality: 84 }).toFile(out);
    await rm(`${prefix}.png`, { force: true });
    return;
  }
  const work = path.join(dir, ".ql");
  await mkdir(work, { recursive: true });
  await run("/usr/bin/qlmanage", ["-t", "-s", "900", "-o", work, pdf]);
  const png = (await readdir(work)).find((f) => f.endsWith(".png"));
  if (png) await sharp(path.join(work, png)).resize(THUMB).webp({ quality: 84 }).toFile(out);
  await rm(work, { recursive: true, force: true });
}

// The loudness across a sound, `count` values from 0 to 1, for its card.
function peaks(file: string, count: number): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-loglevel", "error", "-i", file, "-vn", "-ac", "1", "-ar", "4000", "-f", "s16le", "pipe:1"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    const parts: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => parts.push(c));
    child.on("error", reject);
    child.on("close", () => {
      const buf = Buffer.concat(parts);
      const samples = Math.floor(buf.length / 2);
      if (!samples) return resolve([]);
      const per = Math.max(1, Math.floor(samples / count));
      const out: number[] = [];
      for (let b = 0; b < count; b++) {
        let peak = 0;
        const end = Math.min(samples, (b + 1) * per);
        for (let i = b * per; i < end; i++) peak = Math.max(peak, Math.abs(buf.readInt16LE(i * 2)));
        out.push(Math.round((peak / 32768) * 1000) / 1000);
      }
      const top = Math.max(...out, 0.001);
      resolve(out.map((p) => Math.round((p / top) * 1000) / 1000));
    });
  });
}

// ─── Changing, deleting, bringing back ─────────────────────────────────────────

export function updateItem(id: string, body: unknown): Promise<RefItem | null | string> {
  return withItem(id, async () => {
    const item = await readItem(id);
    if (!item) return null;
    if (typeof body !== "object" || body === null) return "Send the changes as an object.";
    const b = body as Record<string, unknown>;
    if (b.name !== undefined) {
      const name = cleanName(b.name);
      if (!name) return "Give it a name.";
      item.name = name;
    }
    if (b.note !== undefined) {
      if (typeof b.note !== "string") return "A note is words.";
      item.note = b.note.slice(0, 2000);
    }
    if (b.tags !== undefined) item.tags = cleanTags(b.tags);
    if (b.folder !== undefined) item.folder = b.folder === null ? null : await checkFolder(b.folder);
    item.updatedAt = new Date().toISOString();
    await writeItem(item);
    return item;
  });
}

// Deleted items wait a day in .trash/, so ⌘Z can bring them back.
export function trashItem(id: string): Promise<boolean> {
  return withItem(id, async () => {
    if (!(await readItem(id))) return false;
    await mkdir(TRASH_DIR, { recursive: true });
    await rm(path.join(TRASH_DIR, id), { recursive: true, force: true });
    await rename(itemDir(id), path.join(TRASH_DIR, id));
    return true;
  });
}

export function restoreItem(id: string): Promise<RefItem | null> {
  return withItem(id, async () => {
    if (!isId(id) || existsSync(itemDir(id))) return readItem(id);
    const from = path.join(TRASH_DIR, id);
    if (!existsSync(from)) return null;
    await rename(from, itemDir(id));
    return readItem(id);
  });
}

async function purgeTrash() {
  const ids = (await readdir(TRASH_DIR).catch(() => [])).filter(isId);
  for (const id of ids) {
    const info = await stat(path.join(TRASH_DIR, id)).catch(() => null);
    if (info && Date.now() - info.mtimeMs > TRASH_KEPT) await rm(path.join(TRASH_DIR, id), { recursive: true, force: true });
  }
}

// ─── Into a film's refs/, as attachments (for apps outside the browser) ───────

export async function attachToFilm(id: string, film: string): Promise<Attachment[]> {
  const item = await readItem(id);
  if (!item) throw new LibraryError("That item isn't in the library any more.");
  if (!(await readFilm(film))) throw new LibraryError("That film no longer exists.");
  const entry = toEntry(item);
  const out: Attachment[] = [];
  for (const part of entry.attach) {
    const file = decodeURIComponent(part.url.split("/").pop() ?? "");
    let body: ReadableStream<Uint8Array>;
    if (file === "note.md" || file === "link.md") {
      const text = (await textFor(item, file)) ?? "";
      body = new Response(text).body as ReadableStream<Uint8Array>;
    } else {
      body = Readable.toWeb(createReadStream(path.join(itemDir(id), path.basename(file)))) as ReadableStream<Uint8Array>;
    }
    try {
      out.push(await saveAttachment(filmDir(film), "refs", part.name, body));
    } catch (error) {
      throw new LibraryError(error instanceof AttachmentError ? error.message : `Unable to attach ${part.name}.`);
    }
  }
  return out;
}

// The files a library item may serve, by name.
export function servable(item: RefItem, file: string) {
  const own = [item.file, item.thumb, item.preview, item.attachFile, ...(item.stills ?? [])].filter(Boolean);
  return own.includes(file);
}

// ─── Folders ──────────────────────────────────────────────────────────────────

export async function listLibraryFolders(): Promise<RefFolder[]> {
  try {
    const raw = JSON.parse(await readFile(foldersFile, "utf8")) as { folders?: RefFolder[] };
    return Array.isArray(raw.folders) ? raw.folders.filter((f) => isId(f.id) && typeof f.name === "string") : [];
  } catch {
    return [];
  }
}

async function writeFolders(folders: RefFolder[]) {
  await mkdir(LIBRARY_DIR, { recursive: true });
  await writeFile(`${foldersFile}.tmp`, `${JSON.stringify({ folders }, null, 2)}\n`);
  await rename(`${foldersFile}.tmp`, foldersFile);
}

export const createLibraryFolder = (name: string) =>
  withItem("folders", async () => {
    const folder: RefFolder = { id: newId(), name, createdAt: new Date().toISOString() };
    await writeFolders([...(await listLibraryFolders()), folder]);
    return folder;
  });

export const renameLibraryFolder = (id: string, name: string) =>
  withItem("folders", async () => {
    const folders = await listLibraryFolders();
    const folder = folders.find((f) => f.id === id);
    if (!folder) return null;
    folder.name = name;
    await writeFolders(folders);
    return folder;
  });

// Removes a folder; what was in it stays in the library.
export const deleteLibraryFolder = (id: string) =>
  withItem("folders", async () => {
    const folders = await listLibraryFolders();
    if (!folders.some((f) => f.id === id)) return false;
    await writeFolders(folders.filter((f) => f.id !== id));
    for (const item of await listItems()) {
      if (item.folder !== id) continue;
      await withItem(item.id, async () => {
        const fresh = await readItem(item.id);
        if (!fresh) return;
        fresh.folder = null;
        await writeItem(fresh);
      });
    }
    return true;
  });

// ─── Brand kits, read-only ────────────────────────────────────────────────────
//
// Each kit's logos, guideline files and rules, shown in the library and
// attachable like anything else. They stay in brands/<id>/; nothing is
// copied until one is attached.

const brandFileUrl = (kit: string, file: string) => `/studio/brand/${kit}/${file.split("/").map(encodeURIComponent).join("/")}`;
const madeUrl = (kit: string, file: string, as: "png" | "thumb") =>
  `/api/studio/library/brand/${kit}/${file.split("/").map(encodeURIComponent).join("/")}?as=${as}`;

async function brandEntries(): Promise<RefEntry[]> {
  const out: RefEntry[] = [];
  for (const summary of await listBrands()) {
    const kit = await readBrand(summary.id);
    if (!kit) continue;
    const brand = { id: kit.id, name: kit.name };
    const base = (id: string, kind: RefKind, name: string): RefEntry => ({
      id: `brand:${kit.id}:${id}`,
      kind,
      name,
      folder: null,
      tags: [],
      note: "",
      createdAt: kit.updatedAt,
      updatedAt: kit.updatedAt,
      file: null,
      thumb: null,
      thumbUrl: null,
      fileUrl: null,
      previewUrl: null,
      attach: [],
      brand,
    });
    for (const logo of kit.logos) {
      const ext = extOf(logo.file);
      const e = base(logo.file, "image", logo.name);
      e.thumbUrl = brandFileUrl(kit.id, logo.file);
      e.fileUrl = e.thumbUrl;
      e.ground = logo.on === "light" ? "light" : "dark";
      e.attach = [{ url: ext === "svg" ? madeUrl(kit.id, logo.file, "png") : brandFileUrl(kit.id, logo.file), name: `${kit.name} ${logo.name}.${ext === "svg" ? "png" : ext}` }];
      out.push(e);
    }
    const rules = base("rules.md", "note", "Brand rules");
    rules.excerpt = rulesText(kit).replace(/^# .*\n+/, "").slice(0, 600);
    rules.attach = [{ url: `/api/studio/library/brand/${kit.id}/rules.md`, name: `${kit.name} brand rules.md` }];
    out.push(rules);
    const guide = (await readdir(path.join(kitDir(kit.id), "guide")).catch(() => [])).filter((f) => !f.startsWith(".")).sort();
    for (const name of guide) {
      const kind = refKindOf(name);
      if (!kind || kind === "video" || kind === "audio" || kind === "doc") continue;
      const file = `guide/${name}`;
      // "03-edge-beam-point-light.jpg" reads as "Edge beam point light".
      const words = nameFrom(name).replace(/^\d+[-_ ]+/, "").replace(/[-_]+/g, " ").trim() || nameFrom(name);
      const e = base(file, kind, words.charAt(0).toUpperCase() + words.slice(1));
      e.fileUrl = brandFileUrl(kit.id, file);
      if (kind === "image" || kind === "gif" || kind === "pdf") e.thumbUrl = madeUrl(kit.id, file, "thumb");
      e.attach = [{ url: e.fileUrl, name }];
      out.push(e);
    }
  }
  return out;
}

export function rulesText(kit: BrandKit) {
  const r = kit.colors.roles;
  const list = (title: string, lines: string[]) => (lines.length ? `## ${title}\n\n${lines.map((l) => `- ${l}`).join("\n")}\n` : "");
  return [
    `# ${kit.name} brand rules`,
    "",
    `Colours: background ${r.background}, surface ${r.surface}, ink ${r.ink}, muted ${r.muted}, accent ${r.accent}, line ${r.line}.`,
    kit.fonts.length ? `Fonts: ${kit.fonts.map((f) => `${f.family} (${f.role})`).join(", ")}.` : "",
    "",
    list("Visual", kit.rules.visual),
    list("Motion", kit.rules.motion),
    list("Sound", kit.rules.sound),
    list("Words", kit.rules.words),
    kit.notes ? `## Guideline\n\n${kit.notes.trim()}\n` : "",
  ]
    .filter((s) => s !== null)
    .join("\n");
}

// A kit's file made attachable: its rules as text, a logo drawn as a PNG,
// or a small picture for its card (kept in library/.cache/).
export async function brandFile(kitId: string, segments: string[], as: string | null): Promise<{ file?: string; text?: string; type?: string } | null> {
  if (!isBrandId(kitId)) return null;
  const kit = await readBrand(kitId);
  if (!kit) return null;
  if (segments.length === 1 && segments[0] === "rules.md") return { text: rulesText(kit), type: "text/markdown; charset=utf-8" };
  if (!["logos", "guide"].includes(segments[0] ?? "") || segments.length !== 2) return null;
  if (segments.some((s) => !s || s.startsWith(".") || s.includes("/") || s.includes("\\") || s.includes("\0"))) return null;
  const root = kitDir(kitId);
  const source = path.resolve(root, ...segments);
  if (!source.startsWith(root + path.sep)) return null;
  const info = await stat(source).catch(() => null);
  if (!info?.isFile()) return null;
  if (as !== "png" && as !== "thumb") return { file: source };
  const key = createHash("sha1").update(`${source}|${info.mtimeMs}|${as}`).digest("hex").slice(0, 20);
  const out = path.join(CACHE_DIR, "brand", `${key}.${as === "png" ? "png" : "webp"}`);
  if (!existsSync(out)) {
    await mkdir(path.dirname(out), { recursive: true });
    const ext = extOf(source);
    if (ext === "pdf") {
      const work = path.join(CACHE_DIR, `.work-${key}`);
      await mkdir(work, { recursive: true });
      try {
        await pdfThumb(source, work);
        await rename(path.join(work, "thumb.webp"), out);
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    } else {
      const picture = sharp(source, { animated: false, density: ext === "svg" ? 216 : undefined });
      if (as === "png") await picture.resize({ width: 2048, height: 2048, fit: "inside" }).png().toFile(`${out}.part`);
      else await picture.resize(THUMB).webp({ quality: 82 }).toFile(`${out}.part`);
      await rename(`${out}.part`, out);
    }
  }
  return { file: out };
}

export const ALL_EXTS = Object.values(EXTS).flat();
