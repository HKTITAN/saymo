// A film's brand kit, read from disk and turned into the tokens its
// graphics draw with (brand.ts BrandTokens). Used by the stage, the
// renders and Claude's context.
//
// Plain TypeScript with no `@/` imports: scripts/studio/render.mjs imports
// it straight from Node.

import { cp, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { BrandKit, BrandTokens } from "./brand";

export const DEFAULT_BRAND = "aerchain";

// Kit ids: the shipped ones ("aerchain") and the studio's own 8-character ones.
export const isBrandId = (id: string) => /^[a-z0-9][a-z0-9-]{2,31}$/.test(id);

export const brandsDir = (root: string) => path.join(root, "brands");
export const shippedDir = (root: string) => path.join(root, "studio/brands");
export const brandDir = (root: string, id: string) => path.join(brandsDir(root), id);

const exists = (p: string) => stat(p).then(() => true, () => false);

// The kits the studio ships (studio/brands/<id>/) are copied into brands/
// the first time they're needed, so they can be edited like any other.
// One copy at a time, even when several requests arrive together on the
// first visit, and each kit appears whole: copied aside, then renamed in.
const seeding = globalThis as { __brandSeed?: Promise<void> };
export function seedShipped(root: string): Promise<void> {
  seeding.__brandSeed ??= seed(root).finally(() => {
    seeding.__brandSeed = undefined;
  });
  return seeding.__brandSeed;
}

async function seed(root: string) {
  for (const id of await readdir(shippedDir(root)).catch(() => [])) {
    if (!isBrandId(id) || (await exists(brandDir(root, id)))) continue;
    if (!(await exists(path.join(shippedDir(root), id, "brand.json")))) continue;
    await mkdir(brandsDir(root), { recursive: true });
    const aside = `${brandDir(root, id)}.seeding-${process.pid}-${Date.now().toString(36)}`;
    await cp(path.join(shippedDir(root), id), aside, { recursive: true });
    // Another process (a render) may have got there first; keep theirs.
    await rename(aside, brandDir(root, id)).catch(() => rm(aside, { recursive: true, force: true }));
  }
}

export async function readKit(root: string, id: string): Promise<BrandKit | null> {
  if (!isBrandId(id)) return null;
  await seedShipped(root);
  try {
    return JSON.parse(await readFile(path.join(brandDir(root, id), "brand.json"), "utf8")) as BrandKit;
  } catch {
    return null;
  }
}

// The kit a film uses: its own, else Aerchain's.
export async function kitForFilm(root: string, brand: string | undefined): Promise<BrandKit | null> {
  return (await readKit(root, brand && isBrandId(brand) ? brand : DEFAULT_BRAND)) ?? (await readKit(root, DEFAULT_BRAND));
}

// Tokens with each font and logo given a URL by `url(file)`: the stage
// serves them at /studio/brand/<id>/<file>; a render copies them beside the
// film and names them relative to it.
export function tokensOf(kit: BrandKit, url: (file: string) => string): BrandTokens {
  return {
    id: kit.id,
    name: kit.name,
    colors: kit.colors,
    texture: kit.texture,
    fonts: kit.fonts.map((f) => ({ ...f, url: url(f.file) })),
    logos: kit.logos.map((l) => ({ ...l, url: url(l.file) })),
  };
}

export const stageFileUrl = (id: string) => (file: string) =>
  `/studio/brand/${id}/${file.split("/").map(encodeURIComponent).join("/")}`;

// @font-face rules for a kit's fonts, one per distinct file.
export function fontFaces(tokens: BrandTokens) {
  const seen = new Set<string>();
  const rules: string[] = [];
  for (const f of tokens.fonts) {
    const key = `${f.family}|${f.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const format = /\.woff2$/i.test(f.file) ? "woff2" : /\.woff$/i.test(f.file) ? "woff" : /\.otf$/i.test(f.file) ? "opentype" : "truetype";
    rules.push(
      `@font-face{font-family:${JSON.stringify(f.family)};src:url(${JSON.stringify(f.url)}) format("${format}");font-weight:${f.weights};font-display:block}`,
    );
  }
  return rules.join("");
}

// Copies a kit's fonts and logos into `dir`/__brand/ for a render, and
// returns tokens that point at them relative to the film.
export async function tokensForRender(root: string, kit: BrandKit, dir: string, prefix = "__brand/"): Promise<BrandTokens> {
  const files = new Set([...kit.fonts.map((f) => f.file), ...kit.logos.map((l) => l.file)]);
  for (const file of files) {
    const from = path.join(brandDir(root, kit.id), file);
    if (!path.resolve(from).startsWith(path.resolve(brandDir(root, kit.id)) + path.sep)) continue;
    await cp(from, path.join(dir, prefix, file)).catch(() => {});
  }
  return tokensOf(kit, (file) => `${prefix}${file}`);
}
