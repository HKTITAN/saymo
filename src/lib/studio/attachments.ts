import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Attachment, AttachmentKind } from "./contract";

// Files attached to a prompt: a reference picture, a brief as a PDF, notes.
// They're saved beside the film (refs/) or the kit (guide/) so Claude can
// open them with Read; images and PDFs it reads directly, and a Word file is
// turned into plain text first. Nothing else is accepted.

export const MAX_BYTES = 25 * 1024 * 1024;
export const MAX_PER_PROMPT = 10;

const KINDS: Record<string, AttachmentKind> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  heic: "image",
  heif: "image",
  pdf: "pdf",
  txt: "text",
  md: "text",
  csv: "text",
  json: "text",
  docx: "doc",
};

export class AttachmentError extends Error {}

const run = (cmd: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: "ignore" });
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} failed`))));
  });

// A short, safe file name that keeps the original's words.
function safeName(name: string, ext: string) {
  const base = path
    .basename(name, path.extname(name))
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._ -]/g, "")
    .trim()
    .replace(/[ .]+/g, "-")
    .slice(0, 60);
  return `${base || "file"}-${randomBytes(3).toString("hex")}.${ext}`;
}

// Saves one attachment into `root/folder/`, streamed to disk with a size cap,
// and returns where it is, relative to `root` (e.g. "refs/brief-1a2b3c.pdf").
export async function saveAttachment(
  root: string,
  folder: "refs" | "guide",
  name: string,
  body: ReadableStream<Uint8Array>,
): Promise<Attachment> {
  const clean = path.basename(name).replace(/[\u0000-\u001f]/g, "").trim().slice(0, 200) || "file";
  const ext = path.extname(clean).slice(1).toLowerCase();
  const kind = KINDS[ext];
  if (!kind) {
    throw new AttachmentError(`Claude can't open .${ext || "?"} files. Attach an image, a PDF, a Word file or plain text.`);
  }
  const dir = path.join(root, folder);
  await mkdir(dir, { recursive: true });
  const file = safeName(clean, ext);
  const part = path.join(dir, `.${file}.part`);

  let bytes = 0;
  const cap = new Transform({
    transform(chunk: Buffer, _enc, done) {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) done(new AttachmentError(`${clean} is over 25 MB. Attach a smaller file.`));
      else done(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream), cap, createWriteStream(part));
  } catch (error) {
    await rm(part, { force: true });
    if (error instanceof AttachmentError) throw error;
    throw new AttachmentError(`${clean} didn't arrive in full. Attach it again.`);
  }

  // Phone photos become JPEGs; Word files become text Claude can read.
  let final = path.join(dir, file);
  try {
    if (ext === "heic" || ext === "heif") {
      final = final.replace(/\.(heic|heif)$/, ".jpg");
      await run("sips", ["-s", "format", "jpeg", part, "--out", final]);
      await rm(part, { force: true });
    } else if (ext === "docx") {
      final = final.replace(/\.docx$/, ".txt");
      await run("textutil", ["-convert", "txt", part, "-output", final]);
      await rm(part, { force: true });
    } else {
      await rename(part, final);
    }
  } catch {
    await rm(part, { force: true });
    await rm(final, { force: true });
    throw new AttachmentError(`${clean} couldn't be opened. Try saving it as a PDF or an image.`);
  }
  return { path: `${folder}/${path.basename(final)}`, name: clean, kind };
}

// The attachments a chat message may name: only files that exist in that
// film's refs/ (or that kit's guide/), at most ten.
export async function checkAttachments(root: string, folder: "refs" | "guide", raw: unknown): Promise<Attachment[]> {
  if (!Array.isArray(raw)) return [];
  const out: Attachment[] = [];
  const pattern = new RegExp(`^${folder}/[A-Za-z0-9._-]{1,120}$`);
  for (const item of raw.slice(0, MAX_PER_PROMPT)) {
    const a = item as Partial<Attachment>;
    if (typeof a?.path !== "string" || !pattern.test(a.path) || a.path.includes("..")) continue;
    const full = path.join(root, a.path);
    if (!existsSync(full) || !(await stat(full)).isFile()) continue;
    const kind = Object.values(KINDS).includes(a.kind as AttachmentKind) ? (a.kind as AttachmentKind) : "text";
    const name = typeof a.name === "string" && a.name.trim() ? a.name.trim().slice(0, 120) : path.basename(a.path);
    out.push({ path: a.path, name, kind });
  }
  return out;
}

// What Claude is told about them, with each file's full path to Read.
export function attachmentNote(root: string, list: Attachment[]) {
  if (!list.length) return "";
  const lines = list.map((a) => `- ${path.join(root, a.path)} (${a.kind}, attached as "${a.name}")`);
  return `<attachments>\nThey attached these files to this message. Open each one with Read before you act on the request: images and PDFs read directly, Word files were turned into text.\n${lines.join("\n")}\n</attachments>`;
}
