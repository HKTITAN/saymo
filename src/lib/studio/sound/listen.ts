import path from "node:path";
import { AUDIO_EXTS } from "../input/attachments";
import type { Attachment, ChatContext, Film } from "../films/contract";
import { ROOT } from "../films/films";

// Reference sounds: audio files attached to a film's prompt ("make it feel
// like this"). Claude can't hear, so it runs the listening tool
// (scripts/studio/listen.mjs) on each one, and on the film's own stems to
// compare. The tool only opens this film's refs/ and its rendered sound.
// References guide the sound; they never go into the film.

export const listenCommand = (id: string) => `node ${path.join(ROOT, "scripts/studio/listen.mjs")} --film ${id}`;

// Reads Claude may not try on a sound file (it can't open them; the tool can).
export const refAudioDenies = (dir: string) => AUDIO_EXTS.map((ext) => `Read(/${dir}/refs/*.${ext})`);

const clock = (s?: number) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "length unknown");

// What Claude is told when a message carries reference sounds.
export function referenceSoundNote(id: string, kind: Film["kind"], all: Attachment[], sound?: ChatContext["sound"]) {
  const refs = all.filter((a) => a.kind === "audio");
  if (!refs.length) return "";
  const tool = listenCommand(id);
  const lines = [
    "<references>",
    `They attached ${refs.length === 1 ? "a sound as a reference" : `${refs.length} sounds as references`} for how this should sound:`,
    ...refs.map((a) => `- ${a.path} ("${a.name}", ${clock(a.seconds)})`),
    "You can't hear, so listen with the listening tool first, one file per call, nothing chained:",
    `  ${tool} ${refs[0].path}`,
    "It reports the tempo and beats, where sounds start, the key and main notes, loudness over time, brightness, the low, mid and high balance, how hits attack and decay, stereo width and any words. Add --from <seconds> --to <seconds> to hear one part of a file.",
  ];
  if (sound) {
    const stems = sound.stem === "both" ? ["music", "effects"] : [sound.stem];
    const span = `--from ${sound.from.toFixed(2)} --to ${sound.to.toFixed(2)}`;
    lines.push(
      `Then hear what the film has there now: ${stems.map((s) => `${tool} --stem ${s} ${span}`).join(", and ")}.`,
      `Use what you hear to guide only the ${sound.stem === "both" ? "music and effects" : sound.stem === "voice" ? "voiceover" : sound.stem} from ${sound.from.toFixed(2)} s to ${sound.to.toFixed(2)} s, as the <sound> note says: everything else in the score stays identical, and never edit sound/mix.json.`,
    );
  } else {
    lines.push(
      `To compare with the film's sound now: ${tool} --stem music (or effects, or mix), with --from and --to in film seconds.`,
      "Use what you hear to guide the film's sound design (sound/score.js), with the saymo-sound-design skill.",
    );
  }
  lines.push(
    "References are guidance only. Never copy, sample, load or play the reference audio in the film, never point the score or the edit at these files, and don't lift a melody note for note: make an original sound that shares the qualities they asked for (tempo, rhythm, feel, brightness, shape of the hits). Re-render with the sound command and listen to the stem again to check it moved towards the reference.",
  );
  if (kind === "video") lines.push("If they want this exact recording in the film, tell them to drop it on the timeline as media instead; don't use it from refs/.");
  lines.push(
    `Begin your reply by naming what you took from ${refs.length === 1 ? "the reference" : "each reference"} in a few words, for example: "From beat.mp3: its 92 BPM swing, soft kick and dark, narrow sound."`,
    "</references>",
  );
  return lines.join("\n");
}
