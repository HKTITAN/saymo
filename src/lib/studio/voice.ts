import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import type { Media } from "./edit";
import { importMedia, MediaError } from "./media";

// Voiceovers: words typed (or written by Claude) read aloud by one of the
// Mac's own voices, offline, and brought into the film like any sound file,
// so they can be placed, trimmed, captioned and mixed. Indian voices come
// first and Rishi is the default; the rest are there for other markets.

export type Voice = { id: string; label: string; accent: string; language: string };

// The order shown in the studio.
export const VOICES: Voice[] = [
  { id: "Rishi", label: "Rishi", accent: "Indian English, male", language: "en_IN" },
  { id: "Tara", label: "Tara", accent: "Indian English, female", language: "en_IN" },
  { id: "Aman", label: "Aman", accent: "Indian English, male", language: "en_IN" },
  { id: "Lekha", label: "Lekha", accent: "Hindi, female", language: "hi_IN" },
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

// Which of VOICES this Mac has installed (a fresh Mac may lack some).
let installed: Promise<Set<string>> | null = null;
export function installedVoices(): Promise<Set<string>> {
  installed ??= new Promise((resolve) => {
    const proc = spawn("say", ["-v", "?"]);
    let out = "";
    proc.stdout.on("data", (d) => {
      out += String(d);
    });
    proc.on("error", () => resolve(new Set()));
    proc.on("close", () => resolve(new Set(out.split("\n").map((l) => l.split(/\s{2,}/)[0]?.trim()).filter(Boolean))));
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
    throw new MediaError(`${voice} isn't installed on this Mac. Add it in System Settings, Accessibility, Spoken Content.`);
  }
  const wpm = Math.round(Math.min(RATE.max, Math.max(RATE.min, rate)));
  const work = await mkdtemp(path.join(tmpdir(), "studio-voice-"));
  try {
    const script = path.join(work, "words.txt");
    const sound = path.join(work, "voice.aiff");
    await writeFile(script, words);
    // From a file, never the command line, so the words can't be read as options.
    await run("say", ["-v", voice, "-r", String(wpm), "-f", script, "-o", sound]);
    const label = (name?.trim() || `Voiceover ${voice} ${words.split(" ").slice(0, 5).join(" ")}`).slice(0, 80);
    const body = Readable.toWeb(createReadStream(sound)) as unknown as ReadableStream<Uint8Array>;
    return await importMedia(id, `${label.replace(/[\\/:*?"<>|.]/g, "")}.aiff`, body);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
