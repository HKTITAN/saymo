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
//   Both with beam search (5), whisper's temperature fallback, the Silero
//   voice detector (cuts silence, so silence doesn't come back as "Thank
//   you."), a hint of the studio's own words, and the end of the previous
//   piece as context. Detect finds the language first, then writes the
//   piece the way that language needs.
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

// Words whisper wouldn't know, as a sentence in the way they're said. The
// hint also sets the style: a line of Hinglish keeps English words in
// English letters (measured: 10% word errors on Hinglish against 43% with
// an English hint, and no change on English).
const HINT_EN = "Notes for an Aerchain film about SpendOS, Aiera and procurement.";
const HINT_MIXED = "Aerchain का logo थोड़ा बड़ा करो, और SpendOS का title fade in करो।";
const HINT_HINDI = "इस फ़िल्म में Aerchain का शीर्षक धीरे धीरे बड़ा करो।";
const HINT_ROMAN = "Aerchain ka logo thoda bada karo, aur SpendOS ka title fade in karo.";

// How whisper tends to mishear the studio's names.
const FIXES: [RegExp, string][] = [
  [/\b(?:air ?chain|aer ?chain|air ?cane|aer ?cane|air ?kane|air can|aircain|aercain|aerkane|ercane|ercain|airchane|aircaine)\b/gi, "Aerchain"],
  [/(?:एयरचेन|एरचेन|एरकेन|एयरकेन)/g, "Aerchain"],
  [/\bspend ?o\.?s\.?(?=\W|$)/gi, "SpendOS"],
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
    void Promise.all([ownLibraries("whisper-server"), ownLibraries("whisper-cli"), voiceDetector()]).finally(() => done(null));
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

// The voice detector is under 1 MB, so it's fetched without asking. Without
// it, listening still works; silence is just more likely to come back as
// stray words.
let gettingVad: Promise<void> | null = null;
function voiceDetector() {
  if (existsSync(VAD.file)) return Promise.resolve();
  gettingVad ??= download(VAD.url, VAD.file, VAD.sha256)
    .catch((error) => console.error("[studio dictation] voice detector download failed", error))
    .finally(() => {
      gettingVad = null;
    });
  return gettingVad;
}

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
//  Detect    the language is found first (writeDown); English pieces are
//            then written as English, Hindi ones as Hinglish.
//  Hindi     Hindi, with English words written as they sound.
//  Hinglish  like Detect, but leaning to Hindi: a piece is written as
//            English only when whisper is sure it's English.
// The Hinglish model (romanModel) finds the language itself.
function plan(ask: Ask, language: DictationLanguage = ask.language): Plan {
  const roman = romanModel(ask);
  const model = roman ? HINGLISH.file : best(ask) ? BEST.file : STANDARD;
  const code = language === "en" ? "en" : language === "auto" || (roman && language === "hinglish") ? "auto" : "hi";
  const hint = language === "en" ? HINT_EN : roman ? HINT_ROMAN : language === "hi" ? HINT_HINDI : HINT_MIXED;
  // The end of the piece before, so a sentence cut in two reads on.
  const context = ask.context.trim().slice(-200);
  return { model, language: code, prompt: context ? `${hint} ${context}` : hint };
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

async function viaServer(wav: string, p: Plan, detect = false) {
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
    no_timestamps: "true",
    vad: existsSync(VAD.file) ? "true" : "false",
    detect_language: detect ? "true" : "false",
  };
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const res = await fetch(`http://127.0.0.1:${s.port}/${s.secret}/inference`, { method: "POST", body: form, signal: AbortSignal.timeout(600_000) });
  if (!res.ok) throw new Error(`whisper-server ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { text?: string; language?: string; detected_language_probability?: number; error?: string };
  if (body.error) throw new Error(`whisper-server: ${body.error}`);
  return { text: detect ? "" : (body.text ?? ""), language: codeOf(body.language), sure: body.detected_language_probability ?? null };
}

// The same, one program run per piece: slower (the model loads each time)
// but independent of the server.
function viaCli(wav: string, p: Plan, detect = false) {
  return new Promise<{ text: string; language: string | null; sure: number | null }>((resolve, reject) => {
    const args = ["-m", p.model, "-l", p.language, "-t", String(threads()), "-nt", "-bs", DECODE.beam_size, "-bo", DECODE.best_of, "-sns", "--prompt", p.prompt];
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
      resolve({ text: detect ? "" : out, language: found?.[1] ?? (p.language === "auto" ? null : p.language), sure: found ? Number(found[2]) : null });
    });
  });
}

function tidy(text: string, script: HindiScript, language: DictationLanguage) {
  let t = text.replace(NOT_WORDS, " ").replace(/\s+/g, " ").trim();
  for (const [from, to] of FIXES) t = t.replace(from, to);
  // The Hinglish model sometimes runs sentences together: "flips.The".
  t = t.replace(/([a-z][.!?])(?=[A-Z][a-z])/g, "$1 ");
  if (script === "roman" && language !== "en" && hasDevanagari(t)) t = toRoman(t);
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

async function writeDown(file: string, ask: Ask): Promise<PieceResult> {
  if (!installed()) throw new DictationError("Listening isn't set up on this Mac yet.", "setup");
  await mkdir(TMP, { recursive: true });
  const wav = path.join(TMP, `dictation-${randomBytes(6).toString("hex")}.wav`);
  try {
    await toWav(file, wav);
    const listen = (q: Plan, detect = false) =>
      oneAtATime(async () => {
        try {
          return await viaServer(wav, q, detect);
        } catch (error) {
          console.error("[studio dictation] server failed, using whisper-cli", error);
          stopServer();
          await ownLibraries("whisper-cli");
          try {
            return await viaCli(wav, q, detect);
          } catch (again) {
            console.error("[studio dictation] whisper-cli failed", again);
            throw new DictationError("Writing this down failed. Your recording is kept, so you can try again.", "failed");
          }
        }
      });
    let language = ask.language;
    // Detect and Hinglish: which language, first (about half a second), so
    // English pieces are written as English (whisper forced into Hindi on
    // English speech writes Hindi gibberish) and Hindi ones keep English
    // words in English letters.
    if ((language === "auto" || language === "hinglish") && !romanModel(ask)) {
      const found = await listen(plan(ask, "auto"), true);
      const english = found.language === "en" && (language === "auto" || (found.sure ?? 1) >= 0.85);
      if (english) language = "en";
      else if (language === "hinglish" || (found.language && HINDI_LIKE.has(found.language))) language = "hinglish";
    }
    const p = plan(ask, language);
    let said = await listen(p);
    // Stuck in a loop: the language was probably wrong, so let whisper
    // choose.
    if (stuck(said.text) && p.language !== "auto") said = await listen({ ...p, language: "auto" });
    return { text: tidy(said.text, ask.script, ask.language), language: said.language ?? (p.language === "auto" ? null : p.language) };
  } finally {
    await rm(wav, { force: true });
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
