import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { BrandKit, BrandSummary, ColorRoles, Ramp } from "./brand";
import { brandDir, brandsDir, DEFAULT_BRAND, isBrandId, readKit, seedShipped, stageFileUrl } from "./brand-tokens";
import { ROOT } from "../films/films";
import { openZip, type ZipEntry } from "../input/zip";
import { IS_WINDOWS } from "../server/platform";

// Brand kits live in brands/<id>/ (brand.ts). The kits the studio ships are
// seeded from studio/brands/ on first use, then edited like any other.

const run = promisify(execFile);
export const kitDir = (id: string) => brandDir(ROOT, id);
const kitFile = (id: string) => path.join(kitDir(id), "brand.json");
const historyDir = (id: string) => path.join(kitDir(id), ".history");

const g = globalThis as { __brandLocks?: Map<string, Promise<unknown>> };
const locks = (g.__brandLocks ??= new Map());
// One change at a time per kit.
export function withBrand<T>(id: string, job: () => Promise<T>): Promise<T> {
  const runJob = (locks.get(id) ?? Promise.resolve()).catch(() => {}).then(job);
  locks.set(id, runJob);
  return runJob;
}

export const readBrand = (id: string) => readKit(ROOT, id);

export async function writeBrand(kit: BrandKit) {
  const file = kitFile(kit.id);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, `${JSON.stringify(kit, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
}

const newId = () => Array.from(randomBytes(8), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

export async function listBrands(): Promise<BrandSummary[]> {
  await seedShipped(ROOT);
  const ids = (await readdir(brandsDir(ROOT)).catch(() => [])).filter(isBrandId);
  const kits = (await Promise.all(ids.map(readBrand))).filter((k): k is BrandKit => k !== null);
  return kits
    .map((k) => {
      const display = k.fonts.find((f) => f.role === "display") ?? k.fonts[0];
      const logo = k.logos.find((l) => l.on !== "dark") ?? k.logos[0];
      const r = k.colors.roles;
      return {
        id: k.id,
        name: k.name,
        updatedAt: k.updatedAt,
        source: k.source,
        swatches: [r.background, r.surface, r.ink, r.accent],
        font: display?.family ?? null,
        logo: logo ? `${stageFileUrl(k.id)(logo.file)}?v=${Date.parse(k.updatedAt).toString(36)}` : null,
      };
    })
    .sort((a, b) => (a.id === DEFAULT_BRAND ? -1 : b.id === DEFAULT_BRAND ? 1 : b.updatedAt.localeCompare(a.updatedAt)));
}

// ─── Checking a kit ─────────────────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const HEX = /^#[0-9a-f]{6}$/i;
const ROLES: (keyof ColorRoles)[] = ["background", "surface", "ink", "muted", "accent", "onAccent", "line"];
const text = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const lines = (v: unknown) => (Array.isArray(v) ? v.map((s) => text(s, 400)).filter(Boolean).slice(0, 60) : []);
// A file inside the kit's fonts/ or logos/: no leading slash, no "..".
const kitPath = (v: unknown, folder: "fonts" | "logos") => {
  const s = text(v, 200);
  return s.startsWith(`${folder}/`) && !s.includes("..") && !s.includes("\\") && /^[\w./ -]+$/.test(s) ? s : null;
};

// The kit as sent, cleaned; or a sentence saying what's wrong.
export function checkKit(id: string, body: unknown, previous: BrandKit | null): BrandKit | string {
  if (!isObject(body)) return "Send the kit as an object.";
  const name = text(body.name, 80);
  if (!name) return "Give the kit a name.";
  const colors = isObject(body.colors) ? body.colors : {};
  const rolesIn = isObject(colors.roles) ? colors.roles : {};
  const roles = {} as ColorRoles;
  for (const r of ROLES) {
    const v = rolesIn[r];
    if (typeof v !== "string" || !HEX.test(v)) return `The ${r} colour must be a hex colour like #F55A00.`;
    roles[r] = v.toUpperCase();
  }
  const ramps: Ramp[] = [];
  for (const ramp of Array.isArray(colors.ramps) ? colors.ramps.slice(0, 12) : []) {
    if (!isObject(ramp)) continue;
    const steps = (Array.isArray(ramp.steps) ? ramp.steps : [])
      .filter((s): s is Record<string, unknown> => isObject(s) && typeof s.hex === "string" && HEX.test(s.hex))
      .slice(0, 32)
      .map((s) => ({ name: text(s.name, 60) || String(s.hex).toUpperCase(), hex: String(s.hex).toUpperCase() }));
    ramps.push({ name: text(ramp.name, 60) || "Colours", steps });
  }
  const fonts: BrandKit["fonts"] = [];
  for (const f of Array.isArray(body.fonts) ? body.fonts.slice(0, 12) : []) {
    if (!isObject(f)) continue;
    const file = kitPath(f.file, "fonts");
    const role = f.role === "display" || f.role === "text" || f.role === "mono" ? f.role : null;
    if (!file || !role || !text(f.family)) return "Each font needs a family, a role (display, text or mono) and a file in fonts/.";
    fonts.push({
      family: text(f.family, 80),
      role,
      file,
      weights: /^\d{3}( \d{3})?$/.test(text(f.weights)) ? text(f.weights) : "400",
      ...(text(f.axes) ? { axes: text(f.axes, 120) } : {}),
      ...(text(f.licence) ? { licence: text(f.licence, 120) } : {}),
    });
  }
  const logos: BrandKit["logos"] = [];
  for (const l of Array.isArray(body.logos) ? body.logos.slice(0, 24) : []) {
    if (!isObject(l)) continue;
    const file = kitPath(l.file, "logos");
    const kind = l.kind === "wordmark" || l.kind === "mark" || l.kind === "lockup" ? l.kind : null;
    const on = l.on === "light" || l.on === "dark" || l.on === "any" ? l.on : null;
    if (!file || !kind || !on) return "Each logo needs a file in logos/, a kind (wordmark, mark or lockup) and a ground (light, dark or any).";
    logos.push({ name: text(l.name, 80) || "Logo", kind, file, on });
  }
  const rulesIn = isObject(body.rules) ? body.rules : {};
  let texture: BrandKit["texture"];
  if (isObject(body.texture)) {
    const stroke = Number(body.texture.stroke);
    const gap = Number(body.texture.gap);
    if (!(stroke >= 1 && stroke <= 200 && gap >= 0 && gap <= 200)) return "The line texture's stroke and gap are pixels from 1 to 200.";
    const fields: Record<string, { lit: string; gap: string }> = {};
    if (isObject(body.texture.fields)) {
      for (const [k, v] of Object.entries(body.texture.fields).slice(0, 24)) {
        if (HEX.test(k) && isObject(v) && typeof v.lit === "string" && HEX.test(v.lit) && typeof v.gap === "string" && HEX.test(v.gap)) {
          fields[k.toUpperCase()] = { lit: v.lit.toUpperCase(), gap: v.gap.toUpperCase() };
        }
      }
    }
    texture = {
      stroke,
      gap,
      ...(text(body.texture.note) ? { note: text(body.texture.note, 400) } : {}),
      ...(Object.keys(fields).length ? { fields } : {}),
    };
  }
  return {
    id,
    name,
    updatedAt: new Date().toISOString(),
    ...(text(body.source) || previous?.source ? { source: text(body.source, 300) || previous?.source } : {}),
    colors: { roles, ramps },
    fonts,
    logos,
    rules: {
      visual: lines(rulesIn.visual),
      motion: lines(rulesIn.motion),
      sound: lines(rulesIn.sound),
      words: lines(rulesIn.words),
    },
    ...(texture ? { texture } : {}),
    notes: typeof body.notes === "string" ? body.notes.slice(0, 60_000) : (previous?.notes ?? ""),
  };
}

// ─── Making, copying, removing ───────────────────────────────────────────────

// A new kit: plain greys and one accent, no fonts, logos or rules.
export async function createBrand(name: string): Promise<BrandKit> {
  const id = newId();
  const kit: BrandKit = {
    id,
    name: name.trim().slice(0, 80) || "New brand",
    updatedAt: new Date().toISOString(),
    colors: {
      roles: {
        background: "#141414",
        surface: "#EDEDED",
        ink: "#141414",
        muted: "#6E6E6E",
        accent: "#3B5BDB",
        onAccent: "#FFFFFF",
        line: "#1E1E1E",
      },
      ramps: [],
    },
    fonts: [],
    logos: [],
    rules: { visual: [], motion: [], sound: [], words: [] },
    texture: { stroke: 8, gap: 4 },
    notes: "",
  };
  await mkdir(path.join(kitDir(id), "fonts"), { recursive: true });
  await mkdir(path.join(kitDir(id), "logos"), { recursive: true });
  await mkdir(path.join(kitDir(id), "guide"), { recursive: true });
  await writeBrand(kit);
  return kit;
}

const COPY_SKIP = new Set([".history"]);

export async function duplicateBrand(id: string): Promise<BrandKit | null> {
  const kit = await readBrand(id);
  if (!kit) return null;
  const copy = newId();
  await cp(kitDir(id), kitDir(copy), { recursive: true, filter: (p) => !COPY_SKIP.has(path.basename(p)) });
  const next = { ...kit, id: copy, name: `${kit.name} copy`, updatedAt: new Date().toISOString() };
  await writeBrand(next);
  return next;
}

export async function deleteBrand(id: string): Promise<string | null> {
  if (!isBrandId(id)) return "That kit doesn't exist.";
  const all = await listBrands();
  if (all.length <= 1) return "This is the only kit. Make another before deleting it.";
  await withBrand(id, () => rm(kitDir(id), { recursive: true, force: true }));
  return null;
}

// ─── Files ───────────────────────────────────────────────────────────────────

const FONT_EXT = /\.(ttf|otf|woff2?)$/i;
const LOGO_EXT = /\.(svg|png|webp)$/i;
const GUIDE_EXT = /\.(pdf|png|jpe?g|webp|txt|md)$/i;
export const MAX_FILE = 80 * 1024 * 1024;

// Where an uploaded file goes, by its kind: fonts/, logos/ or guide/.
export function folderFor(name: string): "fonts" | "logos" | "guide" | null {
  if (FONT_EXT.test(name)) return "fonts";
  if (/\.svg$/i.test(name)) return "logos";
  if (GUIDE_EXT.test(name) || LOGO_EXT.test(name)) return /logo|mark|wordmark|lockup/i.test(name) ? "logos" : "guide";
  return null;
}

export const safeName = (name: string) =>
  path
    .basename(name)
    .normalize("NFKD")
    .replace(/[^\w. -]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 100) || "file";

// Saves an uploaded file into the kit, returning its path inside the kit.
// Whether a file of this name can go in the folder the person picked.
const fits = (folder: string, name: string) =>
  folder === "fonts" ? FONT_EXT.test(name) : folder === "logos" ? LOGO_EXT.test(name) : folder === "guide" ? GUIDE_EXT.test(name) || LOGO_EXT.test(name) : false;

export async function saveBrandFile(id: string, name: string, body: ReadableStream<Uint8Array>, want?: string | null): Promise<string> {
  const folder = want && fits(want, name) ? (want as "fonts" | "logos" | "guide") : folderFor(name);
  if (!folder) throw new Error("Fonts (TTF, OTF, WOFF), logos (SVG, PNG) and guidelines (PDF, images) can go in a kit.");
  const file = `${folder}/${safeName(name)}`;
  const target = path.join(kitDir(id), file);
  await mkdir(path.dirname(target), { recursive: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_FILE) throw new Error("That file is over 80 MB, too big for a kit.");
    chunks.push(value);
  }
  await writeFile(target, Buffer.concat(chunks));
  return file;
}

// ─── History (before each Claude turn) ───────────────────────────────────────

async function historyTurns(id: string) {
  return (await readdir(historyDir(id)).catch(() => []))
    .map(Number)
    .filter(Number.isInteger)
    .sort((a, b) => a - b);
}

export async function snapshotBrand(id: string): Promise<number> {
  const turns = await historyTurns(id);
  const n = (turns.at(-1) ?? 0) + 1;
  const snap = path.join(historyDir(id), String(n));
  await mkdir(snap, { recursive: true });
  for (const name of await readdir(kitDir(id))) {
    if (name === ".history") continue;
    await cp(path.join(kitDir(id), name), path.join(snap, name), { recursive: true });
  }
  for (const old of turns.slice(0, Math.max(0, turns.length + 1 - 20))) {
    await rm(path.join(historyDir(id), String(old)), { recursive: true, force: true });
  }
  return n;
}

export async function restoreBrand(id: string): Promise<BrandKit | null> {
  const n = (await historyTurns(id)).at(-1);
  if (n === undefined) return null;
  const snap = path.join(historyDir(id), String(n));
  for (const name of await readdir(kitDir(id))) {
    if (name === ".history") continue;
    await rm(path.join(kitDir(id), name), { recursive: true, force: true });
  }
  for (const name of await readdir(snap)) await cp(path.join(snap, name), path.join(kitDir(id), name), { recursive: true });
  await rm(snap, { recursive: true, force: true });
  return readBrand(id);
}

export const canUndoBrand = async (id: string) => (await historyTurns(id)).length > 0;

// ─── Export and import ───────────────────────────────────────────────────────

// A .zip of the kit: brand.json, fonts/, logos/ and guide/.
export async function exportBrand(id: string): Promise<string> {
  const temp = await mkdtemp(path.join(tmpdir(), "studio-kit-"));
  const folder = path.join(temp, id);
  await cp(kitDir(id), folder, { recursive: true, filter: (p) => !COPY_SKIP.has(path.basename(p)) });
  const zip = path.join(temp, `${id}.zip`);
  if (IS_WINDOWS) await run("tar.exe", ["-a", "-c", "-f", zip, "-C", temp, id]); // Windows' own tar writes zips
  // eslint-disable-next-line no-restricted-syntax -- Mac's zip tool; Windows: tar.exe above
  else await run("/usr/bin/ditto", ["-c", "-k", "--norsrc", "--keepParent", folder, zip]);
  return zip;
}

const MAX_ZIP = 300 * 1024 * 1024;
const MAX_UNPACKED = 600 * 1024 * 1024;
const MAX_ENTRIES = 2000;

// A kit from a .zip another studio exported. Every entry is checked before
// anything is unpacked: no paths that climb out, no links, no huge totals.
export async function importBrand(body: ReadableStream<Uint8Array>): Promise<BrandKit> {
  const temp = await mkdtemp(path.join(tmpdir(), "studio-import-"));
  try {
    const zip = path.join(temp, "kit.zip");
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ZIP) throw new Error("That file is over 300 MB, too big for a kit.");
      chunks.push(value);
    }
    await writeFile(zip, Buffer.concat(chunks));

    // List first: names and sizes, without unpacking (the same reader on
    // the Mac and Windows).
    let listing: ZipEntry[];
    try {
      listing = openZip(await readFile(zip)).list();
    } catch {
      throw new Error("That isn't a kit file. Export a kit from the studio and import that .zip.");
    }
    let total = 0;
    let entries = 0;
    for (const { name, size, link } of listing) {
      entries++;
      total += size;
      if (link) throw new Error("The kit file contains a link, which the studio doesn't accept.");
      if (/^([/\\]|[A-Za-z]:)/.test(name) || name.split(/[/\\]/).includes("..")) throw new Error("The kit file has a file outside its own folder.");
    }
    if (entries > MAX_ENTRIES || total > MAX_UNPACKED) throw new Error("The kit file is too big to import.");

    const out = path.join(temp, "out");
    await mkdir(out);
    if (IS_WINDOWS) await run("tar.exe", ["-x", "-f", zip, "-C", out]);
    // eslint-disable-next-line no-restricted-syntax -- Mac's zip tool; Windows: tar.exe above
    else await run("/usr/bin/ditto", ["-x", "-k", "--norsrc", zip, out]);
    // brand.json at the top, or one folder down.
    let base = out;
    if (!(await stat(path.join(base, "brand.json")).catch(() => null))) {
      const inner = (await readdir(out)).filter((n) => !n.startsWith(".") && n !== "__MACOSX");
      if (inner.length === 1) base = path.join(out, inner[0]);
    }
    const raw = await readFile(path.join(base, "brand.json"), "utf8").catch(() => null);
    if (!raw) throw new Error("The kit file has no brand.json. Export a kit from the studio and import that .zip.");
    const id = newId();
    const kit = checkKit(id, JSON.parse(raw), null);
    if (typeof kit === "string") throw new Error(kit);

    // Only fonts/, logos/ and guide/ come across, file by file, and only
    // regular files of the right kinds.
    await mkdir(kitDir(id), { recursive: true });
    for (const folder of ["fonts", "logos", "guide"] as const) {
      const from = path.join(base, folder);
      const names = await readdir(from).catch(() => []);
      await mkdir(path.join(kitDir(id), folder), { recursive: true });
      for (const name of names) {
        const info = await lstat(path.join(from, name));
        if (!info.isFile()) continue;
        if (folderFor(name) === null && !(folder === "logos" && LOGO_EXT.test(name))) continue;
        await cp(path.join(from, name), path.join(kitDir(id), folder, safeName(name)));
      }
    }
    kit.fonts = kit.fonts.filter((f) => f.file === `fonts/${safeName(path.basename(f.file))}`);
    kit.logos = kit.logos.filter((l) => l.file === `logos/${safeName(path.basename(l.file))}`);
    kit.source = kit.source ? `${kit.source} (imported)` : "Imported kit";
    await writeBrand(kit);
    return kit;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
