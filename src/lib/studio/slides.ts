import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { FILMS_DIR, newId, ROOT } from "./films";
import { type Box, extOf, isImageFile, MAX_SLIDES, type Slide, type SlideChart, type SlideImport, type SlidePicture } from "./slides-shared";
import { openZip, type Zip } from "./zip";

// Turning a deck into slides: a PDF, PowerPoint (.pptx, .ppt), Keynote
// (.key), OpenDocument (.odp) or pictures become one high-resolution PNG
// per slide (at least 1920 px wide) with the slide's words and speaker
// notes, plus, for PowerPoint, the pictures and chart data inside each
// slide so Claude can rebuild them for real.
//
// Each conversion runs a fixed program with fixed arguments (never a shell
// string with a file name in it):
//   PDF         poppler's pdftoppm and pdftotext when installed, else the
//               Mac's own PDFKit (scripts/slides.swift)
//   PowerPoint  words, notes, pictures and charts read from the file's XML;
//               slides drawn by LibreOffice (soffice) when installed, else
//               by Keynote, else words only, and she's asked for a PDF too
//   Keynote     exported to PDF by Keynote itself (AppleScript), which also
//               hands over the presenter notes
//   pictures    sips, and the Mac's text recognition reads their words
//
// Slides wait in films/.imports/<id>/ until a film is made from them (the
// studio's film list skips names that aren't film ids), and are cleared
// after a day.

export const IMPORTS_DIR = path.join(FILMS_DIR, ".imports");
export const isImportId = (id: string) => /^[a-z0-9]{8}$/.test(id);
export const importDir = (id: string) => path.join(IMPORTS_DIR, id);

export const MIN_WIDTH = 1920;
const MAX_WIDTH = 3840;

export class SlidesError extends Error {}

// ─── Running the tools ───────────────────────────────────────────────────────

type Ran = { code: number; stdout: Buffer; stderr: string };

function run(cmd: string, args: string[], { timeout = 120_000, cwd }: { timeout?: number; cwd?: string } = {}) {
  return new Promise<Ran>((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], cwd });
    const out: Buffer[] = [];
    let err = "";
    let size = 0;
    proc.stdout.on("data", (c: Buffer) => {
      size += c.length;
      if (size < 32 * 1024 * 1024) out.push(c);
    });
    proc.stderr.on("data", (c) => {
      err = (err + c).slice(-4000);
    });
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeout);
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout: Buffer.concat(out), stderr: err });
    });
  });
}

async function mustRun(cmd: string, args: string[], opts?: { timeout?: number; cwd?: string }) {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) throw new Error(`${path.basename(cmd)} failed: ${r.stderr.trim().slice(-300)}`);
  return r;
}

const SEARCH = [...new Set(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", ...(process.env.PATH ?? "").split(":")])].filter(Boolean);
function which(cmd: string, extra: string[] = []): string | null {
  for (const dir of SEARCH) {
    const full = path.join(dir, cmd);
    if (existsSync(full)) return full;
  }
  return extra.find((p) => existsSync(p)) ?? null;
}

export const tools = () => ({
  pdftoppm: which("pdftoppm"),
  pdftotext: which("pdftotext"),
  soffice: which("soffice", ["/Applications/LibreOffice.app/Contents/MacOS/soffice"]),
});

// Keynote's id, if it's installed (the App Store copy, or Creator Studio's).
let keynoteId: string | null = null;
export async function findKeynote(): Promise<string | null> {
  // STUDIO_KEYNOTE=off in .env.local: never open Keynote.
  if (process.env.STUDIO_KEYNOTE === "off") return null;
  if (keynoteId) return keynoteId;
  for (const app of ["/Applications/Keynote.app", "/Applications/Keynote Creator Studio.app"]) {
    if (!existsSync(app)) continue;
    const r = await run("/usr/bin/defaults", ["read", path.join(app, "Contents/Info"), "CFBundleIdentifier"]).catch(() => null);
    const id = r?.stdout.toString().trim() ?? "";
    if (/^com\.apple\.(iWork\.)?Keynote$/.test(id)) return (keynoteId = id);
  }
  return null;
}

// ─── The Mac's own helper (PDFKit, text recognition) ─────────────────────────

const HELPER_SOURCE = path.join(ROOT, "scripts/slides.swift");
const HELPER = path.join(ROOT, "node_modules/.cache/studio-slides/slides");
const g = globalThis as { __slidesHelper?: Promise<string | null> };

async function helper(): Promise<string | null> {
  const [source, binary] = await Promise.all([stat(HELPER_SOURCE).catch(() => null), stat(HELPER).catch(() => null)]);
  if (!source) return null;
  if (binary && binary.mtimeMs >= source.mtimeMs) return HELPER;
  g.__slidesHelper ??= (async () => {
    try {
      await mkdir(path.dirname(HELPER), { recursive: true });
      await promisify(execFile)("swiftc", ["-O", HELPER_SOURCE, "-o", HELPER], { timeout: 180_000 });
      return HELPER;
    } catch (error) {
      console.error("Could not build the slides helper:", error);
      return null;
    } finally {
      g.__slidesHelper = undefined;
    }
  })();
  return g.__slidesHelper;
}

// The words in a picture, read by the Mac (empty if it can't).
async function readWords(file: string) {
  const bin = await helper();
  if (!bin) return "";
  const r = await run(bin, ["ocr", file], { timeout: 60_000 }).catch(() => null);
  return r?.code === 0 ? tidyText(r.stdout.toString("utf8")) : "";
}

// ─── Words ───────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

// Lines kept, spaces tidied, no runs of blank lines.
export const tidyText = (s: string) =>
  s
    .replace(/\r\n?/g, "\n")
    .replace(/\f/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 8000);

// A slide's title: its first line of words, unless that's only a number.
const firstLine = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !/^\d{1,3}$/.test(l))
    ?.slice(0, 140) ?? "";

// ─── PDF ─────────────────────────────────────────────────────────────────────

type Page = { file: string; width: number; height: number; text: string };

async function pngSize(file: string): Promise<{ width: number; height: number }> {
  const head = Buffer.alloc(24);
  const { open } = await import("node:fs/promises");
  const fh = await open(file, "r");
  try {
    await fh.read(head, 0, 24, 0);
  } finally {
    await fh.close();
  }
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

// Draws a PDF's pages as PNGs into `dir` (page-001.png…) and reads their words.
async function pdfPages(pdf: string, dir: string, onStep: (label: string) => void, max = MAX_SLIDES): Promise<Page[]> {
  await mkdir(dir, { recursive: true });
  const t = tools();
  let pages: Page[] = [];
  if (t.pdftoppm) {
    onStep("Drawing the slides");
    const prefix = path.join(dir, "p");
    await mustRun(t.pdftoppm, ["-png", "-l", String(max), "-scale-to-x", String(MIN_WIDTH), "-scale-to-y", "-1", pdf, prefix], { timeout: 600_000 });
    const files = (await readdir(dir))
      .filter((f) => /^p-\d+\.png$/.test(f))
      .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
    let texts: string[] = [];
    if (t.pdftotext) {
      onStep("Reading the words");
      const r = await run(t.pdftotext, ["-enc", "UTF-8", "-l", String(max), pdf, "-"], { timeout: 120_000 }).catch(() => null);
      if (r?.code === 0) texts = r.stdout.toString("utf8").split("\f");
    }
    pages = await Promise.all(
      files.map(async (f, i) => {
        const file = path.join(dir, `page-${String(i + 1).padStart(3, "0")}.png`);
        await rename(path.join(dir, f), file);
        return { file, ...(await pngSize(file)), text: tidyText(texts[i] ?? "") };
      }),
    );
  } else {
    const bin = await helper();
    if (!bin) throw new SlidesError("This Mac can't open PDFs yet. Run npm run setup, then try again.");
    onStep("Drawing the slides");
    const r = await run(bin, ["pdf", pdf, dir, String(MIN_WIDTH)], { timeout: 600_000 });
    if (r.code !== 0) throw new SlidesError("This PDF couldn't be opened. Try exporting it again.");
    const list = JSON.parse(r.stdout.toString("utf8")) as { text: string; width: number; height: number }[];
    pages = list.slice(0, max).map((p, i) => ({
      file: path.join(dir, `page-${String(i + 1).padStart(3, "0")}.png`),
      width: p.width,
      height: p.height,
      text: tidyText(p.text),
    }));
  }
  if (!pages.length) throw new SlidesError("This PDF has no pages.");
  // A scanned deck has no words in it: read them off the picture.
  const blank = pages.filter((p) => !p.text);
  if (blank.length) {
    onStep("Reading the words on the slides");
    for (const p of blank) p.text = await readWords(p.file);
  }
  return pages;
}

// ─── PowerPoint (.pptx) and OpenDocument (.odp) words, from their XML ─────────

type DeckText = {
  hidden: boolean;
  title: string;
  text: string;
  notes: string;
  pictures: { data: Buffer; ext: string; box: Box }[];
  charts: SlideChart[];
};

const blocks = (xml: string, tag: string) => {
  const out: string[] = [];
  const open = new RegExp(`<${tag}[\\s>]`, "g");
  let m: RegExpExecArray | null;
  while ((m = open.exec(xml))) {
    // Count nested blocks of the same tag (groups hold shapes).
    let depth = 1;
    let at = m.index + m[0].length;
    const inner = new RegExp(`<${tag}[\\s>]|</${tag}>`, "g");
    inner.lastIndex = at;
    let n: RegExpExecArray | null;
    while (depth && (n = inner.exec(xml))) {
      depth += n[0].startsWith("</") ? -1 : 1;
      at = inner.lastIndex;
    }
    out.push(xml.slice(m.index, at));
    open.lastIndex = at;
  }
  return out;
};

// The paragraphs of a piece of DrawingML, one line each.
const paragraphs = (xml: string) =>
  blocks(xml, "a:p")
    .map((p) =>
      decode(
        p
          .replace(/<a:br\s*\/>/g, "\n")
          .replace(/<a:fld\b[^>]*type="slidenum"[\s\S]*?<\/a:fld>/g, "")
          .match(/<a:t>([\s\S]*?)<\/a:t>|<a:t\/>|\n/g)
          ?.map((t) => (t === "\n" ? "\n" : t.replace(/<\/?a:t\/?>/g, "")))
          .join("") ?? "",
      ),
    )
    .filter((l) => l.trim());

const attr = (xml: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(xml)?.[1] ?? null;

function rels(zip: Zip, part: string): Map<string, { target: string; type: string }> {
  const file = path.posix.join(path.posix.dirname(part), "_rels", `${path.posix.basename(part)}.rels`);
  const xml = zip.text(file) ?? "";
  const map = new Map<string, { target: string; type: string }>();
  for (const r of xml.match(/<Relationship\b[^>]*>/g) ?? []) {
    const id = attr(r, "Id");
    const target = attr(r, "Target");
    if (!id || !target || attr(r, "TargetMode") === "External") continue;
    map.set(id, { target: path.posix.normalize(path.posix.join(path.posix.dirname(part), target)), type: attr(r, "Type") ?? "" });
  }
  return map;
}

function boxOf(xml: string, size: { cx: number; cy: number }): Box | null {
  const off = /<a:off\b[^>]*>/.exec(xml)?.[0];
  const ext = /<a:ext\b[^>]*cx="[^"]*"[^>]*>/.exec(xml)?.[0];
  if (!off || !ext) return null;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return {
    x: r(Number(attr(off, "x")) / size.cx),
    y: r(Number(attr(off, "y")) / size.cy),
    w: r(Number(attr(ext, "cx")) / size.cx),
    h: r(Number(attr(ext, "cy")) / size.cy),
  };
}

const PICTURE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

function chartOf(xml: string, box: Box | null): SlideChart | null {
  const kind = /<c:(bar|line|pie|pie3D|area|doughnut|scatter|radar|bubble|bar3D|line3D|area3D)Chart>/.exec(xml)?.[1];
  if (!kind) return null;
  const dir = attr(/<c:barDir\b[^>]*>/.exec(xml)?.[0] ?? "", "val");
  const type = kind.startsWith("bar") ? (dir === "bar" ? "bar" : "column") : kind.replace("3D", "");
  const values = (s: string) =>
    blocks(s, "c:pt").map((p) => {
      const v = /<c:v>([\s\S]*?)<\/c:v>/.exec(p)?.[1];
      return v === undefined ? "" : decode(v);
    });
  const titleXml = blocks(xml, "c:title")[0] ?? "";
  const series = blocks(xml, "c:ser").slice(0, 12);
  const first = series[0] ?? "";
  const categories = values(blocks(first, "c:cat")[0] ?? blocks(first, "c:xVal")[0] ?? "").slice(0, 60);
  return {
    type,
    title: paragraphs(titleXml).join(" ").slice(0, 140),
    box,
    categories,
    series: series.map((s) => ({
      name: decode(/<c:tx>[\s\S]*?<c:v>([\s\S]*?)<\/c:v>/.exec(s)?.[1] ?? paragraphs(blocks(s, "c:tx")[0] ?? "").join(" ")).slice(0, 80),
      values: values(blocks(s, "c:val")[0] ?? blocks(s, "c:yVal")[0] ?? "")
        .slice(0, 60)
        .map((v) => (v === "" || !Number.isFinite(Number(v)) ? null : Number(v))),
    })),
  };
}

function pptxText(zip: Zip): DeckText[] {
  const pres = zip.text("ppt/presentation.xml");
  if (!pres) throw new SlidesError("This PowerPoint file has no slides in it.");
  const sz = /<p:sldSz\b[^>]*>/.exec(pres)?.[0] ?? "";
  const size = { cx: Number(attr(sz, "cx")) || 12192000, cy: Number(attr(sz, "cy")) || 6858000 };
  const presRels = rels(zip, "ppt/presentation.xml");
  const ids = (blocks(pres, "p:sldIdLst")[0] ?? "").match(/<p:sldId\b[^>]*>/g) ?? [];
  const out: DeckText[] = [];
  for (const id of ids.slice(0, MAX_SLIDES * 2)) {
    const rid = attr(id, "r:id");
    const part = rid ? presRels.get(rid)?.target : null;
    const xml = part ? zip.text(part) : null;
    if (!part || !xml) continue;
    const slideRels = rels(zip, part);
    const shapes = blocks(xml, "p:sp");
    const titled = shapes.find((s) => /<p:ph\b[^>]*type="(title|ctrTitle)"/.test(s));
    const lines = paragraphs(blocks(xml, "p:cSld")[0] ?? xml);
    // Speaker notes: the notes page's body placeholder.
    const notesPart = [...slideRels.values()].find((r) => r.type.endsWith("/notesSlide"))?.target;
    const notesXml = notesPart ? (zip.text(notesPart) ?? "") : "";
    const notes = blocks(notesXml, "p:sp")
      .filter((s) => /<p:ph\b[^>]*type="body"/.test(s))
      .flatMap(paragraphs)
      .join("\n");
    const pictures: DeckText["pictures"] = [];
    for (const pic of blocks(xml, "p:pic").slice(0, 24)) {
      const embed = attr(/<a:blip\b[^>]*>/.exec(pic)?.[0] ?? "", "r:embed");
      const target = embed ? slideRels.get(embed)?.target : null;
      const ext = target ? extOf(target) : "";
      const box = boxOf(blocks(pic, "p:spPr")[0] ?? pic, size);
      const data = target && PICTURE_EXTS.has(ext) ? zip.read(target) : null;
      if (data && box) pictures.push({ data, ext: ext === "jpeg" ? "jpg" : ext, box });
    }
    const charts: SlideChart[] = [];
    for (const frame of blocks(xml, "p:graphicFrame")) {
      const rid2 = attr(/<c:chart\b[^>]*>/.exec(frame)?.[0] ?? "", "r:id");
      const target = rid2 ? slideRels.get(rid2)?.target : null;
      const chartXml = target ? zip.text(target) : null;
      const chart = chartXml ? chartOf(chartXml, boxOf(blocks(frame, "p:xfrm")[0] ?? frame, size)) : null;
      if (chart) charts.push(chart);
    }
    const text = tidyText(lines.join("\n"));
    out.push({
      hidden: /<p:sld\b[^>]*\bshow="0"/.test(xml),
      title: (titled ? paragraphs(titled).join(" ") : firstLine(text)).slice(0, 140),
      text,
      notes: tidyText(notes),
      pictures,
      charts,
    });
  }
  if (!out.length) throw new SlidesError("This PowerPoint file has no slides in it.");
  return out;
}

const odfText = (xml: string) =>
  (xml.match(/<text:(p|h)\b[^>]*>[\s\S]*?<\/text:\1>/g) ?? [])
    .map((p) => decode(p.replace(/<text:line-break\s*\/>/g, "\n").replace(/<text:s\b[^>]*\/>/g, " ").replace(/<text:tab\s*\/>/g, " ").replace(/<[^>]+>/g, "")))
    .filter((l) => l.trim());

function odpText(zip: Zip): DeckText[] {
  const xml = zip.text("content.xml");
  if (!xml) throw new SlidesError("This presentation has no slides in it.");
  return blocks(xml, "draw:page")
    .slice(0, MAX_SLIDES * 2)
    .map((page) => {
      const notesXml = blocks(page, "presentation:notes")[0] ?? "";
      const body = page.replace(notesXml, "");
      const titled = blocks(body, "draw:frame").find((f) => /presentation:class="title"/.test(f));
      const text = tidyText(odfText(body).join("\n"));
      return {
        hidden: false,
        title: (titled ? odfText(titled).join(" ") : firstLine(text)).slice(0, 140),
        text,
        notes: tidyText(odfText(notesXml).join("\n")),
        pictures: [],
        charts: [],
      };
    });
}

// ─── Drawing decks that aren't PDFs ──────────────────────────────────────────

// LibreOffice, headless, with its own settings folder so it never clashes
// with a copy that's open.
async function sofficePdf(soffice: string, file: string, work: string): Promise<string> {
  const profile = await mkdtemp(path.join(tmpdir(), "studio-soffice-"));
  try {
    await mustRun(
      soffice,
      [`-env:UserInstallation=file://${profile}`, "--headless", "--norestore", "--convert-to", "pdf", "--outdir", work, file],
      { timeout: 300_000 },
    );
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
  const pdf = path.join(work, `${path.basename(file, path.extname(file))}.pdf`);
  if (!existsSync(pdf)) throw new Error("LibreOffice made no PDF.");
  return pdf;
}

// Keynote opens the deck, exports it as a PDF (skipped slides left out),
// hands back each slide's presenter notes, and closes it without saving.
// If Keynote wasn't open before, it's quit again.
const KEYNOTE_SCRIPT = (id: string) => [
  "on run argv",
  "set inFile to POSIX file (item 1 of argv)",
  "set outFile to POSIX file (item 2 of argv)",
  `set wasOpen to application id "${id}" is running`,
  `tell application id "${id}"`,
  "try",
  "with timeout of 120 seconds",
  "set startCount to count of documents",
  "open inFile",
  "set waited to 0",
  "repeat while (count of documents) is startCount and waited < 45",
  "delay 0.5",
  "set waited to waited + 0.5",
  "end repeat",
  "if (count of documents) is startCount then error \"Keynote didn't open the deck.\"",
  "set theDoc to front document",
  "set skipList to skipped of every slide of theDoc",
  "set notesList to presenter notes of every slide of theDoc",
  "export theDoc to outFile as PDF with properties {PDF image quality:Best, skipped slides:false}",
  "close theDoc saving no",
  "end timeout",
  "on error message",
  "if not wasOpen then quit saving no",
  "error message",
  "end try",
  "if not wasOpen then quit saving no",
  "end tell",
  "set AppleScript's text item delimiters to (character id 30)",
  "return (skipList as text) & (character id 29) & (notesList as text)",
  "end run",
];

async function keynotePdf(file: string, work: string): Promise<{ pdf: string; skipped: boolean[]; notes: string[] }> {
  const id = await findKeynote();
  if (!id) throw new SlidesError("Keynote isn't on this Mac.");
  const pdf = path.join(work, "keynote.pdf");
  const args = KEYNOTE_SCRIPT(id).flatMap((line) => ["-e", line]);
  const r = await run("/usr/bin/osascript", [...args, file, pdf], { timeout: 180_000 });
  if (r.code !== 0 || !existsSync(pdf)) {
    throw new SlidesError(
      "Keynote couldn't export the deck. Open Keynote once and close any welcome window, then try again, or export a PDF from Keynote (File, Export To, PDF) and drop that in.",
    );
  }
  const [skips = "", notes = ""] = r.stdout.toString("utf8").replace(/\n$/, "").split(String.fromCharCode(29));
  return {
    pdf,
    skipped: skips.split(String.fromCharCode(30)).map((s) => s.trim() === "true"),
    notes: notes.split(String.fromCharCode(30)).map((s) => tidyText(s === "missing value" ? "" : s)),
  };
}

// ─── Building an import ──────────────────────────────────────────────────────

const importFile = (id: string) => path.join(importDir(id), "import.json");

export async function readImport(id: string): Promise<SlideImport | null> {
  if (!isImportId(id)) return null;
  try {
    return JSON.parse(await readFile(importFile(id), "utf8")) as SlideImport;
  } catch {
    return null;
  }
}

async function writeImport(imp: SlideImport) {
  const file = importFile(imp.id);
  await writeFile(`${file}.tmp`, `${JSON.stringify(imp, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
}

export async function newImport(): Promise<SlideImport> {
  // Imports left behind for more than a day are cleared first.
  const old = await readdir(IMPORTS_DIR).catch(() => [] as string[]);
  await Promise.all(
    old.filter(isImportId).map(async (name) => {
      const s = await stat(importDir(name)).catch(() => null);
      if (s && Date.now() - s.mtimeMs > 24 * 3600_000) await rm(importDir(name), { recursive: true, force: true });
    }),
  );
  const imp: SlideImport = { id: newId(), slides: [], notes: [], files: 0, createdAt: new Date().toISOString() };
  await mkdir(importDir(imp.id), { recursive: true });
  await writeImport(imp);
  return imp;
}

export async function dropImport(id: string) {
  if (isImportId(id)) await rm(importDir(id), { recursive: true, force: true });
}

// One at a time per import, so files dropped together land in order.
const locks = ((globalThis as { __slideLocks?: Map<string, Promise<unknown>> }).__slideLocks ??= new Map());
function withImport<T>(id: string, job: () => Promise<T>): Promise<T> {
  const next = (locks.get(id) ?? Promise.resolve()).catch(() => {}).then(job);
  locks.set(id, next);
  return next;
}

// A picture made a slide: PNG, at least 1920 px wide (at most 3840).
async function pictureSlide(file: string, out: string) {
  const r = await mustRun("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", file]);
  const width = Number(/pixelWidth: (\d+)/.exec(r.stdout.toString())?.[1]);
  if (!width) throw new SlidesError(`${path.basename(file)} isn't a picture this Mac can open.`);
  const target = width < MIN_WIDTH ? MIN_WIDTH : width > MAX_WIDTH ? MAX_WIDTH : width;
  await mustRun("/usr/bin/sips", ["-s", "format", "png", ...(target !== width ? ["--resampleWidth", String(target)] : []), file, "--out", out]);
  return pngSize(out);
}

// Converts one file (already saved at `file`) into slides; returns the
// slides made and any note to show her.
export async function convertInto(
  dir: string,
  file: string,
  name: string,
  { keyPrefix, onStep, maxPages = MAX_SLIDES }: { keyPrefix: string; onStep: (label: string) => void; maxPages?: number },
): Promise<{ slides: Slide[]; note: string | null }> {
  const ext = extOf(name);
  const work = await mkdtemp(path.join(tmpdir(), "studio-slides-"));
  let n = 0;
  const key = () => `${keyPrefix}${String(++n).padStart(3, "0")}`;
  const place = async (page: Page | null, made: Omit<Slide, "key" | "image" | "width" | "height" | "pictures"> & { pictures?: DeckText["pictures"] }) => {
    const k = key();
    let image: string | null = null;
    let size = { width: 0, height: 0 };
    if (page) {
      image = `${k}.png`;
      await copyFile(page.file, path.join(dir, image));
      size = { width: page.width, height: page.height };
    }
    const pictures: SlidePicture[] = [];
    for (const [i, p] of (made.pictures ?? []).entries()) {
      const f = `${k}-picture-${i + 1}.${p.ext}`;
      await writeFile(path.join(dir, f), p.data);
      pictures.push({ file: f, box: p.box });
    }
    return { ...made, key: k, image, ...size, pictures } satisfies Slide;
  };

  try {
    if (isImageFile(name)) {
      onStep("Reading the picture");
      const out = path.join(work, "slide.png");
      const size = await pictureSlide(file, out);
      const text = await readWords(out);
      return {
        slides: [await place({ file: out, ...size, text }, { title: firstLine(text), text, notes: "", from: name, page: 1, charts: [] })],
        note: null,
      };
    }

    if (ext === "pdf") {
      onStep("Opening the PDF");
      const pages = await pdfPages(file, path.join(work, "pages"), onStep, maxPages);
      const slides = [];
      for (const [i, p] of pages.entries()) slides.push(await place(p, { title: firstLine(p.text), text: p.text, notes: "", from: name, page: i + 1, charts: [] }));
      return { slides, note: null };
    }

    // PowerPoint, Keynote, OpenDocument.
    let words: DeckText[] | null = null;
    if (ext === "pptx" || ext === "odp") {
      onStep("Reading the words and notes");
      let zip: Zip;
      try {
        zip = openZip(await readFile(file));
      } catch {
        throw new SlidesError(`${name} couldn't be opened. Save it again from your slides app and try once more.`);
      }
      words = ext === "pptx" ? pptxText(zip) : odpText(zip);
    }
    const t = tools();
    let drawn: { pdf: string; skipped?: boolean[]; notes?: string[] } | null = null;
    let why = "";
    if (t.soffice && ext !== "key") {
      onStep("Drawing the slides with LibreOffice");
      try {
        drawn = { pdf: await sofficePdf(t.soffice, file, work) };
      } catch (e) {
        why = String((e as Error).message);
      }
    }
    if (!drawn && ext !== "odp" && (await findKeynote())) {
      onStep("Drawing the slides with Keynote");
      try {
        drawn = await keynotePdf(file, work);
      } catch (e) {
        why = e instanceof SlidesError ? e.message : String((e as Error).message);
      }
    }
    const pages = drawn ? await pdfPages(drawn.pdf, path.join(work, "pages"), onStep, maxPages) : null;

    if (!words) {
      // Keynote or .ppt: the words come from the PDF, the notes from Keynote.
      if (!pages) {
        const app = ext === "key" ? "Keynote" : "PowerPoint";
        throw new SlidesError(
          why && ext === "key"
            ? why
            : `This Mac can't open ${ext === "key" ? "Keynote" : "this kind of"} files on its own. In ${app}, choose File, Export, PDF, and drop the PDF here.`,
        );
      }
      const notes = (drawn?.notes ?? []).filter((_, i) => !drawn?.skipped?.[i]);
      const slides = [];
      for (const [i, p] of pages.entries()) {
        slides.push(await place(p, { title: firstLine(p.text), text: p.text, notes: notes[i] ?? "", from: name, page: i + 1, charts: [] }));
      }
      return { slides, note: null };
    }

    // PowerPoint or OpenDocument: words from the XML, pictures from the PDF.
    const shown = words.map((w, i) => ({ ...w, page: i + 1 })).filter((w) => !w.hidden);
    const pageFor = (i: number, all: number) => {
      if (!pages) return null;
      if (pages.length === shown.length) return pages[i];
      if (pages.length === words.length) return pages[all - 1];
      return pages[i] ?? null;
    };
    const slides = [];
    for (const [i, w] of shown.slice(0, maxPages).entries()) {
      slides.push(await place(pageFor(i, w.page), { title: w.title, text: w.text, notes: w.notes, from: name, page: w.page, charts: w.charts, pictures: w.pictures }));
    }
    const hidden = words.length - shown.length;
    const notes = [hidden ? `Left out ${hidden} hidden ${hidden === 1 ? "slide" : "slides"}.` : ""];
    if (!pages) {
      const app = ext === "odp" ? "your slides app" : "PowerPoint (or Google Slides)";
      notes.unshift(
        `Got the words and notes, but ${why.startsWith("Keynote") ? "Keynote couldn't draw the slides (open Keynote once and close any window it shows)" : "this Mac can't draw these slides"}. In ${app}, choose File, Export, PDF, and drop the PDF here too: it fills in the pictures. Installing LibreOffice also fixes this.`,
      );
    }
    return { slides, note: notes.filter(Boolean).join(" ") || null };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

// Adds a file's slides to an import. A PDF dropped after a PowerPoint file
// whose slides couldn't be drawn fills in their pictures instead.
export function addToImport(id: string, file: string, name: string, onStep: (label: string) => void): Promise<SlideImport> {
  return withImport(id, async () => {
    const imp = await readImport(id);
    if (!imp) throw new SlidesError("Those slides are gone. Start again.");
    const dir = importDir(id);
    imp.files = (imp.files ?? 0) + 1;
    const made = await convertInto(dir, file, name, { keyPrefix: `f${imp.files}-`, onStep });
    const blank = imp.slides.filter((s) => !s.image);
    if (extOf(name) === "pdf" && blank.length && blank.length === made.slides.length) {
      blank.forEach((s, i) => {
        const p = made.slides[i];
        s.image = p.image;
        s.width = p.width;
        s.height = p.height;
      });
      for (const extra of made.slides) for (const pic of extra.pictures) await rm(path.join(dir, pic.file), { force: true });
      imp.notes = imp.notes.filter((n) => !n.startsWith("Got the words and notes"));
      imp.notes.push(`Matched ${name} to the ${blank.length} slides that had no pictures.`);
    } else {
      if (imp.slides.length + made.slides.length > MAX_SLIDES) throw new SlidesError(`A film takes up to ${MAX_SLIDES} slides.`);
      imp.slides.push(...made.slides);
      if (made.note) imp.notes.push(made.note);
    }
    await writeImport(imp);
    return imp;
  });
}

// ─── A deck's slides in a film's refs/ ───────────────────────────────────────

export type FilmSlide = Omit<Slide, "key" | "image" | "pictures" | "from"> & {
  n: number;
  image: string | null; // path in the film, "refs/slides/slide-01.png"
  from: string;
  pictures: SlidePicture[];
};

// Copies slides (in this order) into `folder` inside the film as
// slide-01.png…, with their pictures, and returns them as the film sees them.
export async function copySlides(fromDir: string, slides: Slide[], filmRoot: string, folder: string): Promise<FilmSlide[]> {
  const dest = path.join(filmRoot, folder);
  await mkdir(dest, { recursive: true });
  const pad = slides.length >= 100 ? 3 : 2;
  const out: FilmSlide[] = [];
  for (const [i, s] of slides.entries()) {
    const base = `slide-${String(i + 1).padStart(pad, "0")}`;
    let image: string | null = null;
    if (s.image) {
      await copyFile(path.join(fromDir, s.image), path.join(dest, `${base}.png`));
      image = `${folder}/${base}.png`;
    }
    const pictures: SlidePicture[] = [];
    for (const [j, p] of s.pictures.entries()) {
      const f = `${base}-picture-${j + 1}${path.extname(p.file)}`;
      await copyFile(path.join(fromDir, p.file), path.join(dest, f));
      pictures.push({ file: `${folder}/${f}`, box: p.box });
    }
    out.push({ n: i + 1, image, width: s.width, height: s.height, title: s.title, text: s.text, notes: s.notes, from: s.from, page: s.page, pictures, charts: s.charts });
  }
  return out;
}

// A deck attached to a film's prompt: its slides go into refs/<name>-slides/
// beside it, with slides.json, so "add these slides as a section" works.
// Returns that folder's path in the film, or null if it had no slides.
export async function slidesForAttachment(
  filmRoot: string,
  file: string,
  name: string,
  { maxPages = MAX_SLIDES }: { maxPages?: number } = {},
): Promise<string | null> {
  const folder = `refs/${path.basename(file, path.extname(file))}-slides`;
  const work = await mkdtemp(path.join(tmpdir(), "studio-attach-slides-"));
  try {
    const made = await convertInto(work, file, name, { keyPrefix: "a-", onStep: () => {}, maxPages });
    if (!made.slides.length) return null;
    const slides = await copySlides(work, made.slides, filmRoot, folder);
    await writeFile(
      path.join(filmRoot, folder, "slides.json"),
      `${JSON.stringify({ source: name, ...(made.note ? { note: made.note } : {}), slides }, null, 2)}\n`,
    );
    return folder;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
