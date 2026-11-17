// Listens to a file's speech and writes its words with their times, for
// captions and for Claude to cut by what's said. Runs on this Mac, offline
// once set up: whisper.cpp (built here the first time, Metal on Apple
// silicon) with the large-v3-turbo model, which handles Indian English
// well and runs several times faster than large-v3 at nearly its accuracy.
//
// usage: node scripts/studio/transcribe.mjs <source file> <out.json>
//        node scripts/studio/transcribe.mjs --setup     (just install)
//
// Prints `step <plain words>` lines as it goes. On failure the last line on
// stderr starts with "! " and says what went wrong in plain words.
// Writes Word[] (edit.ts): { text, start, end, confidence } in seconds of
// the source file.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IS_MAC, IS_WINDOWS } from "./platform.mjs";
import { installWhisperWindows } from "./whisper-windows.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(ROOT, "studio/remotion/package.json"));
const { installWhisperCpp, downloadWhisperModel, transcribe, toCaptions } = require("@remotion/install-whisper-cpp");

const HOME = path.join(ROOT, "node_modules/.cache/studio-whisper");
const VERSION = "1.9.5";
const WHISPER = path.join(HOME, `whisper.cpp-${VERSION}`);
const CLI = path.join(WHISPER, "build/bin", IS_WINDOWS ? "whisper-cli.exe" : "whisper-cli");
const MODELS = path.join(HOME, "models");
const MODEL = process.env.STUDIO_WHISPER_MODEL || "large-v3-turbo";
// English, so mixed Hindi and English speech comes out in Latin letters for
// English captions. STUDIO_WHISPER_LANGUAGE=auto lets whisper decide.
const LANGUAGE = process.env.STUDIO_WHISPER_LANGUAGE === "auto" ? null : process.env.STUDIO_WHISPER_LANGUAGE || "en";

// A hint of words whisper should spell right; STUDIO_WHISPER_PROMPT
// replaces it (put your brand and product names there).
const VOCABULARY = "Saymo, motion design, title, logo, caption.";

const say = (text) => console.log(`step ${text}`);
const fail = (text) => {
  console.error(`! ${text}`);
  process.exit(1);
};

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (c) => (err = (err + c).slice(-2000)));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err))));
  });

// The whisper build records the folder it was built in as where to find its
// libraries, so moving or renaming the project broke it. Point it at its own
// folder instead (once), and re-sign it so macOS still runs it.
async function findOwnLibraries() {
  if (!IS_MAC) return;
  const bin = CLI;
  if (!existsSync(bin)) return;
  const paths = await new Promise((resolve) => {
    // eslint-disable-next-line no-restricted-syntax -- Mac only; Windows' build needs no fixing
    const child = spawn("otool", ["-l", bin], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.on("close", () => resolve(out));
    child.on("error", () => resolve(""));
  });
  if (String(paths).includes("@executable_path")) return;
  try {
    /* eslint-disable no-restricted-syntax -- Mac only; Windows' build needs no fixing */
    await run("install_name_tool", ["-add_rpath", "@executable_path", bin]);
    await run("codesign", ["--force", "-s", "-", bin]);
    /* eslint-enable no-restricted-syntax */
  } catch {
    // Left as it is; transcribing reports its own error if it can't start.
  }
}

async function setup() {
  await mkdir(HOME, { recursive: true });
  if (!existsSync(CLI)) {
    say("Setting up listening on this computer (first time only, a few minutes)");
    await rm(WHISPER, { recursive: true, force: true });
    try {
      if (IS_WINDOWS) await installWhisperWindows(WHISPER);
      else await installWhisperCpp({ version: VERSION, to: WHISPER, printOutput: false });
    } catch (error) {
      console.error(error);
      fail(
        IS_WINDOWS
          ? "Setting up listening failed. It needs the internet once; try again."
          : "Setting up listening failed. It needs the internet once, Xcode's command line tools and cmake (brew install cmake).",
      );
    }
  }
  await findOwnLibraries();
  let shown = -1;
  await mkdir(MODELS, { recursive: true });
  await downloadWhisperModel({
    model: MODEL,
    folder: MODELS,
    printOutput: false,
    onProgress: (done, total) => {
      const pct = total ? Math.floor((100 * done) / total) : 0;
      if (pct >= shown + 5) {
        shown = pct;
        say(`Getting the speech model (first time only, ${pct}%)`);
      }
    },
  }).catch((error) => {
    console.error(error);
    fail("The speech model couldn't be downloaded. Check the internet connection and try again.");
  });
}

// Whisper's pieces are words with a leading space; pieces without one
// (punctuation, the end of a split word) belong to the word before.
function words(captions) {
  const out = [];
  for (const c of captions) {
    const raw = c.text ?? "";
    const text = raw.trim();
    if (!text || /^\[.*\]$/.test(text) || /^\(.*\)$/.test(text)) continue;
    const start = c.startMs / 1000;
    const end = c.endMs / 1000;
    const prev = out.at(-1);
    if (prev && !/^\s/.test(raw)) {
      prev.text += text;
      prev.end = Math.max(prev.end, end);
      continue;
    }
    out.push({ text, start, end: Math.max(end, start + 0.01), confidence: Math.round((c.confidence ?? 1) * 1000) / 1000 });
  }
  return out;
}

const [source, outFile] = process.argv.slice(2);
if (source === "--setup") {
  await setup();
  process.exit(0);
}
if (!source || !outFile) fail("usage: node scripts/studio/transcribe.mjs <source> <out.json>");

await setup();
say("Getting the sound ready");
const wav = path.join(HOME, "tmp", `${randomBytes(6).toString("hex")}.wav`);
await mkdir(path.dirname(wav), { recursive: true });
try {
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", source, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
} catch {
  fail("The studio couldn't read the sound in this file.");
}

say("Listening");
let shown = -1;
try {
  const result = await transcribe({
    inputPath: wav,
    whisperPath: WHISPER,
    whisperCppVersion: VERSION,
    model: MODEL,
    modelFolder: MODELS,
    tokenLevelTimestamps: true,
    splitOnWord: true,
    language: LANGUAGE,
    printOutput: false,
    // Names whisper wouldn't know, so it spells them right.
    additionalArgs: [["--prompt", process.env.STUDIO_WHISPER_PROMPT || VOCABULARY]],
    onProgress: (p) => {
      const pct = Math.floor(p * 100);
      if (pct >= shown + 5) {
        shown = pct;
        say(`Listening (${pct}%)`);
      }
    },
  });
  const list = words(toCaptions({ whisperCppOutput: result }).captions);
  await writeFile(`${outFile}.part`, JSON.stringify(list));
  await rename(`${outFile}.part`, outFile);
} catch (error) {
  console.error(error);
  fail("Listening stopped with an error. Try again; if it keeps failing, the file's sound may be damaged.");
} finally {
  await rm(wav, { force: true });
}
