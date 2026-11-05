// A look and moves for a film, for the studio's Claude: the blank-page
// skill's reference search (are.na channels and Sketchfab models), run
// inside the film it's for. Contact sheets go where Claude may Read them
// (the media tool's frames folder), references into the film's
// look/<topic>/, and a 3D model into the film's own assets.
//
// usage (from films/<id>/):
//   node <project>/scripts/studio/look.mjs <id> channels "<words>" [n]
//   node … <id> search "<words>" [pages] [all|moving|still]
//   node … <id> user-channels <user>
//   node … <id> channel <slug> [n] [all|moving|still] [pattern]
//   node … <id> connections <block> [n]
//   node … <id> umbrella <slug> [pattern]
//   node … <id> get <https url> <topic> <name>
//   node … <id> sheet look/<topic>/<file> [frames]
//   node … <id> sketchfab "<words>" [n] [max faces]
//   node … <id> sketchfab-get <uid> <name>
//
// It only works inside the film it's run from, checks every argument, only
// fetches public web addresses, and runs nothing through a shell. The
// searching is find_refs.py, borrowed with the skill (MIT).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIND = path.join(ROOT, ".claude/skills/blank-page/scripts/find_refs.py");

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const [id, command, ...rest] = process.argv.slice(2);
const dir = process.cwd();
if (!/^[a-z0-9]{8}$/.test(id ?? "") || dir !== path.join(ROOT, "films", id)) {
  fail("Run this from the film's own folder, with that film's id: node …/look.mjs <id> <command>.");
}
const film = JSON.parse(readFileSync(path.join(dir, "film.json"), "utf8"));
// Where contact sheets go: the media tool's frames folder, which Claude may Read.
const sheets = path.join(ROOT, "films/.work", id, "frames", "look");

const slug = (s, max) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, max);

const words = (s, what) => {
  if (typeof s !== "string" || !s.trim() || s.length > 120 || /[\0\r\n]/.test(s)) fail(`Give ${what} as plain words.`);
  return s.trim();
};
const count = (s, otherwise, max) => {
  if (s === undefined) return String(otherwise);
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > max) fail(`Give a number from 1 to ${max}.`);
  return String(n);
};
const kind = (s) => {
  if (s === undefined) return "all";
  if (!["all", "moving", "still"].includes(s)) fail("The kind is all, moving or still.");
  return s;
};
const handle = (s, what) => {
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(s ?? "")) fail(`Give ${what} as it appears in its are.na address.`);
  return s;
};
const pattern = (s) => {
  if (s === undefined) return [];
  if (s.length > 100) fail("Keep the pattern short.");
  try {
    new RegExp(s, "i");
  } catch {
    fail("That pattern isn't a valid regular expression.");
  }
  return [s];
};

// Public web addresses only: never this Mac or its own network.
function publicUrl(s) {
  let url;
  try {
    url = new URL(s);
  } catch {
    fail("Give a full web address, starting with https://.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") fail("Only http and https addresses.");
  const host = url.hostname.toLowerCase();
  const local =
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.includes(":") ||
    host.startsWith("[") ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  if (local) fail("Only public web addresses.");
  return url.toString();
}

function run(args) {
  try {
    execFileSync("python3", [FIND, ...args], { cwd: dir, stdio: "inherit", timeout: 6 * 60_000 });
  } catch (error) {
    fail(error.code === "ENOENT" ? "Python 3 isn't on this Mac. Install it with Homebrew (brew install python), then try again." : "The search stopped. Try again, or try other words.");
  }
}

mkdirSync(sheets, { recursive: true });
switch (command) {
  case "channels":
    run(["channels", words(rest[0], "the words to search"), count(rest[1], 12, 40)]);
    break;
  case "search":
    run(["search", words(rest[0], "the words to search"), sheets, count(rest[1], 2, 5), kind(rest[2])]);
    break;
  case "user-channels":
    run(["user-channels", handle(rest[0], "the user")]);
    break;
  case "channel":
    run(["channel", handle(rest[0], "the channel"), sheets, count(rest[1], 48, 96), kind(rest[2]), ...pattern(rest[3])]);
    break;
  case "connections":
    if (!/^\d{1,12}$/.test(rest[0] ?? "")) fail("Give the block's number.");
    run(["connections", rest[0], count(rest[1], 12, 40)]);
    break;
  case "umbrella":
    run(["umbrella", handle(rest[0], "the umbrella channel"), ...pattern(rest[1])]);
    break;
  case "get": {
    const url = publicUrl(rest[0]);
    const topic = slug(words(rest[1], "the topic"), 32) || fail("Give the topic as a word or two.");
    const name = slug(words(rest[2], "the file's name"), 48) || fail("Give the file a name.");
    // find_refs.py renames the file for what it really is once it's here.
    const ext = path.extname(new URL(url).pathname).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 6) || ".bin";
    const out = path.join(dir, "look", topic, `${name}${ext}`);
    mkdirSync(path.dirname(out), { recursive: true });
    run(["get", url, out]);
    break;
  }
  case "sheet": {
    const file = path.resolve(dir, words(rest[0], "the file"));
    if (!file.startsWith(path.join(dir, "look") + path.sep) || !existsSync(file)) fail("Give a file this tool saved, under look/.");
    run(["sheet", file, path.join(sheets, `${slug(path.basename(file), 60)}.png`), count(rest[1], 9, 25)]);
    break;
  }
  case "sketchfab":
    run(["sketchfab", words(rest[0], "the words to search"), path.join(sheets, "sketchfab"), count(rest[1], 9, 24), count(rest[2], 300000, 2000000)]);
    break;
  case "sketchfab-get": {
    if (!/^[0-9a-f]{32}$/.test(rest[0] ?? "")) fail("Give the model's uid, from the search.");
    const name = slug(words(rest[1], "the model's name"), 48) || fail("Give the model a name.");
    const home = film.engine === "react" ? path.join(dir, "public", "models") : path.join(dir, "assets", "models");
    mkdirSync(home, { recursive: true });
    run(["sketchfab-get", rest[0], path.join(home, `${name}.glb`)]);
    break;
  }
  default:
    fail("Commands: channels, search, user-channels, channel, connections, umbrella, get, sheet, sketchfab, sketchfab-get.");
}
