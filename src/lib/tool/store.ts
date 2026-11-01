import { randomBytes } from "node:crypto";
import { copyFile, cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { MOTION_BY_ID } from "@/components/post/lines";
import { post } from "@/content/post";
import type { DocEdit, PostDoc } from "./doc";

// The tool's posts live in posts/<id>/: post.json plus the photo, image and
// export files. Nothing else stores them, so the folder is the backup.

export const POSTS_DIR = path.join(process.cwd(), "posts");
export const isId = (id: string) => /^[a-z0-9]{8}$/.test(id);
export const postDir = (id: string) => path.join(POSTS_DIR, id);
const docFile = (id: string) => path.join(postDir(id), "post.json");

// Files are served by /api/posts/<id>/files/<name>. The `v` changes with
// every new version of a file, so browsers can keep each one for good.
export const fileUrl = (id: string, name: string) =>
  `/api/posts/${id}/files/${name}?v=${Date.now().toString(36)}`;

const g = globalThis as {
  __postLocks?: Map<string, Promise<unknown>>;
  __postSeed?: Promise<PostDoc>;
};

// One change at a time per post: uploads and saves read the file, change
// it and write it back, and must not overlap.
const locks = (g.__postLocks ??= new Map());
export function withPost<T>(id: string, job: () => Promise<T>): Promise<T> {
  const run = (locks.get(id) ?? Promise.resolve()).catch(() => {}).then(job);
  locks.set(id, run);
  return run;
}

export async function readDoc(id: string): Promise<PostDoc | null> {
  if (!isId(id)) return null;
  try {
    return JSON.parse(await readFile(docFile(id), "utf8")) as PostDoc;
  } catch {
    return null;
  }
}

export async function writeDoc(doc: PostDoc) {
  // Written aside and renamed, so a crash never leaves half a file.
  const file = docFile(doc.id);
  await writeFile(`${file}.tmp`, `${JSON.stringify(doc, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
}

export async function listDocs(): Promise<PostDoc[]> {
  if (g.__postSeed) await g.__postSeed;
  const ids = await readdir(POSTS_DIR).catch(() => null);
  // The very first visit starts with a copy of the original post (once,
  // however many requests arrive together).
  if (ids === null) {
    g.__postSeed ??= seed();
    const doc = await g.__postSeed;
    g.__postSeed = undefined;
    return [doc];
  }
  const docs = await Promise.all(ids.filter(isId).map(readDoc));
  return docs
    .filter((d): d is PostDoc => d !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// Eight lower-case letters and digits.
const newId = () =>
  Array.from(randomBytes(8), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

// The original post, src/content/post.ts, as the tool's first post. It
// points at the original's own photo tiles and landmark files, so it looks
// exactly like the original until something is changed.
async function seed() {
  const id = newId();
  await mkdir(postDir(id), { recursive: true });
  const now = new Date().toISOString();
  const [date, location] = post.event;
  // The original photo is kept too, so the crop can still change.
  const original = path.join(process.cwd(), "assets/speakers/darshan-kadam.png");
  const { width = 0, height = 0 } = await sharp(original).metadata();
  await copyFile(original, path.join(postDir(id), "photo-source.png"));
  await sharp(original)
    .resize({ width: 720, height: 720, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toFile(path.join(postDir(id), "photo-preview.jpg"));
  const doc: PostDoc = {
    id,
    createdAt: now,
    updatedAt: now,
    title: [...post.title],
    titleSize: 86,
    speaker: { name: post.speaker.name, role: post.speaker.role, company: post.speaker.company },
    date: { lines: [date.lines[0], date.lines[1]], pick: null },
    location: { lines: [location.lines[0], location.lines[1]], orange: location.accent.split(" ") },
    photo: {
      ...post.speaker.photo,
      source: { width, height, preview: fileUrl(id, "photo-preview.jpg") },
      crop: { x: 23, y: 10, size: 331 },
      plain: false,
    },
    image: {
      name: post.skyline.landmark,
      x1: post.skyline.x1,
      x2: post.skyline.x2,
      width: 920,
      height: 1080,
      place: { ...post.skyline.place },
      note: "",
    },
  };
  await writeDoc(doc);
  return doc;
}

// With nothing to start from: the original post's event, no speaker yet.
const blank = (id: string, now: string): PostDoc => ({
  id,
  createdAt: now,
  updatedAt: now,
  title: ["Talk title:", "the rest of the", "headline here"],
  titleSize: 86,
  speaker: { name: "", role: "", company: post.speaker.company },
  date: { lines: [post.event[0].lines[0], post.event[0].lines[1]], pick: null },
  location: {
    lines: [post.event[1].lines[0], post.event[1].lines[1]],
    orange: post.event[1].accent.split(" "),
  },
  photo: null,
  image: null,
});

const PHOTO_FILES = ["photo-source.png", "photo-plain.png", "photo-preview.jpg", "photo-240.png", "photo-480.png"];

// A new post from an existing one: "copy" keeps everything; "next" keeps
// the headline, event, date and image, and clears the speaker for the next
// one.
export async function createDoc(from: PostDoc | null, mode: "copy" | "next") {
  const id = newId();
  const dir = postDir(id);
  const now = new Date().toISOString();
  await mkdir(POSTS_DIR, { recursive: true });

  let doc: PostDoc;
  if (from) {
    // Its files come along (never its exports), and its links move over.
    const fromDir = postDir(from.id);
    await cp(fromDir, dir, {
      recursive: true,
      filter: (src) => path.relative(fromDir, src).split(path.sep)[0] !== "export",
    });
    const moved = JSON.stringify(from).replaceAll(`/api/posts/${from.id}/`, `/api/posts/${id}/`);
    doc = { ...(JSON.parse(moved) as PostDoc), id, createdAt: now, updatedAt: now };
  } else {
    await mkdir(dir, { recursive: true });
    doc = blank(id, now);
  }

  if (mode === "next") {
    doc.speaker = { name: "", role: "", company: doc.speaker.company };
    doc.photo = null;
    await Promise.all(PHOTO_FILES.map((f) => rm(path.join(dir, f), { force: true })));
  }
  await writeDoc(doc);
  return doc;
}

export async function deleteDoc(id: string) {
  if (isId(id)) await rm(postDir(id), { recursive: true, force: true });
}

// What the browser saves: the words, the fitted headline size, and where
// the image sits. Anything else in the body is ignored.
export function applyEdit(doc: PostDoc, edit: Partial<DocEdit>): PostDoc {
  const text = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
  const two = (v: unknown): [string, string] => {
    const a = Array.isArray(v) ? v : [];
    return [text(a[0]), text(a[1])];
  };
  const num = (v: unknown, lo: number, hi: number, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

  const pick = edit.date?.pick;
  const next: PostDoc = {
    ...doc,
    motion:
      typeof edit.motion === "string" && Object.hasOwn(MOTION_BY_ID, edit.motion) ? edit.motion : doc.motion,
    title: Array.isArray(edit.title) ? edit.title.slice(0, 8).map((l) => text(l)) : doc.title,
    titleSize: num(edit.titleSize, 24, 86, doc.titleSize),
    speaker: {
      name: text(edit.speaker?.name),
      role: text(edit.speaker?.role),
      company: text(edit.speaker?.company),
    },
    date: {
      lines: two(edit.date?.lines),
      pick: pick
        ? {
            start: text(pick.start, 10),
            end: text(pick.end, 10),
            time: text(pick.time, 5),
            endTime: text(pick.endTime, 5),
          }
        : null,
    },
    location: {
      lines: two(edit.location?.lines),
      orange: Array.isArray(edit.location?.orange)
        ? edit.location.orange.slice(0, 24).map((w) => text(w, 60)).filter(Boolean)
        : [],
    },
  };
  if (doc.image && edit.image) {
    const { place } = edit.image;
    next.image = {
      ...doc.image,
      name: text(edit.image.name),
      place: {
        x: num(place?.x, -2000, 2000, doc.image.place.x),
        y: num(place?.y, -2000, 2000, doc.image.place.y),
        scale: num(place?.scale, 0.1, 4, doc.image.place.scale),
      },
    };
  }
  return next;
}
