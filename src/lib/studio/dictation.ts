import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  type Accuracy,
  type DictationErrorCode,
  type DictationLanguage,
  type DictationStatus,
  type ExtraModel,
  type HindiScript,
  MAX_PIECE_BYTES,
  type PieceResult,
} from "./dictation-shared";
import { ROOT } from "./films";
import { hasDevanagari, toRoman } from "./roman";

// Talking into a prompt box: each piece of a recording is written down on
// this Mac by whisper.cpp, the same install the studio uses for captions
// (scripts/studio/transcribe.mjs sets it up). Nothing leaves the Mac except
// the one-time downloads.
//
// - Speed: whisper-server keeps the model loaded between recordings (on
//   this Mac only, at a random port and a secret path), so a 30 second
//   piece is written down in about a second on Apple silicon (Metal). If
//   the server won't start or dies, the piece goes to whisper-cli instead.
// - Accuracy: large-v3-turbo (installed with captions) or, as an optional
//   1.1 GB download, large-v3, which measured better on Hindi and on mixed
//   Hindi and English, at about 2.5 times the time (4.6 s for 30 s of
//   speech on an M5, against 1.8 s).
//   Both with beam search (5), whisper's temperature fallback, timestamps
//   (without them whisper can stop after the first sentence), and the
//   Silero voice detector (cuts silence, so silence doesn't come back as
//   "Thank you.").
// - English and Hindi in one recording: Detect and Hinglish find the
//   language of every stretch of speech first (whisper's small base model,
//   about 40 ms a stretch), then write each part in its own language.
//   Whisper set to one language drops or translates the other. Every other
//   path is checked afterwards for speech no line covers, which is then
//   written down on its own (writeDown).
// - Hindi: whisper writes Devanagari; for Roman letters roman.ts spells it
//   out. On Fast, the optional Hinglish model (Oriserve's
//   Whisper-Hindi2Hinglish-Apex, a fine-tune of large-v3-turbo, Apache 2.0)
//   writes Roman letters itself and is more accurate than that.
// - Nothing is lost: each piece is saved under .studio/dictation before
//   it's written down and deleted only once it has been.

const HOME = path.join(ROOT, "node_modules/.cache/studio-whisper");
const VERSION = "1.9.5";
const BIN = path.join(HOME, `whisper.cpp-${VERSION}`, "build/bin");
const MODELS = path.join(HOME, "models");
const KEEP = path.join(ROOT, ".studio/dictation");
const TMP = path.join(HOME, "tmp");

const STANDARD = path.join(MODELS, "ggml-large-v3-turbo.bin");
// Downloads checked against their published SHA-256 before use.
const VAD = {
  file: path.join(MODELS, "ggml-silero-v5.1.2.bin"),
  url: "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin",
  sha256: "29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf",
};
// whisper's base model (60 MB), only to tell which language each stretch of
// speech is in: it told English from Hindi in 19 of 19 test stretches, 1 to
// 3 seconds long, in about 40 ms each. Fetched without asking, like the
// voice detector.
const LANGUAGE_ID = {
  file: path.join(MODELS, "ggml-base-q5_1.bin"),
  url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin",
  sha256: "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898",
};

// The optional models, downloaded only when asked for in the mic's menu.
const EXTRA: Record<ExtraModel, { file: string; url: string; sha256: string; bytes: number; name: string }> = {
  // large-v3, quantised to 5 bits by whisper.cpp (near the full model's
  // accuracy at a third of the size). MIT, OpenAI.
  best: {
    file: path.join(MODELS, "ggml-large-v3-q5_0.bin"),
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-q5_0.bin",
    sha256: "d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1",
    bytes: 1081140203,
    name: "The most accurate model",
  },
  // Oriserve/Whisper-Hindi2Hinglish-Apex (Apache 2.0) for whisper.cpp,
  // 8-bit, which its converter found identical to the full model.
  hinglish: {
    file: path.join(MODELS, "ggml-apex-hinglish-q8_0.bin"),
    url: "https://huggingface.co/Marquestra/Whisper-Hindi2Hinglish-Apex-GGML/resolve/main/ggml-apex-hinglish-q8_0.bin",
    sha256: "bef6d9d571e9e7bd3cd2ebba8b2d5c9cc4731e210d6750ae6a9c621a87e60d4c",
    bytes: 874188075,
    name: "The Hinglish model",
  },
};
const HINGLISH = EXTRA.hinglish;
const BEST = EXTRA.best;

// For Hindi, a line in the style wanted, which also spells the studio's
// names: a line of Hinglish keeps English words in English letters
// (measured: 10% word errors on Hinglish against 38% without it). English
// gets the names right from FIXES below.
// For English, only where every stretch was checked to be English: with
// Hindi in the same audio, it made whisper translate or skip the Hindi.
const HINT_EN = "Notes for an Aerchain film about SpendOS, Aiera and procurement.";
const HINT_MIXED = "Aerchain का logo थोड़ा बड़ा करो, और SpendOS का title fade in करो।";
const HINT_HINDI = "इस फ़िल्म में Aerchain का शीर्षक धीरे धीरे बड़ा करो।";
const HINT_ROMAN = "Aerchain ka logo thoda bada karo, aur SpendOS ka title fade in karo.";

// How whisper tends to mishear the studio's names.
const FIXES: [RegExp, string][] = [
  [/\b(?:air ?chain|aer ?chain|air ?cane|aer ?cane|air ?kane|air can|aircain|aercain|aerkane|ercane|ercain|airchane|aircaine)\b/gi, "Aerchain"],
  [/(?:एयरचेन|एरचेन|एरकेन|एयरकेन)/g, "Aerchain"],
  [/\bspend ?o\.? ?s(?=\W|$)/gi, "SpendOS"],
  [/(?:स्पेंड ?ओएस|स्पेंडओएस)/g, "SpendOS"],
];

// Marks whisper writes for sounds rather than words.
const NOT_WORDS = /\[[^\]]*\]|\((?:music|applause|laughs?|silence|inaudible|noise|blank_audio)[^)]*\)|♪+|\*[^*]*\*/gi;

class DictationError extends Error {
  constructor(
    message: string,
    readonly code: DictationErrorCode,
  ) {
    super(message);
  }
}
export { DictationError };

type Server = { child: ChildProcess; port: number; secret: string; model: string; ready: Promise<void>; idle?: ReturnType<typeof setTimeout> };
type State = {
  server: Server | null;
  lock: Promise<unknown>;
  setup: { running: boolean; step: string | null; error: string | null };
  extras: Record<ExtraModel, { percent: number | null; error: string | null; abort: AbortController | null }>;
  working: Set<string>;
  tidied: boolean;
};
const g = globalThis as { __dictation?: State };
const state = (g.__dictation ??= {
  server: null,
  lock: Promise.resolve(),
  setup: { running: false, step: null, error: null },
  extras: { best: { percent: null, error: null, abort: null }, hinglish: { percent: null, error: null, abort: null } },
  working: new Set(),
  tidied: false,
});

// ─── Status ──────────────────────────────────────────────────────────────────

const installed = () => existsSync(path.join(BIN, "whisper-cli")) && existsSync(STANDARD);

export async function status(): Promise<DictationStatus> {
  return {
    ready: installed() && !state.setup.running,
    setup: { running: state.setup.running, step: state.setup.step, error: state.setup.error },
    models: {
      best: { installed: existsSync(BEST.file), percent: state.extras.best.percent, error: state.extras.best.error },
      hinglish: { installed: existsSync(HINGLISH.file), percent: state.extras.hinglish.percent, error: state.extras.hinglish.error },
    },
    leftovers: await leftovers(),
  };
}

// ─── Setting up ──────────────────────────────────────────────────────────────

// Builds whisper.cpp and gets the standard model, the same way captions do
// (transcribe.mjs), then makes sure the server can find its libraries and
// fetches the voice detector.
export function startSetup() {
  if (state.setup.running) return;
  state.setup = { running: true, step: "Setting up listening on this Mac", error: null };
  const child = spawn(process.execPath, ["scripts/studio/transcribe.mjs", "--setup"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  let rest = "";
  let err = "";
  child.stdout.on("data", (chunk) => {
    const lines = (rest + chunk).split(/\r?\n/);
    rest = lines.pop() ?? "";
    for (const line of lines) if (line.startsWith("step ")) state.setup.step = line.slice(5);
  });
  child.stderr.on("data", (chunk) => (err = (err + chunk).slice(-4000)));
  const done = (error: string | null) => {
    state.setup = { running: false, step: null, error };
  };
  child.on("error", () => done("Setting up listening couldn't start. Try again in a moment."));
  child.on("close", (code) => {
    if (code !== 0) {
      console.error(`[studio dictation] setup: ${err}`);
      const said = err.trim().split("\n").at(-1) ?? "";
      return done(said.startsWith("! ") ? said.slice(2) : "Setting up listening failed. Try again in a moment.");
    }
    void Promise.all([ownLibraries("whisper-server"), ownLibraries("whisper-cli"), ownLibraries("whisper-vad-speech-segments"), fetchSmall(VAD), fetchSmall(LANGUAGE_ID)]).finally(() =>
      done(null),
    );
  });
}

const quiet = (cmd: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${code}`))));
  });

// The whisper build remembers the folder it was built in as where its
// libraries are, so moving the project broke it (transcribe.mjs fixes
// whisper-cli the same way). Point a program at its own folder, once, and
// re-sign it so macOS still runs it.
async function ownLibraries(name: string) {
  if (process.platform !== "darwin") return;
  const bin = path.join(BIN, name);
  if (!existsSync(bin)) return;
  const loads = await quiet("otool", ["-l", bin]).catch(() => "");
  if (loads.includes("@executable_path")) return;
  try {
    await quiet("install_name_tool", ["-add_rpath", "@executable_path", bin]);
    await quiet("codesign", ["--force", "-s", "-", bin]);
  } catch (error) {
    console.error(`[studio dictation] couldn't fix ${name}'s library path`, error);
  }
}

// Downloads a file to `to`, checking its SHA-256 before it's put in place.
async function download(url: string, to: string, sha256: string, onBytes?: (bytes: number) => void, signal?: AbortSignal) {
  await mkdir(path.dirname(to), { recursive: true });
  const part = `${to}.${randomBytes(4).toString("hex")}.part`;
  try {
    const res = await fetch(url, { signal, redirect: "follow" });
    if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
    const hash = createHash("sha256");
    let bytes = 0;
    const count = new Transform({
      transform(chunk: Buffer, _enc, next) {
        hash.update(chunk);
        bytes += chunk.length;
        onBytes?.(bytes);
        next(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), count, createWriteStream(part), { signal });
    if (hash.digest("hex") !== sha256) throw new Error("checksum");
    await rename(part, to);
  } finally {
    await rm(part, { force: true });
  }
}

// The voice detector (under 1 MB) and the language checker (60 MB) are
// fetched without asking. Without them listening still works: silence is
// more likely to come back as stray words, and a switch of language
// mid-recording is caught by the slower checks in writeDown.
const getting = new Map<string, Promise<void>>();
function fetchSmall(m: { file: string; url: string; sha256: string }) {
  if (existsSync(m.file)) return Promise.resolve();
  let job = getting.get(m.file);
  if (!job) {
    job = download(m.url, m.file, m.sha256)
      .catch((error) => console.error(`[studio dictation] ${path.basename(m.file)} download failed`, error))
      .finally(() => getting.delete(m.file));
    getting.set(m.file, job);
  }
  return job;
}
// The voice detector is waited for; the language checker comes in the
// background, so a slow connection never holds up writing something down.
const voiceDetector = () => {
  void fetchSmall(LANGUAGE_ID);
  return fetchSmall(VAD);
};

// An optional model, only when asked for in the mic's menu.
export function startExtra(which: ExtraModel) {
  const m = EXTRA[which];
  if (state.extras[which].abort || existsSync(m.file)) return;
  const abort = new AbortController();
  state.extras[which] = { percent: 0, error: null, abort };
  download(m.url, m.file, m.sha256, (bytes) => (state.extras[which].percent = Math.floor((100 * bytes) / m.bytes)), abort.signal)
    .then(() => {
      state.extras[which] = { percent: null, error: null, abort: null };
    })
    .catch((error: unknown) => {
      const stopped = abort.signal.aborted;
      if (!stopped) console.error(`[studio dictation] ${which} model download failed`, error);
      state.extras[which] = {
        percent: null,
        abort: null,
        error: stopped
          ? null
          : error instanceof Error && error.message === "checksum"
            ? `${m.name} didn't download correctly. Try again.`
            : `${m.name} couldn't be downloaded. Check the internet connection and try again.`,
      };
    });
}

export function stopExtra(which: ExtraModel) {
  state.extras[which].abort?.abort();
}

export async function removeExtra(which: ExtraModel) {
  stopExtra(which);
  if (state.server?.model === EXTRA[which].file) stopServer();
  await rm(EXTRA[which].file, { force: true });
}

// ─── The server that keeps the model loaded ──────────────────────────────────

const PID_FILE = path.join(HOME, "dictation-server.pid");
const IDLE_MS = 15 * 60 * 1000;

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

// A server left running by a studio that was closed abruptly.
async function stopStray() {
  const pid = Number((await readFile(PID_FILE, "utf8").catch(() => "")).trim());
  if (!Number.isInteger(pid) || pid <= 1 || pid === state.server?.child.pid) return;
  const command = await quiet("ps", ["-p", String(pid), "-o", "command="]).catch(() => "");
  if (command.includes(path.join(BIN, "whisper-server"))) {
    try {
      process.kill(pid);
    } catch {}
  }
  await rm(PID_FILE, { force: true });
}

function stopServer() {
  const s = state.server;
  if (!s) return;
  state.server = null;
  clearTimeout(s.idle);
  s.child.kill();
  void rm(PID_FILE, { force: true });
}

let exitHooked = false;
async function server(model: string): Promise<Server> {
  const now = state.server;
  if (now && now.model === model && now.child.exitCode === null && !now.child.killed) {
    await now.ready;
    return now;
  }
  stopServer();
  await stopStray();
  await ownLibraries("whisper-server");
  await voiceDetector();
  const port = await freePort();
  const secret = randomBytes(12).toString("hex");
  const args = ["--host", "127.0.0.1", "--port", String(port), "--request-path", `/${secret}`, "-m", model, "-t", String(threads()), "-nt"];
  if (existsSync(VAD.file)) args.push("--vad", "-vm", VAD.file);
  const child = spawn(path.join(BIN, "whisper-server"), args, { cwd: HOME, stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  child.stderr?.on("data", (c) => (err = (err + c).slice(-3000)));
  const s: Server = { child, port, secret, model, ready: Promise.resolve() };
  s.ready = new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      if (error) reject(error);
      else resolve();
    };
    child.once("error", (e) => finish(e));
    child.once("exit", (code) => {
      if (state.server === s) state.server = null;
      finish(new Error(`whisper-server exited (${code}): ${err.slice(-600)}`));
    });
    const started = Date.now();
    // Loading the model takes a second or two; the first time Metal also
    // compiles its shaders.
    const poll = setInterval(() => {
      if (Date.now() - started > 120_000) {
        child.kill();
        return finish(new Error("whisper-server took too long to start"));
      }
      fetch(`http://127.0.0.1:${port}/${secret}/health`, { signal: AbortSignal.timeout(1000) })
        .then((r) => r.ok && finish())
        .catch(() => {});
    }, 250);
  });
  state.server = s;
  if (child.pid) void writeFile(PID_FILE, String(child.pid)).catch(() => {});
  if (!exitHooked) {
    exitHooked = true;
    process.once("exit", () => state.server?.child.kill());
  }
  try {
    await s.ready;
  } catch (error) {
    if (state.server === s) state.server = null;
    throw error;
  }
  return s;
}

const threads = () => Math.max(2, Math.min(8, os.availableParallelism() - 2));

function keepAwhile(s: Server) {
  clearTimeout(s.idle);
  s.idle = setTimeout(() => {
    if (state.server === s) stopServer();
  }, IDLE_MS);
  s.idle.unref?.();
}

// ─── Writing a piece down ────────────────────────────────────────────────────

type Ask = { language: DictationLanguage; script: HindiScript; accuracy: Accuracy; context: string };
type Plan = { model: string; language: string; prompt: string };

// Languages a Hindi speaker can be mistaken for; their pieces are written
// as Hindi (Urdu would otherwise come out in Urdu script).
const HINDI_LIKE = new Set(["hi", "ur", "mr", "ne", "pa"]);
const CODES: Record<string, string> = { english: "en", hindi: "hi", urdu: "ur", marathi: "mr", nepali: "ne", punjabi: "pa" };
const codeOf = (language: string | null | undefined) => (language ? (CODES[language.toLowerCase()] ?? language.toLowerCase()) : null);

const best = (ask: Ask) => ask.accuracy === "best" && existsSync(BEST.file);
// Roman letters on Fast use the Hinglish model when it's here (4.6% word
// errors against 14% for spelling out the standard model's Devanagari). On
// Most accurate, large-v3 spelled out measured better still (1.9%).
const romanModel = (ask: Ask) => ask.script === "roman" && ask.language !== "en" && !best(ask) && existsSync(HINGLISH.file);

// Which model, language and hint a piece is written down with.
//  English   English.
//  Detect    the language of each stretch is found first (writeDown);
//            English parts are written as English, Hindi ones as Hinglish.
//  Hindi     Hindi, with English words written as they sound.
//  Hinglish  the same as Detect, leaning to Hindi where the language
//            checker isn't available: a part is written as English only
//            when whisper is sure it's English.
// The Hinglish model (romanModel) finds the language itself.
// `checked`: the language checker found this audio all in one language.
function plan(ask: Ask, language: DictationLanguage = ask.language, checked = false): Plan {
  const roman = romanModel(ask);
  const model = roman ? HINGLISH.file : best(ask) ? BEST.file : STANDARD;
  const code = language === "en" ? "en" : language === "auto" || (roman && language === "hinglish") ? "auto" : "hi";
  // A hint for Hindi, where it keeps English words in English letters, and
  // for English only once checked (HINT_EN). Not the words said before
  // either, which pulled the next piece into their language the same way.
  // The Hinglish model always gets its own line: without it, it dropped the
  // first word of a recording ("Cut the..." came back as "The...").
  const hint = roman
    ? HINT_ROMAN
    : language === "en"
      ? checked
        ? HINT_EN
        : ""
      : language === "auto"
        ? ""
        : language === "hi"
          ? HINT_HINDI
          : HINT_MIXED;
  return { model, language: code, prompt: process.env.STUDIO_DICTATION_HINTS === "off" ? "" : hint };
}

// Whisper forced into the wrong language can get stuck saying the same
// few words over and over.
function stuck(text: string) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  for (let n = 1; n <= 4; n++) {
    let repeats = 1;
    for (let i = n; i + n <= words.length; i += n) {
      const same = words.slice(i, i + n).join(" ") === words.slice(i - n, i).join(" ");
      repeats = same ? repeats + 1 : 1;
      if (repeats >= 4) return true;
    }
  }
  return false;
}

const DECODE = { beam_size: "5", best_of: "5", temperature: "0.0", temperature_inc: "0.2", no_speech_thold: "0.6", suppress_nst: "true" };

// A stretch of what was said, in seconds of the piece.
type Segment = { start: number; end: number; text: string };
type Heard = { text: string; language: string | null; sure: number | null; segments: Segment[] | null };

async function viaServer(wav: string, p: Plan, detect = false): Promise<Heard> {
  const s = await server(p.model);
  keepAwhile(s);
  const form = new FormData();
  form.set("file", new Blob([await readFile(wav)], { type: "audio/wav" }), "piece.wav");
  const fields: Record<string, string> = {
    ...DECODE,
    language: p.language,
    prompt: p.prompt,
    response_format: "verbose_json",
    // Only the language check needs how sure whisper is.
    no_language_probabilities: detect ? "false" : "true",
    // With timestamps whisper keeps going to the end of the piece; without,
    // it can stop after the first sentence and drop the rest (measured: the
    // Hindi half of an English-then-Hindi recording vanished).
    no_timestamps: "false",
    // whisper-server otherwise wraps lines at 60 letters, mid-word.
    max_len: "100000",
    split_on_word: "true",
    vad: existsSync(VAD.file) ? "true" : "false",
    detect_language: detect ? "true" : "false",
  };
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const res = await fetch(`http://127.0.0.1:${s.port}/${s.secret}/inference`, { method: "POST", body: form, signal: AbortSignal.timeout(600_000) });
  if (!res.ok) throw new Error(`whisper-server ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as {
    text?: string;
    language?: string;
    detected_language_probability?: number;
    segments?: { start?: number; end?: number; text?: string }[];
    error?: string;
  };
  if (body.error) throw new Error(`whisper-server: ${body.error}`);
  const segments = (body.segments ?? [])
    .filter((x) => typeof x.start === "number" && typeof x.end === "number")
    .map((x) => ({ start: x.start as number, end: x.end as number, text: x.text ?? "" }));
  return {
    text: detect ? "" : (body.text ?? ""),
    language: codeOf(body.language),
    sure: body.detected_language_probability ?? null,
    segments: detect ? [] : body.segments ? segments : null,
  };
}

// The same, one program run per piece: slower (the model loads each time)
// but independent of the server.
const stamp = (t: string) => {
  const [h, m, sec] = t.split(":").map(Number);
  return h * 3600 + m * 60 + sec;
};

function viaCli(wav: string, p: Plan, detect = false) {
  return new Promise<Heard>((resolve, reject) => {
    const args = ["-m", p.model, "-l", p.language, "-t", String(threads()), "-bs", DECODE.beam_size, "-bo", DECODE.best_of, "-sns"];
    if (p.prompt) args.push("--prompt", p.prompt);
    if (detect) args.push("-dl");
    if (existsSync(VAD.file)) args.push("--vad", "-vm", VAD.file);
    args.push("-f", wav);
    const child = spawn(path.join(BIN, "whisper-cli"), args, { cwd: HOME, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err = (err + c).slice(-6000)));
    const timer = setTimeout(() => child.kill(), 900_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`whisper-cli ${code}: ${err.slice(-600)}`));
      const found = /auto-detected language: (\w+) \(p = ([\d.]+)\)/.exec(err);
      // Lines read "[00:00:01.200 --> 00:00:03.400]  words".
      const segments: Segment[] = [];
      for (const line of out.split("\n")) {
        const m = /^\[(\d+:\d+:[\d.]+) --> (\d+:\d+:[\d.]+)\]\s*(.*)$/.exec(line.trim());
        if (m) segments.push({ start: stamp(m[1]), end: stamp(m[2]), text: m[3] });
      }
      resolve({
        text: detect ? "" : segments.map((x) => x.text).join(" ") || out,
        language: found?.[1] ?? (p.language === "auto" ? null : p.language),
        sure: found ? Number(found[2]) : null,
        segments: detect ? [] : segments,
      });
    });
  });
}

function tidy(text: string, script: HindiScript, language: DictationLanguage) {
  let t = text.replace(NOT_WORDS, " ").replace(/\s+/g, " ").trim();
  for (const [from, to] of FIXES) t = t.replace(from, to);
  // The Hinglish model sometimes runs sentences together: "flips.The".
  t = t.replace(/([a-z][.!?])(?=[A-Z][a-z])/g, "$1 ");
  if (script === "roman" && language !== "en" && hasDevanagari(t)) t = toRoman(t);
  // A piece starts as a sentence does (the page lowercases it again when it
  // carries on a sentence already in the box).
  t = t.replace(/^[a-z]/, (c) => c.toUpperCase());
  // A recording that is only punctuation said nothing.
  return /[\p{L}\p{N}]/u.test(t) ? t : "";
}

// Turns any sound into what whisper reads: 16 kHz mono 16-bit WAV, at most
// fifteen minutes of it (the longest recording).
function toWav(from: string, to: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", from, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-t", "900", "-f", "wav", to],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let err = "";
    child.stderr.on("data", (c) => (err = (err + c).slice(-1000)));
    child.on("error", (e) => reject(new DictationError((e as NodeJS.ErrnoException).code === "ENOENT" ? "The studio needs ffmpeg to listen. Install it with: brew install ffmpeg" : "The recording couldn't be read.", "audio")));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new DictationError(`The recording couldn't be read. ${err.trim().split("\n").at(-1) ?? ""}`.trim(), "audio"))));
  });
}

// One piece at a time across the studio: the model uses the whole GPU.
function oneAtATime<T>(job: () => Promise<T>): Promise<T> {
  const run = state.lock.catch(() => {}).then(job);
  state.lock = run.catch(() => {});
  return run;
}

// Where the voice detector hears speech, in seconds of the piece, with
// pauses under 0.3 s joined. Null if it can't tell.
async function speechIn(wav: string): Promise<{ start: number; end: number }[] | null> {
  if (!existsSync(VAD.file)) return null;
  await ownLibraries("whisper-vad-speech-segments");
  const out = await quiet(path.join(BIN, "whisper-vad-speech-segments"), ["-vm", VAD.file, "-f", wav, "-t", "4", "-np"]).catch(() => null);
  if (out === null) return null;
  const regions: { start: number; end: number }[] = [];
  // "Speech segment 0: start = 243.00, end = 493.00" (hundredths of a second)
  for (const m of out.matchAll(/start = ([\d.]+), end = ([\d.]+)/g)) {
    const start = Number(m[1]) / 100;
    const end = Number(m[2]) / 100;
    const last = regions.at(-1);
    if (last && start - last.end < 0.3) last.end = end;
    else regions.push({ start, end });
  }
  return regions;
}

// Cuts start to end out of a 16 kHz WAV, with a little air either side.
function cut(wav: string, start: number, end: number, to: string) {
  const from = Math.max(0, start - 0.15);
  return quiet("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-ss", from.toFixed(3), "-t", (end + 0.15 - from).toFixed(3), "-i", wav, "-c:a", "pcm_s16le", "-f", "wav", to]);
}

// The language of each stretch, with the base model: one run for them all,
// so the model loads once. Null if it can't tell.
async function languagesOf(wav: string, stretches: { start: number; end: number }[], parts: string[]) {
  if (!existsSync(LANGUAGE_ID.file) || !stretches.length) return null;
  try {
    const files = stretches.map(() => path.join(TMP, `dictation-${randomBytes(6).toString("hex")}.wav`));
    parts.push(...files);
    await Promise.all(stretches.map((r, i) => cut(wav, r.start, r.end, files[i])));
    const out = await new Promise<string>((resolve, reject) => {
      const child = spawn(path.join(BIN, "whisper-cli"), ["-m", LANGUAGE_ID.file, "-l", "auto", "-dl", "-t", "4", ...files.flatMap((f) => ["-f", f])], {
        cwd: HOME,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let text = "";
      child.stdout.on("data", (c) => (text += c));
      child.stderr.on("data", (c) => (text += c));
      const timer = setTimeout(() => child.kill(), 60_000);
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(text);
        else reject(new Error(`language check ${code}`));
      });
    });
    const found = [...out.matchAll(/auto-detected language: (\w+) \(p = ([\d.]+)\)/g)].map((m) => ({ language: m[1], sure: Number(m[2]) }));
    return found.length === stretches.length ? found : null;
  } catch (error) {
    console.error("[studio dictation] language check failed", error);
    return null;
  }
}

const covered = (r: { start: number; end: number }, segments: Segment[]) => {
  let sum = 0;
  for (const x of segments) sum += Math.max(0, Math.min(r.end, x.end) - Math.max(r.start, x.start));
  return sum / Math.max(0.01, r.end - r.start);
};
// Words in a line, counting a Devanagari or Roman word alike.
const wordCount = (t: string) => t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const MIN_WORDS_PER_SECOND = 1.9;
// A line said twice over (whisper in the wrong language repeats itself) is
// kept once.
function dedupe(segments: Segment[]) {
  const seen = new Set<string>();
  return segments.filter((x) => {
    const k = key(x.text);
    if (!k || (k.length > 8 && seen.has(k))) return false;
    seen.add(k);
    return true;
  });
}
const key = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

async function writeDown(file: string, ask: Ask): Promise<PieceResult> {
  if (!installed()) throw new DictationError("Listening isn't set up on this Mac yet.", "setup");
  await mkdir(TMP, { recursive: true });
  const wav = path.join(TMP, `dictation-${randomBytes(6).toString("hex")}.wav`);
  const parts: string[] = [];
  try {
    await toWav(file, wav);
    const listen = (audio: string, q: Plan, detect = false) =>
      oneAtATime(async () => {
        try {
          return await viaServer(audio, q, detect);
        } catch (error) {
          console.error("[studio dictation] server failed, using whisper-cli", error);
          stopServer();
          await ownLibraries("whisper-cli");
          try {
            return await viaCli(audio, q, detect);
          } catch (again) {
            console.error("[studio dictation] whisper-cli failed", again);
            throw new DictationError("Writing this down failed. Your recording is kept, so you can try again.", "failed");
          }
        }
      });
    // Which language, and so how to write it down (plan()).
    const choose = async (audio: string, asked: DictationLanguage): Promise<DictationLanguage> => {
      if ((asked !== "auto" && asked !== "hinglish") || romanModel(ask)) return asked;
      const found = await listen(audio, plan(ask, "auto"), true);
      if (found.language === "en" && (asked === "auto" || (found.sure ?? 1) >= 0.85)) return "en";
      if (asked === "hinglish" || (found.language && HINDI_LIKE.has(found.language))) return "hinglish";
      return "auto";
    };
    // `known`: the language was already found, so no second check.
    const hear = async (audio: string, asked: DictationLanguage, known = false) => {
      const p = plan(ask, known ? asked : await choose(audio, asked), known);
      let said = await listen(audio, p);
      // Stuck in a loop: the language was probably wrong, so let whisper
      // choose.
      if (stuck(said.text) && p.language !== "auto") said = await listen(audio, { ...p, language: "auto" });
      return { said, p };
    };

    const speech = await speechIn(wav);
    // The voice detector heard no speech at all: nothing to write.
    if (speech && !speech.length) return { text: "", language: null };
    const alone = async (r: { start: number; end: number }, asked: DictationLanguage, known = false) => {
      const part = path.join(TMP, `dictation-${randomBytes(6).toString("hex")}.wav`);
      parts.push(part);
      await cut(wav, r.start, r.end, part);
      const once = (await hear(part, asked, known)).said.text.trim();
      if (once && !stuck(once)) return once;
      // Nothing back from real speech: once more, whisper choosing the
      // language, so a part is never lost quietly.
      if (r.end - r.start < 0.6 || asked === "auto") return "";
      const twice = (await hear(part, "auto", true)).said.text.trim();
      return twice && !stuck(twice) ? twice : "";
    };
    const done = (segments: Segment[], language: string | null) => {
      segments.sort((a, b) => a.start - b.start);
      return { text: tidy(segments.map((x) => x.text.trim()).join(" "), ask.script, ask.language), language };
    };

    // Detect and Hinglish, with the standard or most accurate model: the
    // language of every stretch of speech first, so a recording that
    // switches between English and Hindi has each part written in its own
    // language. (Set to one language, whisper drops or translates the
    // other: an English start lost the Hindi after it.)
    if (speech && (ask.language === "auto" || ask.language === "hinglish") && !romanModel(ask)) {
      const stretches = speech.slice(0, 32);
      const found = await oneAtATime(() => languagesOf(wav, stretches, parts));
      if (found) {
        const lang = found.map((f): DictationLanguage => (f.language === "en" ? "en" : HINDI_LIKE.has(f.language) ? "hinglish" : "auto"));
        // A stretch in neither (a cough, a name) goes with the one before.
        for (let i = 0; i < lang.length; i++) if (lang[i] === "auto") lang[i] = lang[i - 1] ?? lang.find((l) => l !== "auto") ?? "auto";
        const runs: { language: DictationLanguage; start: number; end: number }[] = [];
        stretches.forEach((r, i) => {
          const last = runs.at(-1);
          if (last && last.language === lang[i]) last.end = r.end;
          else runs.push({ language: lang[i], start: r.start, end: r.end });
        });
        // Anything past the 32nd stretch joins the last run.
        if (speech.length > stretches.length) runs[runs.length - 1].end = speech[speech.length - 1].end;
        if (runs.length === 1) {
          const p = plan(ask, runs[0].language, true);
          let said = await listen(wav, p);
          if (stuck(said.text) && p.language !== "auto") said = await listen(wav, { ...p, language: "auto" });
          const segments = said.segments ?? [{ start: 0, end: 0, text: said.text }];
          return done(dedupe(segments), said.language ?? p.language);
        }
        const segments: Segment[] = [];
        for (const run of runs) {
          const text = await alone(run, run.language, true);
          if (text) segments.push({ start: run.start, end: run.end, text });
        }
        return done(segments, runs.some((r) => r.language === "hinglish") ? "hi" : "en");
      }
    }

    // Otherwise (English or Hindi chosen, the Hinglish model, or the
    // language check unavailable): one pass, then make sure nothing was
    // dropped.
    const { said, p } = await hear(wav, ask.language);
    if (!said.segments) return { text: tidy(said.text, ask.script, ask.language), language: said.language ?? (p.language === "auto" ? null : p.language) };
    let segments = dedupe(said.segments);
    const seen = new Set(segments.map((x) => key(x.text)));
    const other: DictationLanguage = ask.language === "en" || ask.language === "hi" ? "auto" : ask.language;
    if (speech) {
      // Too few words for the speech heard (people say 2 to 3 a second; a
      // dropped half leaves about 1.5): a language was skipped inside a
      // line. Then every stretch is written down on its own.
      const heard = speech.reduce((sum, r) => sum + r.end - r.start, 0);
      const words = segments.reduce((sum, x) => sum + wordCount(x.text), 0);
      if (speech.length > 1 && heard >= 2 && words / heard < MIN_WORDS_PER_SECOND) {
        const each: Segment[] = [];
        for (const r of speech.slice(0, 16)) {
          const text = r.end - r.start >= 0.3 ? await alone(r, other) : "";
          if (text) each.push({ start: r.start, end: r.end, text });
        }
        // Kept only if it found more.
        if (each.reduce((sum, x) => sum + wordCount(x.text), 0) > words) segments = each;
      } else {
        // A stretch no line covers is written down on its own and put back
        // in its place.
        for (const r of speech.filter((x) => x.end - x.start >= 0.6 && covered(x, segments) < 0.4).slice(0, 12)) {
          const text = await alone(r, other);
          if (text && !seen.has(key(text))) segments.push({ start: r.start, end: r.end, text });
        }
      }
    }
    return done(segments, said.language ?? (p.language === "auto" ? null : p.language));
  } finally {
    await Promise.all([wav, ...parts].map((f) => rm(f, { force: true })));
  }
}

// ─── Kept recordings ─────────────────────────────────────────────────────────

type Meta = { language: DictationLanguage; script: HindiScript; accuracy: Accuracy; made: number; seconds: Record<string, number> };
const dirOf = (id: string) => path.join(KEEP, id);
const metaFile = (id: string) => path.join(dirOf(id), "recording.json");

async function readMeta(id: string): Promise<Meta | null> {
  try {
    return JSON.parse(await readFile(metaFile(id), "utf8")) as Meta;
  } catch {
    return null;
  }
}

async function writeMeta(id: string, meta: Meta) {
  const tmp = `${metaFile(id)}.${randomBytes(3).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(meta));
  await rename(tmp, metaFile(id));
}

const pieceNames = async (id: string) =>
  (await readdir(dirOf(id)).catch(() => [] as string[]))
    .filter((f) => /^\d{1,4}\.(?:wav|webm|mp4)$/.test(f))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));

// Recordings that weren't written down (the studio stopped, or whisper
// failed), oldest first. Week-old ones are cleared away.
async function leftovers(): Promise<DictationStatus["leftovers"]> {
  const ids = await readdir(KEEP).catch(() => [] as string[]);
  const out: DictationStatus["leftovers"] = [];
  for (const id of ids) {
    if (!/^[a-z0-9]{16}$/.test(id) || state.working.has(id)) continue;
    const meta = await readMeta(id);
    const pieces = await pieceNames(id);
    const made = meta?.made ?? (await stat(dirOf(id)).catch(() => null))?.mtimeMs ?? 0;
    if (!pieces.length || Date.now() - made > 7 * 24 * 3600 * 1000) {
      if (!state.tidied) await rm(dirOf(id), { recursive: true, force: true });
      continue;
    }
    const seconds = pieces.reduce((sum, f) => sum + (meta?.seconds[f] ?? 0), 0);
    out.push({ id, pieces: pieces.length, seconds: Math.round(seconds), made });
  }
  state.tidied = true;
  return out.sort((a, b) => a.made - b.made);
}

// Saves a piece of a recording as it arrives (capped), then writes it
// down. The piece is deleted once written down; on any failure it stays.
export async function takePiece(
  id: string,
  n: number,
  kind: "wav" | "webm" | "mp4",
  body: ReadableStream<Uint8Array>,
  ask: Ask,
  keepOnly = false,
): Promise<PieceResult> {
  await mkdir(dirOf(id), { recursive: true });
  const name = `${n}.${kind}`;
  const file = path.join(dirOf(id), name);
  let bytes = 0;
  const cap = new Transform({
    transform(chunk: Buffer, _enc, next) {
      bytes += chunk.length;
      if (bytes > MAX_PIECE_BYTES) next(new DictationError("That piece of the recording is too large.", "audio"));
      else next(null, chunk);
    },
  });
  // The first bytes must say it's the sound it claims to be.
  const looksRight = (h: Buffer) =>
    kind === "wav"
      ? h.toString("latin1", 0, 4) === "RIFF" && h.toString("latin1", 8, 12) === "WAVE"
      : kind === "webm"
        ? h.readUInt32BE(0) === 0x1a45dfa3
        : h.toString("latin1", 4, 8) === "ftyp";
  let head = Buffer.alloc(0);
  const check = new Transform({
    transform(chunk: Buffer, _enc, next) {
      if (head.length < 12) {
        head = Buffer.concat([head, chunk]).subarray(0, 12);
        if (head.length >= 12 && !looksRight(head)) return next(new DictationError("The recording didn't arrive as sound.", "audio"));
      }
      next(null, chunk);
    },
  });
  state.working.add(id);
  try {
    try {
      await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream), cap, check, createWriteStream(file));
    } catch (error) {
      await rm(file, { force: true });
      throw error instanceof DictationError ? error : new DictationError("The recording didn't arrive in full. Try again.", "audio");
    }
    const meta = (await readMeta(id)) ?? { language: ask.language, script: ask.script, accuracy: ask.accuracy, made: Date.now(), seconds: {} };
    // WAV's length follows from its size; the others are measured by ffmpeg later, so 0 here.
    meta.seconds[name] = kind === "wav" ? Math.max(0, (bytes - 44) / 32000) : 0;
    await writeMeta(id, meta);
    if (keepOnly) return { text: "", language: null };
    const result = await writeDown(file, ask);
    await forgetPiece(id, name);
    return result;
  } finally {
    state.working.delete(id);
  }
}

async function forgetPiece(id: string, name: string) {
  await rm(path.join(dirOf(id), name), { force: true });
  if (!(await pieceNames(id)).length) await rm(dirOf(id), { recursive: true, force: true });
}

// Writes down every piece of a kept recording, in order. Pieces written
// down are deleted as it goes; if one fails, what was written so far comes
// back with the error, and the rest stays kept.
export async function retryKept(id: string, ask: Partial<Ask>): Promise<PieceResult & { error: string | null }> {
  const pieces = await pieceNames(id);
  if (!pieces.length) throw new DictationError("That recording is gone.", "gone");
  const meta = await readMeta(id);
  const full: Ask = {
    language: ask.language ?? meta?.language ?? "auto",
    script: ask.script ?? meta?.script ?? "roman",
    accuracy: ask.accuracy ?? meta?.accuracy ?? "fast",
    context: ask.context ?? "",
  };
  state.working.add(id);
  const texts: string[] = [];
  let language: string | null = null;
  try {
    for (const name of pieces) {
      const said = await writeDown(path.join(dirOf(id), name), { ...full, context: [full.context, ...texts].join(" ") });
      if (said.text) texts.push(said.text);
      language ??= said.language;
      await forgetPiece(id, name);
    }
    return { text: texts.join(" "), language, error: null };
  } catch (error) {
    if (!texts.length) throw error;
    return { text: texts.join(" "), language, error: error instanceof DictationError ? error.message : "Part of the recording couldn't be written down." };
  } finally {
    state.working.delete(id);
  }
}

export async function discardKept(id: string) {
  await rm(dirOf(id), { recursive: true, force: true });
}
