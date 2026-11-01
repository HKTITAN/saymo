// Makes a voiceover for a video film from words in a text file inside that
// film, through the running studio (so it lands in the film's media like a
// file brought in by hand), and waits until it's ready to place.
//
// usage: node scripts/studio/voice.mjs <film-id> <voice> <words-per-minute> <words.txt>
//   voice: Rishi or Aman (Indian English, male), Tara (Indian English,
//   female), Lekha (Hindi, female). Pace 120 to 240; 175 is normal.
//
// Run from the film's own folder; the text file must be inside it.

import { readFile } from "node:fs/promises";
import path from "node:path";

const [id, voice, rate, file] = process.argv.slice(2);
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
if (!/^[a-z0-9]{8}$/.test(id ?? "") || !voice || !rate || !file) {
  fail("usage: node scripts/studio/voice.mjs <film-id> <voice> <words-per-minute> <words.txt>");
}
const filmDir = process.cwd();
if (path.basename(filmDir) !== id) fail("Run this from the film's own folder.");
const words = path.resolve(filmDir, file);
if (!words.startsWith(`${filmDir}${path.sep}`)) fail("The text file must be inside the film's folder.");

const text = await readFile(words, "utf8").catch(() => fail(`Can't read ${file}.`));
const origin = process.env.STUDIO_ORIGIN ?? "http://localhost:3200";
const headers = { "x-studio": "1", "content-type": "application/json" };

const res = await fetch(`${origin}/api/studio/films/${id}/voice`, {
  method: "POST",
  headers,
  body: JSON.stringify({ text, voice, rate: Number(rate), name: path.basename(file, path.extname(file)) }),
}).catch(() => fail("The studio isn't answering."));
const media = await res.json().catch(() => ({}));
if (!res.ok) fail(media.error ?? "The voiceover couldn't be made.");

for (let i = 0; i < 120; i++) {
  const r = await fetch(`${origin}/api/studio/films/${id}/media/${media.id}`, { headers });
  const m = await r.json();
  if (m.status === "ready") {
    console.log(`Voiceover ready: media ${m.id} "${m.name}", ${m.duration.toFixed(2)} s, voice ${voice}.`);
    console.log("Place it on an audio track in edit.json; transcribe it if it needs captions.");
    process.exit(0);
  }
  if (m.status === "failed") fail(m.error ?? "The voiceover couldn't be prepared.");
  await new Promise((done) => setTimeout(done, 500));
}
fail("The voiceover is taking too long to prepare.");
