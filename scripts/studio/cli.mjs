#!/usr/bin/env node
// Saymo from the terminal: `npm run studio -- <command>`, or
// `saymo <command>` after `npm link`. Talks to the studio that is
// already running (`npm run dev`) through its local API. Results go to
// stdout; progress and problems go to stderr. --json prints the result as
// JSON instead. See docs/mcp.md.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  attachFromLibrary,
  changeFilm,
  createFilm,
  FORMATS,
  filmLink,
  getFilm,
  goBack,
  listFilms,
  listLibrary,
  listVersions,
  PAGE_URL,
  ping,
  readToken,
  renderFilm,
  StudioError,
  TOKEN_FILE,
  tokenFileMode,
} from "./client.mjs";
import { IS_MAC, IS_WINDOWS, openLink, othersCanRead } from "./platform.mjs";

const HELP = `Saymo from the terminal

Usage: npm run studio -- <command> [options]

Commands
  films                         List the films, newest first
  new "<prompt>"                Make a new film; Claude makes the first version
      --format 16:9|1:1|4:5|9:16  Its shape (default 16:9)
      --video                     A video edit instead of motion graphics
      --brand <name or id>        A brand kit (default Clean)
  change <id> "<prompt>"        Ask the film's Claude for a change
      --at <seconds>              The moment in the film it's about
      --library <ids>             Library items to send with it, comma-separated
  render <id>                   Make the final videos (4K and the film's own size)
      --draft                     A quick draft instead
  versions <id>                 The film after each prompt, newest first
  back <id> <version>           Go back to an earlier version
  open <id>                     Open the film in the studio
  library ["<words>"]           List the reference library, newest first
      --tag <tag>                 Only items with this tag
  attach <id> <item…>           Copy library items into a film's references
  doctor                        Check the studio, its token, ffmpeg and Claude

Options
  --json                        Print the result as JSON
  --help                        Show this

The studio must be running (npm run dev). Set SAYMO_URL to use
another one, e.g. http://127.0.0.1:3333.`;

// ─── Arguments ──────────────────────────────────────────────────────────────

const FLAGS = new Set(["json", "help", "draft", "video"]);
const VALUES = new Set(["format", "brand", "at", "library", "tag"]);

function parse(argv) {
  const words = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h") opts.help = true;
    else if (a.startsWith("--")) {
      const [name, inline] = a.slice(2).split("=", 2);
      if (FLAGS.has(name)) opts[name] = true;
      else if (VALUES.has(name)) {
        const value = inline ?? argv[++i];
        if (value === undefined) throw new StudioError(`--${name} needs a value.`, "usage");
        opts[name] = value;
      } else throw new StudioError(`There's no --${name} option. Run with --help to see them.`, "usage");
    } else words.push(a);
  }
  return { words, opts };
}

const need = (value, what) => {
  if (!value) throw new StudioError(`Missing ${what}. Run with --help to see how.`, "usage");
  return value;
};

// ─── Output ─────────────────────────────────────────────────────────────────

let asJson = false;
const out = (text) => process.stdout.write(`${text}\n`);
const note = (text) => process.stderr.write(`${text}\n`);
const seconds = (s) => `${Number(s ?? 0).toFixed(1).replace(/\.0$/, "")} s`;
const when = (iso) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

function table(rows) {
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => String(r[c]).length)));
  return rows.map((r) => r.map((cell, c) => String(cell).padEnd(widths[c])).join("  ").trimEnd()).join("\n");
}

// What a Claude turn says as it goes, on stderr.
function narrate(event) {
  if (asJson) return;
  if (event.kind === "start") note("Claude started on the film…");
  else if (event.kind === "step") note(`  ${event.label}`);
}

function printTurn(result) {
  if (asJson) return out(JSON.stringify(result, null, 2));
  if (result.reply) out(`\n${result.reply}\n`);
  if (result.error) note(result.error);
  if (result.film) out(`${result.film.title} (${result.film.id})\n${result.film.link}`);
}

// ─── Commands ───────────────────────────────────────────────────────────────

async function films() {
  const list = await listFilms();
  if (asJson) return out(JSON.stringify(list, null, 2));
  if (!list.length) return out("No films yet. Make one with: npm run studio -- new \"<prompt>\"");
  out(table([["ID", "TITLE", "KIND", "FORMAT", "LENGTH", "EDITED"], ...list.map((f) => [f.id, f.title, f.kind, f.format, seconds(f.duration), when(f.updatedAt)])]));
}

async function create(words, opts) {
  const prompt = words.join(" ").trim();
  const format = opts.format ?? "16:9";
  if (!FORMATS[format]) throw new StudioError(`The format is one of ${Object.keys(FORMATS).join(", ")}.`, "usage");
  if (!prompt && !opts.video) need("", 'a prompt, e.g. new "A 6 second loop of orange lines"');
  if (prompt && !asJson) note("Making the film. Claude's first version can take a few minutes.");
  printTurn(await createFilm({ prompt, format, kind: opts.video ? "video" : "motion", brand: opts.brand, onEvent: narrate }));
}

async function change(words, opts) {
  const id = need(words[0], "the film's id");
  const prompt = need(words.slice(1).join(" ").trim(), "what to change");
  const at = opts.at === undefined ? undefined : Number(opts.at);
  if (at !== undefined && !(Number.isFinite(at) && at >= 0)) throw new StudioError("--at is a number of seconds, like 2.5.", "usage");
  const items = opts.library ? String(opts.library).split(",").map((s) => s.trim()).filter(Boolean) : [];
  const attachments = items.length ? await attachFromLibrary(id, items) : undefined;
  printTurn(await changeFilm(id, prompt, { at, attachments, onEvent: narrate }));
}

async function render(words, opts) {
  const id = need(words[0], "the film's id");
  const quality = opts.draft ? "draft" : "final";
  let last = "";
  const done = await renderFilm(id, quality, {
    onProgress: (s) => {
      if (asJson) return;
      const line = s.state === "running" ? `Rendering the ${quality}: ${Math.round(s.progress * 100)}%` : "Waiting for another render to finish…";
      if (line !== last) note(line);
      last = line;
    },
  });
  if (asJson) return out(JSON.stringify(done, null, 2));
  out(done.files.map((f) => f.path).join("\n"));
}

async function versions(words) {
  const id = need(words[0], "the film's id");
  const list = await listVersions(id);
  if (asJson) return out(JSON.stringify(list, null, 2));
  out(table([["VERSION", "WHAT", "WHEN"], ...list.map((v) => [v.version ?? "now", v.current ? (v.detail ?? "Now") : v.label, when(v.at)])]));
}

async function back(words) {
  const id = need(words[0], "the film's id");
  const film = await goBack(id, need(words[1], "the version number (see: versions <id>)"));
  if (asJson) return out(JSON.stringify(film, null, 2));
  out(`Went back. The film as it was is kept as a version too.\n${film.link}`);
}

async function open(words) {
  const id = need(words[0], "the film's id");
  await getFilm(id);
  const link = filmLink(id);
  if (asJson) out(JSON.stringify({ link }, null, 2));
  else out(link);
  if (IS_MAC || IS_WINDOWS) openLink(link);
}

async function library(words, opts) {
  const list = await listLibrary({ query: words.join(" "), tag: opts.tag });
  if (asJson) return out(JSON.stringify(list, null, 2));
  if (!list.length) return out("Nothing in the library matches. Add references on the studio's home page, under Library.");
  out(table([["ID", "KIND", "NAME", "TAGS", "SAVED"], ...list.map((i) => [i.id, i.kind, i.name, i.tags.join(", "), when(i.updatedAt)])]));
}

async function attach(words) {
  const id = need(words[0], "the film's id");
  const done = await attachFromLibrary(id, need(words.slice(1).length ? words.slice(1) : null, "the library item ids (see: library)"));
  if (asJson) return out(JSON.stringify(done, null, 2));
  out(done.map((a) => `${a.path}  (${a.name})`).join("\n"));
}

// ─── Doctor ─────────────────────────────────────────────────────────────────

const run = (bin, args) =>
  new Promise((resolve) => {
    execFile(bin, args, { timeout: 15000 }, (error, stdout) => resolve(error ? null : String(stdout).split("\n")[0].trim()));
  });

async function doctor() {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  const major = Number(process.versions.node.split(".")[0]);
  add("Node", major >= 20, major >= 20 ? `v${process.versions.node}` : `v${process.versions.node}; the studio needs Node 20 or newer`);

  const hadFile = existsSync(TOKEN_FILE);
  let tokenOk = true;
  try {
    await readToken();
  } catch (error) {
    tokenOk = false;
    add("Token", false, error.message);
  }
  if (tokenOk) {
    if (process.env.SAYMO_TOKEN ?? process.env.MOTION_STUDIO_TOKEN) add("Token", true, "from SAYMO_TOKEN");
    else {
      const mode = await tokenFileMode();
      const tight = mode !== null && !othersCanRead(TOKEN_FILE, mode);
      add(
        "Token",
        tight,
        tight
          ? `${hadFile ? "saved" : "made just now"} in .studio/api-token, readable only by you`
          : IS_WINDOWS
            ? ".studio/api-token can be read by others on this PC. Restart the studio (npm run dev) and it makes .studio private again."
            : `.studio/api-token can be read by others on this Mac (mode ${mode?.toString(8)}). Fix it with: chmod 600 "${TOKEN_FILE}"`,
      );
    }
  }

  const studio = await ping();
  add(
    "Studio",
    studio.ok,
    studio.ok ? `running at ${PAGE_URL} and takes the token` : studio.message,
  );

  const ffmpeg = await run("ffmpeg", ["-version"]);
  add("ffmpeg", Boolean(ffmpeg), ffmpeg ? ffmpeg.replace(/ Copyright.*/, "") : "not found. Install it with: brew install ffmpeg");

  const own = path.join(homedir(), ".local/bin/claude");
  const claudeBin = process.env.STUDIO_CLAUDE_BIN ?? (existsSync(own) ? own : "claude");
  const claude = await run(claudeBin, ["--version"]);
  add("Claude", Boolean(claude), claude ? `Claude Code ${claude.replace(/\s*\(Claude Code\)/, "")}` : "the Claude command line isn't installed. See docs/setup.md");

  if (asJson) out(JSON.stringify({ ok: checks.every((c) => c.ok), checks }, null, 2));
  else {
    const width = Math.max(...checks.map((c) => c.name.length));
    for (const c of checks) out(`${c.ok ? "ok " : "no "} ${c.name.padEnd(width)}  ${c.detail}`);
  }
  if (!checks.every((c) => c.ok)) process.exitCode = 1;
}

// ─── Main ───────────────────────────────────────────────────────────────────

const COMMANDS = { films, new: create, change, render, versions, back, open, library, attach, doctor };

try {
  const { words, opts } = parse(process.argv.slice(2));
  asJson = Boolean(opts.json);
  const [command, ...rest] = words;
  if (opts.help || !command || command === "help") out(HELP);
  else if (!COMMANDS[command]) throw new StudioError(`There's no "${command}" command. Run with --help to see them.`, "usage");
  else await COMMANDS[command](rest, opts);
} catch (error) {
  const message = error instanceof StudioError ? error.message : `Something went wrong: ${error?.message ?? error}`;
  if (asJson) out(JSON.stringify({ error: { code: error?.code ?? "failed", message } }, null, 2));
  else note(message);
  process.exitCode = error?.code === "usage" ? 2 : 1;
}
