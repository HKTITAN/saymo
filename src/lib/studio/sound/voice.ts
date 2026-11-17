import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import type { Media } from "../films/edit";
import { importMedia, MediaError } from "../films/media";
import { ROOT } from "../films/films";
import { IS_WINDOWS } from "../server/platform";

// Voiceovers: words typed (or written by Claude) read aloud by one of the
// computer's own voices, offline (the Mac's, or each one's twin among
// Windows' voices), and brought into the film like any sound file,
// so they can be placed, trimmed, captioned and mixed. Indian voices come
// first and Rishi is the default; the rest are there for other markets.

export type Voice = { id: string; label: string; accent: string; language: string; windows: string };

// The order shown in the studio.
export const VOICES: Voice[] = [
  { id: "Rishi", label: "Rishi", accent: "Indian English, male", language: "en_IN", windows: "Microsoft Ravi" },
  { id: "Tara", label: "Tara", accent: "Indian English, female", language: "en_IN", windows: "Microsoft Heera" },
  // Windows has one Indian English man's voice (Ravi, Rishi's twin); its
  // other Indian man's voice, Hemant, reads Hindi, so Aman has no twin there.
  { id: "Aman", label: "Aman", accent: "Indian English, male", language: "en_IN", windows: "" },
  { id: "Lekha", label: "Lekha", accent: "Hindi, female", language: "hi_IN", windows: "Microsoft Kalpana" },
];
export const DEFAULT_VOICE = "Rishi";

// Words per minute: the voices' own pace is about 175.
export const RATE = { min: 120, max: 240, normal: 175 };

const run = (cmd: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr.on("data", (d) => {
      err += String(d);
    });
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `${cmd} failed`))));
  });

// Windows' twin of `say` (scripts/native/speak.ps1).
const SPEAK = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "scripts/native/speak.ps1")];

// Where to add a voice that's missing.
export const ADD_VOICE = IS_WINDOWS
  ? "Add it in Settings, Time & language, Speech, Add voices (English (India) for Rishi and Tara, Hindi for Lekha). Aman has no Windows voice yet; pick Rishi instead."
  : "Add it in System Settings, Accessibility, Spoken Content.";

// Which of VOICES this computer has installed (a fresh one may lack some),
// by their studio names.
let installed: Promise<Set<string>> | null = null;
export function installedVoices(): Promise<Set<string>> {
  installed ??= new Promise((resolve) => {
    // eslint-disable-next-line no-restricted-syntax -- Mac's say; Windows: speak.ps1
    const proc = IS_WINDOWS ? spawn("powershell.exe", [...SPEAK, "-List"], { windowsHide: true }) : spawn("say", ["-v", "?"]);
    let out = "";
    proc.stdout.on("data", (d) => {
      out += String(d);
    });
    proc.on("error", () => resolve(new Set()));
    proc.on("close", () => {
      if (!IS_WINDOWS) return resolve(new Set(out.split("\n").map((l) => l.split(/\s{2,}/)[0]?.trim()).filter(Boolean)));
      const there = new Set(out.split(/\r?\n/).map((l) => l.split("|")[0].trim()));
      resolve(new Set(VOICES.filter((v) => v.windows && there.has(v.windows)).map((v) => v.id)));
    });
  });
  return installed;
}

export async function makeVoiceover(
  id: string,
  { text, voice = DEFAULT_VOICE, rate = RATE.normal, name }: { text: string; voice?: string; rate?: number; name?: string },
): Promise<Media> {
  const words = text.replace(/\s+/g, " ").trim();
  if (!words) throw new MediaError("Type the words to be read out.");
  if (words.length > 5000) throw new MediaError("That's too long for one voiceover. Split it into parts.");
  if (!VOICES.some((v) => v.id === voice)) throw new MediaError(`There's no voice called ${voice}.`);
  if (!(await installedVoices()).has(voice)) {
    throw new MediaError(`${voice} isn't installed on this computer. ${ADD_VOICE}`);
  }
  const work = await mkdtemp(path.join(tmpdir(), "studio-voice-"));
  try {
    const sound = path.join(work, "voice.aiff");
    await sayTo(words, voice, rate, sound);
    const label = (name?.trim() || `Voiceover ${voice} ${words.split(" ").slice(0, 5).join(" ")}`).slice(0, 80);
    const body = Readable.toWeb(createReadStream(sound)) as unknown as ReadableStream<Uint8Array>;
    return await importMedia(id, `${label.replace(/[\\/:*?"<>|.]/g, "")}.aiff`, body);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

// Reads words aloud into an AIFF file at `out`. The words go through a
// file, never the command line, so they can't be read as options. Windows'
// voices write a WAV, which ffmpeg turns into the same AIFF.
export async function sayTo(words: string, voice: string, rate: number, out: string) {
  const wpm = Math.round(Math.min(RATE.max, Math.max(RATE.min, rate)));
  const work = await mkdtemp(path.join(tmpdir(), "studio-say-"));
  try {
    const script = path.join(work, "words.txt");
    await writeFile(script, words);
    // eslint-disable-next-line no-restricted-syntax -- Mac's say; Windows: speak.ps1 below
    if (!IS_WINDOWS) return await run("say", ["-v", voice, "-r", String(wpm), "-f", script, "-o", out]);
    const wav = path.join(work, "voice.wav");
    const twin = VOICES.find((v) => v.id === voice)?.windows ?? voice;
    await run("powershell.exe", [...SPEAK, "-Voice", twin, "-Rate", String(wpm / RATE.normal), "-TextFile", script, "-Out", wav]);
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", wav, out]);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
