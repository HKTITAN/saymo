// Real pictures for a film, for the studio's Claude: the files the person
// attached, put where the film can show them, and real photos found on
// Openverse (openly licensed photos from Flickr, Wikimedia and more) or
// Wikimedia Commons when a film asks for a real place or thing.
//
// usage (from films/<id>/):
//   node <project>/scripts/studio/photo.mjs <id> use refs/<file> [name]
//       copies an attached picture into the film (assets/ for an HTML film,
//       public/ for a React film) and prints the path to use
//   node … <id> search "<words>" [--wide | --tall]
//       finds up to 12 photos that may be used commercially and changed,
//       saves small previews to Read, and lists them numbered
//   node … <id> get <n> [name]
//       downloads photo n of the last search into the film (at most 3840 px
//       on its long side) and adds its credit to photos/CREDITS.md
//
// It only works inside the film it's run from, checks every argument, and
// runs nothing through a shell.

import { createRequire } from "node:module";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(ROOT, "package.json"));

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const [id, command, ...rest] = process.argv.slice(2);
const dir = process.cwd();
if (!/^[a-z0-9]{8}$/.test(id ?? "") || dir !== path.join(ROOT, "films", id)) {
  fail("Run this from the film's own folder, with that film's id: node …/photo.mjs <id> <command>.");
}
const film = JSON.parse(readFileSync(path.join(dir, "film.json"), "utf8"));
// Where pictures go so the film can show them, and the path the film uses.
const react = film.engine === "react";
const home = react ? path.join(dir, "public", "photos") : path.join(dir, "assets", "photos");
const shown = (file) => (react ? `staticFile("photos/${file}")` : `assets/photos/${file}`);
// Previews go where Claude may Read them (the media tool's frames folder).
const work = path.join(ROOT, "films/.work", id, "frames", "photos");
const lastSearch = path.join(ROOT, "films/.work", id, "photos.json");

const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "photo";

const IMAGE = /\.(png|jpe?g|webp|gif|avif)$/i;

async function sharp() {
  try {
    return require("sharp");
  } catch {
    fail("The studio's image tools aren't installed. Run npm install in the studio, then try again.");
  }
}

// ─── use: an attached picture, as it is ────────────────────────────────────

async function use(ref, name) {
  if (!/^refs\/[A-Za-z0-9._-]{1,160}$/.test(ref ?? "")) fail("Name an attached file as refs/<file>, as listed in the message.");
  const from = path.join(dir, ref);
  if (!existsSync(from)) fail(`There's no ${ref} in this film.`);
  if (!IMAGE.test(from)) fail(`${ref} isn't a picture this tool copies (PNG, JPEG, WebP, GIF or AVIF).`);
  mkdirSync(home, { recursive: true });
  const ext = path.extname(from).toLowerCase();
  const file = `${slug(name ?? path.basename(from, ext))}${ext}`;
  copyFileSync(from, path.join(home, file));
  const meta = await (await sharp())(from).metadata().catch(() => ({}));
  console.log(`Copied ${ref} to ${path.relative(dir, path.join(home, file))}${meta.width ? ` (${meta.width} x ${meta.height})` : ""}.`);
  console.log(`Show it in the film as ${shown(file)}, as it is: no redrawing, tracing or recolouring. Crop, scale, place and move it.`);
}

// ─── search and get: real photos from Openverse ─────────────────────────────

const OPENVERSE = "https://api.openverse.org/v1/images/";
const UA = { "User-Agent": "MotionStudio/1.0 (a motion design studio; one person's searches)" };
// Licences that allow commercial use and changes, freest first.
const FREEST = ["cc0", "pdm", "by", "by-sa"];

// A fetch that gives up after `ms`, and answers null rather than throwing.
async function fetchJson(url, ms = 15000) {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), ms);
  try {
    const res = await fetch(url, { headers: UA, signal: stop.signal });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Openverse: the licence of each photo is known, so the freest come first.
async function fromOpenverse(q, flags) {
  const params = new URLSearchParams({ q, license: FREEST.join(","), mature: "false", page_size: "20" });
  if (flags.includes("--wide")) params.set("aspect_ratio", "wide");
  if (flags.includes("--tall")) params.set("aspect_ratio", "tall");
  // It sometimes fails for a moment; one more try.
  const body = (await fetchJson(`${OPENVERSE}?${params}`)) ?? (await fetchJson(`${OPENVERSE}?${params}`));
  return (body?.results ?? [])
    .filter((r) => r.url && (!r.width || r.width >= 1200))
    .sort((a, b) => FREEST.indexOf(a.license) - FREEST.indexOf(b.license))
    .map((r) => ({
      title: r.title ?? "Untitled",
      url: r.url,
      thumb: r.thumbnail ?? r.url,
      width: r.width ?? null,
      height: r.height ?? null,
      licence: `${String(r.license).toUpperCase()}${r.license_version ? ` ${r.license_version}` : ""}`,
      licenceUrl: r.license_url ?? null,
      creator: r.creator ?? null,
      page: r.foreign_landing_url ?? null,
      source: r.source ?? "openverse",
    }));
}

// Wikimedia Commons, through api.wikimedia.org: every file there is freely
// licensed, some asking for credit; the file's page says which.
const WIKI = "https://api.wikimedia.org/core/v1/commons";
async function fromCommons(q, flags) {
  const found = await fetchJson(`${WIKI}/search/page?${new URLSearchParams({ q: `${q} filetype:bitmap`, limit: "24" })}`);
  const keys = (found?.pages ?? []).map((p) => p.key).filter((k) => /^File:.+\.(jpe?g|png|webp)$/i.test(k));
  const files = await Promise.all(keys.slice(0, 16).map((k) => fetchJson(`${WIKI}/file/${encodeURIComponent(k)}`)));
  return files
    .filter((f) => f?.original?.url && (f.original.width ?? 0) >= 1200)
    .filter((f) => {
      const w = f.original.width;
      const h = f.original.height;
      if (flags.includes("--wide")) return w > h * 1.2;
      if (flags.includes("--tall")) return h > w * 1.1;
      return true;
    })
    .map((f) => ({
      title: String(f.title).replace(/\.[a-z]+$/i, "").replace(/_/g, " "),
      url: f.original.url,
      thumb: f.preferred?.url ?? f.original.url,
      width: f.original.width,
      height: f.original.height,
      licence: "Wikimedia Commons (free licence; its page says whether it asks for credit)",
      licenceUrl: null,
      creator: f.latest?.user?.name ?? null,
      page: f.file_description_url ? `https:${f.file_description_url}` : null,
      source: "wikimedia",
    }));
}

async function search(words, flags) {
  const q = String(words ?? "").trim();
  if (q.length < 2 || q.length > 120) fail('Say what to look for, in quotes: search "dubai skyline at night".');
  let found = await fromOpenverse(q, flags);
  if (found.length < 6) found = [...found, ...(await fromCommons(q, flags))];
  const seen = new Set();
  found = found.filter((p) => !seen.has(p.url) && seen.add(p.url)).slice(0, 12);
  if (!found.length) fail("No large, freely licensed photos for that, or the photo libraries didn't answer. Try simpler words (a place and one thing), or again in a minute.");
  mkdirSync(work, { recursive: true });
  const s = await sharp();
  const kept = [];
  for (const [i, r] of found.entries()) {
    const n = i + 1;
    let preview = null;
    try {
      const pic = await fetch(r.thumb, { headers: UA, signal: AbortSignal.timeout(15000) });
      if (pic.ok) {
        preview = path.join(work, `${n}.jpg`);
        await s(Buffer.from(await pic.arrayBuffer())).resize(480, 480, { fit: "inside" }).jpeg({ quality: 80 }).toFile(preview);
      }
    } catch {
      preview = null;
    }
    kept.push({ n, ...r, preview });
  }
  writeFileSync(lastSearch, `${JSON.stringify({ q, at: new Date().toISOString(), photos: kept }, null, 2)}\n`);
  console.log(`${kept.length} photos for "${q}". Read the previews to choose, then run get <n>:`);
  for (const p of kept) {
    console.log(
      `${p.n}. ${p.title.slice(0, 70)}${p.width ? `, ${p.width} x ${p.height}` : ""}, ${p.licence}${p.creator ? `, by ${p.creator}` : ""}${p.preview ? `\n   preview: ${p.preview}` : ""}`,
    );
  }
}

async function get(nArg, name) {
  const n = Number(nArg);
  if (!Number.isInteger(n) || n < 1) fail("Say which photo, by its number in the last search: get 3.");
  let saved;
  try {
    saved = JSON.parse(readFileSync(lastSearch, "utf8"));
  } catch {
    fail('Search first: search "<words>".');
  }
  const p = saved.photos.find((x) => x.n === n);
  if (!p) fail(`The last search had no photo ${n}.`);
  let res;
  try {
    res = await fetch(p.url, { headers: UA, signal: AbortSignal.timeout(60000) });
  } catch {
    fail("Unable to download that photo. Try another.");
  }
  if (!res.ok) fail(`That photo couldn't be downloaded (error ${res.status}). Try another.`);
  const s = await sharp();
  mkdirSync(home, { recursive: true });
  const file = `${slug(name ?? p.title)}.jpg`;
  const out = path.join(home, file);
  const info = await s(Buffer.from(await res.arrayBuffer()))
    .rotate()
    .resize(3840, 3840, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(out);
  const credits = path.join(home, "CREDITS.md");
  if (!existsSync(credits)) writeFileSync(credits, "# Photo credits\n\nReal photos in this film, from Openverse and Wikimedia Commons. Keep these lines with the film.\n\n");
  appendFileSync(
    credits,
    `- ${file}: "${p.title}"${p.creator ? ` by ${p.creator}` : ""}, ${p.licence}${p.licenceUrl ? ` (${p.licenceUrl})` : ""}${p.page ? `, ${p.page}` : ""}\n`,
  );
  if (!existsSync(credits)) fail("Unable to write the credit.");
  console.log(`Saved ${path.relative(dir, out)} (${info.width} x ${info.height}). Show it as ${shown(file)}.`);
  const free = p.licence.startsWith("CC0") || p.licence.startsWith("PDM");
  if (p.source === "wikimedia") {
    console.log(`It's from Wikimedia Commons: its page (${p.page}) says whether it asks for credit. The credit is in photos/CREDITS.md; tell the person in your reply.`);
    return;
  }
  console.log(
    free
      ? "Its licence asks for nothing; the credit is kept in photos/CREDITS.md anyway."
      : `Its licence (${p.licence}) asks for credit: it's in photos/CREDITS.md. Tell the person in your reply, so they can credit it where the film is posted.`,
  );
}

if (command === "use") await use(rest[0], rest[1]);
else if (command === "search") await search(rest[0], rest.slice(1));
else if (command === "get") await get(rest[0], rest[1]);
else fail('Commands: use refs/<file> [name], search "<words>" [--wide | --tall], get <n> [name].');
