// `npm run setup`: sets up Saymo in one go. On a Mac it runs setup.sh (with
// Homebrew); on Windows it does the same steps with winget, here. Safe to
// run again; it skips what's already there.
//
//   npm run setup                 everything but the Rust engine
//   npm run setup -- --with-rust  also the Rust engine (fframes)
//   npm run setup -- --product    the product edition: leaves out Strudel
//                                 (AGPL-3.0), which only plays old in-house films

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addToPath, IS_WINDOWS } from "./studio/platform.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

if (!IS_WINDOWS) {
  const r = spawnSync("bash", [path.join(ROOT, "scripts/setup.sh"), ...args], { cwd: ROOT, stdio: "inherit" });
  process.exit(r.status ?? 1);
}

const WITH_RUST = args.includes("--with-rust");
const PRODUCT = args.includes("--product");
const step = (text) => console.log(`\n\x1b[1m${text}\x1b[0m`);
const ok = (text) => console.log(`  done: ${text}`);
const note = (text) => console.log(`  ${text}`);
const stop = (text) => {
  console.error(`\n${text}`);
  process.exit(1);
};
const quiet = (cmd, argv) => spawnSync(cmd, argv, { encoding: "utf8", windowsHide: true });
const has = (cmd) => quiet("where.exe", [cmd]).status === 0;
// npm itself, run with this Node (npm on Windows is a .cmd).
const npm = (...argv) => {
  const cli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  const r = spawnSync(process.execPath, [cli, ...argv], { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) stop(`npm ${argv.join(" ")} failed. Fix what it says above, then run npm run setup again.`);
};
// Programs winget installs land in its Links folder, which a terminal opened
// before the install doesn't have on its PATH yet.
const LINKS = path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Links");
addToPath(LINKS);
const winget = (id, what) => {
  if (!has("winget")) stop(`Install ${what} first (winget isn't here: get "App Installer" from the Microsoft Store), then run this again.`);
  note(`installing ${what} with winget...`);
  const r = spawnSync("winget", ["install", "--id", id, "-e", "--silent", "--accept-package-agreements", "--accept-source-agreements"], { stdio: "inherit" });
  if (r.status !== 0 && !has(what)) stop(`winget couldn't install ${what}. Install it yourself, then run this again.`);
};

step("1. Checking this PC");
const major = Number(process.versions.node.split(".")[0]);
if (major < 22) stop("Saymo needs Node.js 22 or newer. Install it (https://nodejs.org) and run this again.");
const chrome = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA]
  .filter(Boolean)
  .map((dir) => path.join(dir, "Google", "Chrome", "Application", "chrome.exe"));
if (!chrome.some((p) => existsSync(p))) stop("Install Google Chrome: the studio renders videos with it.");
ok(`Windows, Node ${process.version}, Chrome`);

step("2. Video and audio tools");
if (has("ffmpeg")) ok("ffmpeg already installed");
else winget("Gyan.FFmpeg", "ffmpeg");
const encoders = quiet("ffmpeg", ["-hide_banner", "-encoders"]).stdout ?? "";
if (!encoders.includes("libx264")) stop("Your ffmpeg can't make H.264 videos (no libx264). Run: winget install Gyan.FFmpeg, then run this again.");
const { machine } = await import("./studio/machine.mjs");
const m = await machine();
if (m.finalEncoder) ok(`ffmpeg can use this PC's hardware video encoder, ${m.finalEncoder} (faster renders)`);
else if (m.draftEncoder) ok(`ffmpeg uses ${m.draftEncoder} for drafts; finals use x264`);
else note("note: ffmpeg found no hardware video encoder here, so renders use x264 (slower, same quality).");
// Turning slides into a video draws PDF pages with poppler. PowerPoint
// files are drawn by LibreOffice or PowerPoint, if either is installed.
if (has("pdftoppm")) ok("poppler already installed (PDF slides)");
else winget("oschwartz10612.Poppler", "pdftoppm");
const office = quiet("reg.exe", ["query", "HKCR\\PowerPoint.Application"]).status === 0;
if (office || has("soffice") || existsSync(path.join(process.env.ProgramFiles ?? "", "LibreOffice", "program", "soffice.exe"))) {
  ok("PowerPoint or LibreOffice found (PowerPoint slides)");
} else {
  note("optional: to turn PowerPoint and OpenDocument files into slides, install PowerPoint,");
  note("          or LibreOffice: winget install TheDocumentFoundation.LibreOffice");
}

step("3. The app's packages");
npm("ci", "--no-audit", "--no-fund");

step("4. The engines' packages");
for (const engine of ["remotion", "hyperframes", "sound"]) {
  npm("ci", "--prefix", `studio/${engine}`, "--no-audit", "--no-fund");
  ok(engine);
}
if (PRODUCT) ok("left out Strudel (product edition)");
else {
  npm("ci", "--prefix", "studio/sound/strudel", "--no-audit", "--no-fund");
  ok("sound/strudel (old films' music, in-house only)");
}
const { packageBin } = await import("./studio/platform.mjs");
const hf = packageBin(path.join(ROOT, "studio/hyperframes"), "hyperframes");
if (hf) quiet(hf[0], [...hf[1], "telemetry", "disable"]);

if (WITH_RUST) {
  step("5. The Rust engine");
  if (!has("cargo")) stop("Install Rust first (https://rustup.rs), then run: npm run setup -- --with-rust");
  for (const [tool, id] of [["nasm", "NASM.NASM"], ["ninja", "Ninja-build.Ninja"]]) if (!has(tool)) winget(id, tool);
  ok(`Rust ${quiet("rustc", ["--version"]).stdout.split(" ")[1]}; the first Rust film takes a few minutes to build`);
}

step("Ready");
console.log(`  Start it:      npm run dev
  Then open:     http://localhost:3200/studio

  Two things happen the first time you use them, so they take longer once:
  - transcribing speech downloads whisper and its speech model (about 1.6 GB,
    and about 300 MB more on a PC with an NVIDIA card, which makes it fast)
  - Claude in the studio uses your own Claude Code sign-in (run \`claude\` once if you haven't)

  Optional keys go in .env.local (see docs/setup.md). Never commit that file.`);
