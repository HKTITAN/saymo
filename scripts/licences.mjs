#!/usr/bin/env node
// Lists everything the studio ships that someone else made, with its
// licence, and writes two files from it:
//
//  - docs/THIRD-PARTY-NOTICES.md: each package's name, version,
//    licence and copyright line, then the licence text, grouped by licence.
//    A licence text that many packages share (MIT's, say) is printed once,
//    under the list of every package that uses it.
//  - public/licences.json, which the studio's "About and licences" panel
//    reads.
//
// What it reads:
//  - every package installed in the app and its three engines, by following
//    each package.json's dependencies (so a package nothing uses isn't
//    listed, and a package left out takes the packages only it needed);
//  - the Rust crates in studio/starters/rust/Cargo.lock, with each crate's
//    licence read from ~/.cargo/registry when the crate has been downloaded;
//  - the speech models, the program that runs them, the font, the icons and
//    the borrowed skills, listed by hand in EXTRAS below.
//
// Run it with `npm run licences` after adding or updating packages, never
// edit its output by hand. It writes for the edition the studio runs as
// (STUDIO_EDITION, or --edition product / --edition in-house): the product
// leaves out what only the in-house edition ships (PRODUCT_LEAVES_OUT).
//
// It reads only package metadata and licence files: never .env files or the
// studio's saved connections.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = args.indexOf("--edition");
const asked = flag >= 0 ? args[flag + 1] : process.env.STUDIO_EDITION;
const EDITION = asked === "product" ? "product" : "in-house";
const PRODUCT = EDITION === "product";

// Where the studio's packages are installed: the app, then its engines.
const NODE_ROOTS = [".", "studio/remotion", "studio/hyperframes", "studio/sound"];

// What the product doesn't ship, so its notices leave it out. The Strudel
// family is the AGPL music engine the product replaces with Tone.js; GSAP
// is the animation library product films don't use (docs/research/licences.md). They stay
// in the in-house edition, where old films still play with them. A name
// ending in "/" means every package in that scope.
const PRODUCT_LEAVES_OUT = ["@strudel/", "@kabelsalat/", "superdough", "supradough", "gsap"];
const leftOut = (name) => PRODUCT && PRODUCT_LEAVES_OUT.some((p) => (p.endsWith("/") ? name.startsWith(p) : name === p));

// ─── Reading licence files ──────────────────────────────────────────────────

const LICENCE_FILE = /^(licen[cs]e|copying|unlicen[cs]e)([-._].*)?$/i;
const NOTICE_FILE = /^notice(\.(md|txt))?$/i;

const read = (file) => {
  try {
    return readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
  } catch {
    return null;
  }
};
const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};
const filesIn = (dir) => {
  try {
    return readdirSync(dir)
      .filter((f) => {
        try {
          return statSync(path.join(dir, f)).isFile();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
};

// The licence text in a folder: every licence file, one after the other.
function licenceText(dir) {
  const texts = filesIn(dir)
    .filter((f) => LICENCE_FILE.test(f))
    .map((f) => read(path.join(dir, f)))
    .filter((t) => t?.trim());
  return texts.length ? texts.join("\n\n") : null;
}
const noticeText = (dir) => {
  const file = filesIn(dir).find((f) => NOTICE_FILE.test(f));
  return file ? read(path.join(dir, file))?.trim() || null : null;
};

// Lines that state a copyright, not the ones that talk about copyright.
const COPYRIGHT = /^\s*(?:[#*/>\-]\s*)*(?:copyright(?=[\s:©(]|$)|\(c\)\s|©)/i;
const NOT_A_HOLDER = /copyright (?:notice|owner|holder|holders|license|licen[cs]e|and|law|statement|protection|disclaimer)|\[yyyy\]|\{yyyy\}|<year>|\[year\]|\[name of|copyright \(c\) <|^\s*copyright\s*$/i;
function copyrightLines(text) {
  if (!text) return [];
  const lines = text
    .split("\n")
    .filter((l) => COPYRIGHT.test(l) && !NOT_A_HOLDER.test(l) && l.trim().length < 200)
    .map((l) => l.replace(/^\s*(?:[#*/>\-]\s*)*/, "").trim());
  return [...new Set(lines)].slice(0, 4);
}

// The licence text with its copyright lines and title taken out, so the
// same licence under different names is kept once.
function bodyOf(text) {
  return text
    .split("\n")
    .filter((l) => !(COPYRIGHT.test(l) && !NOT_A_HOLDER.test(l)))
    .join("\n")
    .replace(/^\s*#*\s*(the )?mit licen[cs]e( \(mit\))?\s*$/im, "")
    .trim();
}
const keyOf = (body) => body.replace(/\s+/g, " ").toLowerCase();

// "(MIT OR Apache-2.0)", "MIT/Apache-2.0" and a list of licences all
// become "MIT OR Apache-2.0".
function licenceName(raw, dir) {
  let name = raw;
  if (Array.isArray(raw)) name = raw.map((l) => (typeof l === "string" ? l : l?.type)).filter(Boolean).join(" OR ");
  else if (raw && typeof raw === "object") name = raw.type;
  if (typeof name !== "string" || !name.trim()) return "Not stated";
  name = name.trim().replace(/\s*\/\s*/g, " OR ");
  if (/^\(.*\)$/.test(name) && !/\).*\(/.test(name)) name = name.slice(1, -1);
  // A plain choice of licences, in one order: "Apache-2.0 OR MIT" is "MIT OR Apache-2.0".
  if (/ OR /.test(name) && !/[()]| AND | WITH /.test(name)) {
    const order = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "Zlib", "Unlicense", "CC0-1.0"];
    const rank = (l) => (order.includes(l) ? order.indexOf(l) : order.length);
    name = name
      .split(" OR ")
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
      .join(" OR ");
  }
  if (/^see licen[cs]e in/i.test(name)) {
    // A licence of its own: named by its file's first line, if that's a title.
    const file = name.replace(/^see licen[cs]e in\s*/i, "").trim();
    const first = (read(path.join(dir, file)) ?? "").split("\n").find((l) => l.trim());
    const title = first?.replace(/^#+\s*/, "").trim();
    return title && title.length <= 60 ? title : "Its own licence";
  }
  return name;
}

const personOf = (who) => (typeof who === "string" ? who.replace(/\s*[<(].*$/, "").trim() : who?.name) || null;
const urlOf = (pkg) => {
  const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  const raw = pkg.homepage || repo || null;
  if (!raw) return null;
  if (/^github:/.test(raw)) return `https://github.com/${raw.slice(7)}`;
  if (/^[\w-]+\/[\w.-]+$/.test(raw)) return `https://github.com/${raw}`;
  return raw.replace(/^git\+/, "").replace(/^git:\/\//, "https://").replace(/\.git$/, "").replace(/^ssh:\/\/git@/, "https://");
};

// ─── Everything found ───────────────────────────────────────────────────────

/** @type {Map<string, {name:string, version:string, kind:string, licence:string, copyright:string[], author:string|null, url:string|null, text:string|null, notice:string|null, note:string|null}>} */
const found = new Map();
const add = (item) => {
  const key = `${item.kind}:${item.name}@${item.version}`;
  if (!found.has(key)) found.set(key, item);
};

// ─── npm packages ───────────────────────────────────────────────────────────

// Node's own lookup: the nearest node_modules folder up from `from` that
// has the package.
function resolve(name, from) {
  let dir = from;
  for (;;) {
    const candidate = path.join(dir, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    const up = path.dirname(dir);
    if (up === dir || !up.startsWith(ROOT)) return null;
    dir = up;
  }
}

// Packages that don't name their licence, but whose maker covers them all.
const UNSTATED = [
  {
    prefix: "@remotion/",
    licence: "Remotion License",
    note: "Its package doesn't name a licence; the Remotion License covers every Remotion package (remotion.dev/docs/license).",
  },
];

const skipped = new Set();
function walkNode(rootDir) {
  const top = readJson(path.join(rootDir, "package.json"));
  if (!top) return 0;
  const seen = new Set();
  const queue = [];
  const want = (deps, from) => {
    for (const name of Object.keys(deps ?? {})) {
      if (leftOut(name)) {
        skipped.add(name);
        continue;
      }
      const dir = resolve(name, from);
      if (dir && !seen.has(dir)) {
        seen.add(dir);
        queue.push(dir);
      }
    }
  };
  want({ ...top.dependencies, ...top.devDependencies, ...top.optionalDependencies }, rootDir);
  while (queue.length) {
    const dir = queue.shift();
    const pkg = readJson(path.join(dir, "package.json"));
    if (!pkg?.name) continue;
    const text = licenceText(dir);
    const stated = licenceName(pkg.license ?? pkg.licenses, dir);
    const known = stated === "Not stated" ? UNSTATED.find((k) => pkg.name.startsWith(k.prefix)) : null;
    add({
      name: pkg.name,
      version: pkg.version ?? "",
      kind: "npm",
      licence: known?.licence ?? stated,
      copyright: copyrightLines(text),
      author: personOf(pkg.author),
      url: urlOf(pkg),
      text,
      notice: noticeText(dir),
      note: known?.note ?? null,
    });
    want({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies }, dir);
  }
  return seen.size;
}

const nodeRoots = [];
for (const r of NODE_ROOTS) {
  const dir = path.join(ROOT, r);
  if (!existsSync(path.join(dir, "node_modules"))) continue;
  nodeRoots.push(`${r === "." ? "the app" : r} (${walkNode(dir)})`);
}

// ─── Rust crates ────────────────────────────────────────────────────────────

const CARGO_LOCK = path.join(ROOT, "studio/starters/rust/Cargo.lock");
const registries = (() => {
  const base = path.join(process.env.CARGO_HOME || path.join(homedir(), ".cargo"), "registry/src");
  try {
    return readdirSync(base).map((d) => path.join(base, d));
  } catch {
    return [];
  }
})();

function cargoField(toml, field) {
  const pkg = toml.split(/^\[/m).find((s) => s.startsWith("package]")) ?? "";
  const m = new RegExp(`^${field}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*"|\\[[^\\]]*\\])`, "m").exec(pkg);
  if (!m) return null;
  const value = m[1];
  return value.startsWith("[") ? [...value.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]) : value.slice(1, -1);
}

let crates = 0;
const cratesMissing = [];
const lock = read(CARGO_LOCK);
if (lock) {
  for (const block of lock.split("[[package]]").slice(1)) {
    const name = /^name = "(.*)"$/m.exec(block)?.[1];
    const version = /^version = "(.*)"$/m.exec(block)?.[1];
    const source = /^source = "(.*)"$/m.exec(block)?.[1];
    if (!name || !version || !source?.startsWith("registry+")) continue; // the film's own crate
    crates++;
    const dir = registries.map((r) => path.join(r, `${name}-${version}`)).find((d) => existsSync(path.join(d, "Cargo.toml")));
    if (!dir) {
      cratesMissing.push(`${name}@${version}`);
      add({
        name,
        version,
        kind: "crate",
        licence: "Not checked",
        copyright: [],
        author: null,
        url: `https://crates.io/crates/${name}`,
        text: null,
        notice: null,
        note: "This crate's source isn't on this Mac (it's likely only for another system), so its licence wasn't read. Run cargo fetch in studio/starters/rust, then npm run licences.",
      });
      continue;
    }
    const toml = read(path.join(dir, "Cargo.toml")) ?? "";
    const licenceFile = cargoField(toml, "license-file");
    let text = licenceText(dir);
    if (!text && typeof licenceFile === "string") text = read(path.join(dir, licenceFile));
    const authors = cargoField(toml, "authors");
    add({
      name,
      version,
      kind: "crate",
      licence: licenceName(cargoField(toml, "license") ?? (licenceFile ? `SEE LICENSE IN ${licenceFile}` : null), dir),
      copyright: copyrightLines(text),
      author: Array.isArray(authors) && authors.length ? authors.map(personOf).filter(Boolean).join(", ") : null,
      url: (typeof cargoField(toml, "repository") === "string" && cargoField(toml, "repository")) || `https://crates.io/crates/${name}`,
      text,
      notice: noticeText(dir),
      note: null,
    });
  }
}

// ─── Models, the program that runs them, the font, icons and skills ────────

const whisperDir = (() => {
  const home = path.join(ROOT, "node_modules/.cache/studio-whisper");
  try {
    const v = readdirSync(home)
      .filter((d) => d.startsWith("whisper.cpp-"))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
    return v ? path.join(home, v) : null;
  } catch {
    return null;
  }
})();
const gsapFile = path.join(ROOT, "studio/starters/html/assets/vendor/gsap.min.js");
const gsapHead = read(gsapFile)?.slice(0, 600) ?? null;
const skill = (name) => path.join(ROOT, ".claude/skills", name);

// `file`: the licence text, read when it's on this Mac; otherwise the
// licence's standard text (from an npm package under the same licence).
const EXTRAS = [
  {
    name: "whisper.cpp",
    version: whisperDir ? path.basename(whisperDir).replace("whisper.cpp-", "") : "1.9.5",
    kind: "program",
    licence: "MIT",
    copyright: ["Copyright (c) 2023-2026 The ggml authors"],
    author: "Georgi Gerganov and the ggml authors",
    url: "https://github.com/ggml-org/whisper.cpp",
    file: whisperDir && path.join(whisperDir, "LICENSE"),
    note: "Downloaded and built on first use of dictation and captions (on Windows, the project's own prebuilt programs are downloaded).",
  },
  {
    name: "Whisper speech models (large-v3-turbo, large-v3, base)",
    version: "ggml",
    kind: "model",
    licence: "MIT",
    copyright: ["Copyright (c) 2022 OpenAI"],
    author: "OpenAI; converted for whisper.cpp by its authors",
    url: "https://github.com/openai/whisper",
    note: "Downloaded on first use.",
  },
  {
    name: "MediaPipe models (BlazeFace short range, selfie segmenter, selfie multiclass, magic touch)",
    version: "float16/float32 1",
    kind: "model",
    licence: "Apache-2.0",
    copyright: ["Copyright 2023 The MediaPipe Authors"],
    author: "Google",
    url: "https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter",
    note: "Windows only: downloaded on first use of the background remover, face finder and cutouts.",
  },
  {
    name: "Silero VAD (voice detector)",
    version: "5.1.2",
    kind: "model",
    licence: "MIT",
    copyright: ["Copyright (c) 2020-present Silero Team"],
    author: "Silero Team",
    url: "https://github.com/snakers4/silero-vad",
    note: "Downloaded on first use.",
  },
  {
    name: "Whisper-Hindi2Hinglish-Apex",
    version: "q8_0",
    kind: "model",
    licence: "Apache-2.0",
    copyright: [],
    author: "Oriserve; converted for whisper.cpp by Marquestra",
    url: "https://huggingface.co/Oriserve/Whisper-Hindi2Hinglish-Apex",
    note: "Optional: downloaded only when asked for in the mic's menu.",
  },
  {
    name: "Bricolage Grotesque",
    version: "",
    kind: "font",
    licence: "OFL-1.1",
    copyright: [],
    author: "The Bricolage Grotesque Project Authors",
    url: "https://github.com/ateliertriay/bricolage",
    file: path.join(ROOT, "studio/starters/html/assets/fonts/OFL.txt"),
    note: "Shipped with its OFL.txt. Not sold on its own.",
  },
  {
    name: "PikaIcons (free icons)",
    version: "",
    kind: "icons",
    licence: "MIT",
    copyright: [],
    author: "PikaIcons",
    url: "https://pikaicons.com/license",
    note: "The interface's icons. Paid icons, if any are used, need a team licence.",
  },
  ...[
    ["product-film", "https://github.com/Rieranthony"],
    ["html-demo", null],
    ["stopmotion-video", null],
    ["stageshow", "https://github.com/benjitaylor/skills"],
    ["blank-page", "https://github.com/StewdioAI/blank-page"],
  ].map(([name, url]) => ({
    name,
    version: "",
    kind: "skill",
    licence: "MIT",
    copyright: [],
    author: null,
    url,
    file: path.join(skill(name), "LICENSE"),
    noticeFile: ["NOTICE.md", "NOTICE"].map((f) => path.join(skill(name), f)).find((f) => existsSync(f)),
    note: null,
    present: existsSync(skill(name)),
  })),
  {
    name: "GSAP",
    version: /GSAP ([\d.]+)/.exec(gsapHead ?? "")?.[1] ?? "",
    kind: "vendored",
    licence: "GSAP Standard License",
    copyright: ["Copyright 2026, GreenSock. All rights reserved."],
    author: "GreenSock (Webflow)",
    url: "https://gsap.com/standard-license",
    text: gsapHead ? `${gsapHead.split("*/")[0].replace(/^\/\*!?\s*/, "").replace(/^\s*\* ?/gm, "").trim()}\n\nThe full terms: https://gsap.com/standard-license` : null,
    note: "Copied into HTML films (studio/starters/html/assets/vendor).",
    present: Boolean(gsapHead) && !leftOut("gsap"),
  },
];
if (gsapHead && leftOut("gsap")) skipped.add("gsap");

// The standard text of a licence, from the first npm package that has it.
const standard = new Map();
for (const item of found.values()) {
  if (item.text && !standard.has(item.licence)) {
    standard.set(item.licence, bodyOf(item.text));
  }
}

for (const extra of EXTRAS) {
  if (extra.present === false) continue;
  const text = extra.text ?? (extra.file ? read(extra.file) : null);
  add({
    name: extra.name,
    version: extra.version,
    kind: extra.kind,
    licence: extra.licence,
    copyright: [...new Set([...(text ? copyrightLines(text) : []), ...extra.copyright])].slice(0, 4),
    author: extra.author,
    url: extra.url,
    text,
    notice: extra.noticeFile ? read(extra.noticeFile)?.trim() || null : null,
    note: extra.note,
  });
}

// ─── Grouping, with each licence text kept once ─────────────────────────────

const texts = new Map(); // key → { id, body }
const textId = (body) => {
  if (!body) return null;
  const key = keyOf(body);
  let entry = texts.get(key);
  if (!entry) {
    entry = { id: `t${createHash("sha1").update(key).digest("hex").slice(0, 10)}`, body };
    texts.set(key, entry);
  }
  return entry.id;
};

const rows = [...found.values()].map((item) => {
  let body = item.text ? bodyOf(item.text) : null;
  let note = item.note;
  if (!body && standard.has(item.licence)) {
    body = standard.get(item.licence);
    note = [note, "It has no licence file of its own, so this is its licence's standard text."].filter(Boolean).join(" ");
  } else if (!body && /^[\w.+-]+$/.test(item.licence) && item.kind !== "crate") {
    note = [note, `It has no licence file; the licence's text is at https://spdx.org/licenses/${item.licence}.html`].filter(Boolean).join(" ");
  }
  return {
    name: item.name,
    version: item.version,
    kind: item.kind,
    licence: item.licence,
    copyright: item.copyright,
    author: item.author,
    url: item.url,
    text: textId(body),
    notice: textId(item.notice),
    note,
  };
});

// Most used licence first; "Not stated" and "Not checked" last.
const LAST = new Set(["Not stated", "Not checked"]);
const byLicence = new Map();
for (const r of rows) byLicence.set(r.licence, [...(byLicence.get(r.licence) ?? []), r]);
const groups = [...byLicence.entries()]
  .map(([licence, items]) => ({
    licence,
    count: items.length,
    items: items.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version, undefined, { numeric: true })),
  }))
  .sort((a, b) => Number(LAST.has(a.licence)) - Number(LAST.has(b.licence)) || b.count - a.count || a.licence.localeCompare(b.licence));

const pkg = readJson(path.join(ROOT, "package.json"));
const studio = { name: "Saymo", version: pkg?.version ?? "0.0.0", edition: EDITION };
const textsById = Object.fromEntries([...texts.values()].map((t) => [t.id, t.body]));

// ─── public/licences.json ───────────────────────────────────────────────────

writeFileSync(
  path.join(ROOT, "public/licences.json"),
  `${JSON.stringify({ studio, total: rows.length, leftOut: [...skipped].sort(), groups, texts: textsById })}\n`,
);

// ─── docs/THIRD-PARTY-NOTICES.md ───────────────────────────────────────────

const fence = (text) => `\`\`\`text\n${text.replace(/```/g, "'''")}\n\`\`\``;
const KIND_WORDS = { npm: "", crate: " (Rust crate)", model: " (model)", program: " (program)", font: " (font)", icons: " (icons)", artwork: " (artwork)", skill: " (Claude skill)", vendored: " (copied in)" };
const line = (r) => {
  const who = r.copyright.length ? r.copyright.join("; ") : r.author ? `By ${r.author}` : "No copyright line given";
  const extra = [r.url, r.note].filter(Boolean).join(". ");
  return `- **${r.name}**${r.version ? ` ${r.version}` : ""}${KIND_WORDS[r.kind] ?? ""}: ${who}${extra ? `. ${extra}` : ""}`;
};

const out = [];
out.push("# Third-party notices", "");
out.push(
  `${studio.name} ${studio.version} (${EDITION} edition) is built with the software, models, font, icons and skills below, made by others. Each is listed with its version, licence and copyright line, followed by the text of its licence. A licence text that several of them share is printed once, after the list of every one that uses it.`,
  "",
  "This file is made by `npm run licences` from what's installed. Don't edit it by hand: run that again after adding or updating anything.",
  "",
);
if (skipped.size) out.push(`Left out of the ${EDITION} edition, which doesn't ship them: ${[...skipped].sort().join(", ")}.`, "");
out.push("| Licence | How many |", "| --- | --- |");
for (const g of groups) out.push(`| ${g.licence} | ${g.count} |`);
out.push(`| All | ${rows.length} |`, "");

for (const g of groups) {
  out.push(`## ${g.licence}`, "");
  const byText = new Map();
  for (const r of g.items) byText.set(r.text ?? "", [...(byText.get(r.text ?? "") ?? []), r]);
  for (const [id, items] of byText) {
    for (const r of items) out.push(line(r));
    out.push("");
    if (id) out.push(fence(textsById[id]), "");
    else out.push("No licence text was found for these.", "");
    for (const r of items) {
      if (r.notice) out.push(`Notice for ${r.name} ${r.version}:`, "", fence(textsById[r.notice]), "");
    }
  }
}
writeFileSync(path.join(ROOT, "docs/THIRD-PARTY-NOTICES.md"), `${out.join("\n").trimEnd()}\n`);

// ─── What happened ──────────────────────────────────────────────────────────

const say = (s) => process.stdout.write(`${s}\n`);
say(`${studio.name} ${studio.version}, ${EDITION} edition: ${rows.length} in all.`);
say(`npm packages from ${nodeRoots.join(", ") || "nowhere (run npm install first)"}.`);
if (lock) say(`Rust crates: ${crates} in Cargo.lock${cratesMissing.length ? `, ${cratesMissing.length} not downloaded on this Mac` : ""}.`);
if (skipped.size) say(`Left out: ${[...skipped].sort().join(", ")}.`);
say("");
const width = Math.max(...groups.map((g) => g.licence.length));
for (const g of groups) say(`${g.licence.padEnd(width)}  ${g.count}`);
say("");
say(`Wrote docs/THIRD-PARTY-NOTICES.md and public/licences.json (${texts.size} distinct licence texts).`);
