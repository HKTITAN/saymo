import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_BRAND } from "../brands/brand";
import { readBrand } from "../brands/brands";
import { SIZES } from "../films/contract";
import { createFilm, filmDir, listFolders, readFilm, writeFilm } from "../films/films";
import { copySlides, type FilmSlide, importDir, readImport, SlidesError } from "./slides";
import { SECONDS, type SlidesWay } from "./slides-shared";
import { startSound } from "../sound/sound-render";
import { installedVoices, RATE, sayTo, VOICES } from "../sound/voice";

// "Turn slides into a video": a new motion film made from the slides she
// picked, in her order. The slides go into the film's refs/slides/ with
// slides.json (each slide's picture, words, notes, pictures and charts,
// and its time in the film). With a voiceover, each slide's speaker notes
// are read aloud first, so the slides are timed to the voice and Claude is
// told exactly when each one plays. Then the first prompt to Claude says
// what to build.


export type SlidesOptions = {
  keys: string[]; // the slides, in order
  way: SlidesWay;
  width: number;
  height: number;
  seconds: number | "voice"; // each slide's time, or fitted to its voiceover
  voice: string | null; // a voice id, or null for no voiceover
  music: boolean;
  brand: string;
  folder: string | null;
  title: string;
};


const LEAD = 0.5; // the slide is on screen this long before its voice starts
const TAIL = 0.8; // and stays this long after it ends
const END_HOLD = 1.2; // the last slide holds a little longer

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export async function checkOptions(body: unknown): Promise<SlidesOptions | string> {
  if (!isObject(body)) return "Send the film's settings.";
  const keys = Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === "string" && /^[a-z0-9-]{1,24}$/.test(k)) : [];
  if (!keys.length) return "Keep at least one slide.";
  const way = body.way === "motion" ? "motion" : body.way === "animate" ? "animate" : null;
  if (!way) return "Choose Animate my slides or Make it a motion film.";
  const size = SIZES.find((s) => s.width === body.width && s.height === body.height);
  if (!size) return "Choose one of the film sizes.";
  const voice = typeof body.voice === "string" ? body.voice : null;
  if (voice && !VOICES.some((v) => v.id === voice)) return `There's no voice called ${voice}.`;
  if (voice && !(await installedVoices()).has(voice)) return `${voice} isn't installed on this Mac. Add it in System Settings, Accessibility, Spoken Content.`;
  const seconds =
    body.seconds === "voice" && voice ? "voice" : Math.min(SECONDS.max, Math.max(SECONDS.min, Number(body.seconds) || SECONDS.normal));
  const brand = typeof body.brand === "string" && body.brand ? body.brand : DEFAULT_BRAND;
  if (brand !== DEFAULT_BRAND && !(await readBrand(brand))) return "That brand kit no longer exists.";
  const folder = typeof body.folder === "string" && body.folder ? body.folder : null;
  if (folder && !(await listFolders()).some((f) => f.id === folder)) return "That folder no longer exists.";
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 120) : "Slides";
  return { keys: [...new Set(keys)], way, width: size.width, height: size.height, seconds, voice, music: body.music !== false, brand, folder, title };
}

const runQuiet = (cmd: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    proc.stdout.on("data", (c) => (out += c));
    proc.stderr.on("data", (c) => (err = (err + c).slice(-2000)));
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `${cmd} failed`))));
  });

// Notes as they'd be read out: one line, no slide-number leftovers.
const spoken = (notes: string) => notes.replace(/\s+/g, " ").trim().slice(0, 4000);

type Clip = { slide: number; file: string; start: number; seconds: number; text: string };
type Timed = FilmSlide & { start: number; duration: number; voice: Omit<Clip, "slide" | "text"> | null };

export async function makeSlideFilm(importId: string, o: SlidesOptions, onStep: (label: string) => void): Promise<{ id: string; prompt: string }> {
  const imp = await readImport(importId);
  if (!imp) throw new SlidesError("Those slides are gone. Start again.");
  const byKey = new Map(imp.slides.map((s) => [s.key, s]));
  const picked = o.keys.map((k) => byKey.get(k)).filter((s): s is NonNullable<typeof s> => !!s);
  if (!picked.length) throw new SlidesError("Keep at least one slide.");

  onStep("Making the film");
  const film = await createFilm({ title: o.title, engine: "html", width: o.width, height: o.height });
  const dir = filmDir(film.id);
  try {
    onStep("Copying the slides in");
    const slides = await copySlides(importDir(importId), picked, dir, "refs/slides");

    // 1. The voiceover, one clip per slide with notes.
    const clips = new Map<number, Omit<Clip, "start">>();
    if (o.voice) {
      const voiceDir = path.join(dir, "sound/voice");
      await mkdir(voiceDir, { recursive: true });
      const work = await mkdtemp(path.join(tmpdir(), "studio-slide-voice-"));
      try {
        const reading = slides.filter((s) => spoken(s.notes));
        for (const [i, s] of reading.entries()) {
          onStep(`Recording the voiceover, slide ${i + 1} of ${reading.length}`);
          const aiff = path.join(work, `${s.n}.aiff`);
          await sayTo(spoken(s.notes), o.voice, RATE.normal, aiff);
          const file = `voice/slide-${String(s.n).padStart(2, "0")}.wav`;
          await runQuiet("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", aiff, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", path.join(dir, "sound", file)]);
          const seconds = Number((await runQuiet("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(dir, "sound", file)])).trim());
          clips.set(s.n, { slide: s.n, file, seconds: Math.round(seconds * 100) / 100, text: spoken(s.notes) });
        }
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    }

    // 2. When each slide plays.
    let t = 0;
    const timed: Timed[] = slides.map((s, i) => {
      const clip = clips.get(s.n);
      const needed = clip ? LEAD + clip.seconds + TAIL : 0;
      let duration = o.seconds === "voice" ? (clip ? needed : SECONDS.normal - 1) : Math.max(o.seconds, needed);
      if (i === slides.length - 1) duration += END_HOLD;
      duration = Math.round(duration * 100) / 100;
      const start = Math.round(t * 100) / 100;
      t += duration;
      return { ...s, start, duration, voice: clip ? { file: clip.file, start: Math.round((start + LEAD) * 100) / 100, seconds: clip.seconds } : null };
    });
    const total = Math.round(t * 100) / 100;

    if (clips.size) {
      const placed = timed.filter((s) => s.voice).map((s) => ({ slide: s.n, ...s.voice, text: clips.get(s.n)?.text ?? "" }));
      await writeFile(path.join(dir, "sound/voice.json"), `${JSON.stringify({ voice: o.voice, clips: placed }, null, 2)}\n`);
    }

    // 3. slides.json, for Claude.
    await writeFile(
      path.join(dir, "refs/slides/slides.json"),
      `${JSON.stringify(
        {
          way: o.way,
          size: { width: o.width, height: o.height },
          secondsPerSlide: o.seconds,
          voiceover: o.voice ? { voice: o.voice, file: "sound/voice.json" } : null,
          music: o.music,
          length: total,
          slides: timed.map(({ voice, ...s }) => ({ ...s, ...(voice ? { voice: { ...voice, file: `sound/${voice.file}` } } : {}) })),
        },
        null,
        2,
      )}\n`,
    );

    // 4. film.json: its length, a mark per slide, its brand and folder.
    const now = (await readFilm(film.id)) ?? film;
    await writeFilm({
      ...now,
      duration: total,
      marks: timed.map((s) => ({ t: s.start, label: `Slide ${s.n}${s.title ? `: ${s.title.slice(0, 40)}` : ""}` })),
      ...(o.brand !== DEFAULT_BRAND ? { brand: o.brand } : {}),
      ...(o.folder ? { folder: o.folder } : {}),
      updatedAt: new Date().toISOString(),
    });
    // The voice is heard straight away, before Claude has written anything.
    void startSound(film.id, clips.size > 0);

    return { id: film.id, prompt: slidesPrompt(o, timed, total) };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

const s2 = (n: number) => n.toFixed(2);

// A turn has a time limit, and a deck is a big build: work so that nothing
// is lost if it runs out, and she can say "carry on".
const PASSES =
  "Work in passes and save as you go: first write index.html with every scene blocked out at its time and with its words, then refine the scenes in order, then the sound. If you run out of time, say which slide you reached so they can ask you to carry on.";

// The first message to Claude: exactly what to build.
export function slidesPrompt(o: SlidesOptions, slides: Timed[], total: number) {
  const list = slides
    .map((s) => {
      const voice = s.voice ? `, voice ${s2(s.voice.start)} to ${s2(s.voice.start + s.voice.seconds)} s` : "";
      const parts = [s.charts.length ? `${s.charts.length} chart${s.charts.length > 1 ? "s" : ""}` : "", s.pictures.length ? `${s.pictures.length} picture${s.pictures.length > 1 ? "s" : ""}` : ""].filter(Boolean);
      return `${s.n}. ${s2(s.start)} to ${s2(s.start + s.duration)} s: "${s.title || "untitled"}"${parts.length ? ` (${parts.join(", ")})` : ""}${voice}`;
    })
    .join("\n");
  const n = slides.length;
  const voice = o.voice
    ? `Voiceover: ${o.voice} already reads each slide's speaker notes; the clips are in the film's sound (sound/voice.json places them, and they're in the sound already). Keep each slide on screen while its voice plays, and bring each part in as the voice reaches it. If you change a slide's timing, move its clip's "start" in sound/voice.json to match, then render the sound.`
    : "No voiceover.";
  const music = o.music
    ? "Music: write a music bed in sound/score.js, cut to the slide changes (scenes start on bar lines). It dips under the voice on its own."
    : "No music: leave the music out of sound/score.js; keep only a few soft effects on the slide changes, or none.";

  if (o.way === "animate") {
    return `Turn my slide deck into a film: "Animate my slides", ${n} ${n === 1 ? "slide" : "slides"}, ${o.width}x${o.height}, ${s2(total)} s.

The slides are in refs/slides/. refs/slides/slides.json lists them in order: each slide's picture (a PNG of the slide), its exact words, its speaker notes, pictures cut from the deck, chart data, and its time in the film. Load the saymo-film skill and follow its "Slides to video" section.

Build one scene per slide, in this order, at these times:
${list}

Keep each slide's look (its layout, colours and type), not the brand kit's, unless a slide has none of its own. Rebuild each slide as real layers in index.html: the title, each bullet, charts as real animated charts from their data, pictures from the deck. Use the slide's words exactly as written. Look at each slide's PNG before you build it, and match it closely. Bring the parts in one by one (title first, then each point, then the chart grows), and hold the finished slide before it moves on. Between slides, carry a shared element across, so the deck plays as one film. The isometric scene and 3D camera rules don't apply to this film, but a gentle camera move between slides is welcome.

${voice}
${music}

Set film.json's duration to ${s2(total)} s with one mark per slide, then check the film.

${PASSES}`;
  }

  return `Turn my slide deck into a motion film: "Make it a motion film", ${n} ${n === 1 ? "slide" : "slides"}, ${o.width}x${o.height}, about ${s2(total)} s.

The deck is in refs/slides/. refs/slides/slides.json lists each slide in order: its picture (a PNG of the slide), its exact words, its speaker notes, chart data and pictures. Load the saymo-film skill and follow its "Slides to video" section.

Read every slide (look at each PNG and its words and notes) before you design anything. Then find the story the deck tells (the problem, the turn, the proof, the ask) and retell it as a branded motion film in the film's brand kit, not as slides: no slide layouts, no screenshots of slides. Use the deck's own words and numbers for anything on screen, shorter where a line is long. Turn numbers into animated charts and steps into a moving diagram.

${o.voice ? "Follow the voiceover's timing, one beat per slide:" : "A beat for each slide, roughly at these times (merge or split beats where the story needs it):"}
${list}

Follow every studio rule: one continuous film where each scene hands off to the next, an isometric scene, a real 3D camera move, cut to the music, and a strong start and end.

${voice}
${music}

Set film.json's duration and marks to match, then check the film.

${PASSES}`;
}
