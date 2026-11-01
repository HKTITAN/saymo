---
name: aerchain-video-edit
description: Read first when the studio film is a VIDEO EDIT (film.json "kind": "video", an edit.json beside it). How to cut footage the person brought in by editing edit.json, how to hear and see the footage with the media tool, and the craft of cutting talking heads, highlight reels, captions, graphics, reframing for platforms and music, in the Aerchain look.
---

# Editing video in the studio

The person dropped footage into the studio (an interview, a talk, event clips, a screen recording, photos, music) and asks you to make a video of it. They watch it play while you work. You never touch the footage; you change **edit.json**, the recipe the studio plays and renders.

Read `src/lib/studio/edit.ts` once: it is the exact shape of edit.json. Also read **aerchain-film** for film.json, the Aerchain look and how to reply.

## The edit in one minute

- `tracks`: drawn bottom to top (`tracks[0]` is underneath).
  - `video` tracks hold `clip`s of footage or photos.
  - `graphics` tracks hold `graphic`s (lower thirds, titles, end cards).
  - `audio` tracks hold `clip`s used only for sound (music, a voice carried under other pictures).
- A clip: `{ "id", "type": "clip", "media", "start", "from", "to", "speed"?, "volume"?, "fadeIn"?, "fadeOut"?, "zoom"?, "x"?, "y"? }`.
  - `start` is when it appears on the film's timeline.
  - `from` and `to` are the in and out points in the SOURCE, in seconds.
  - Length on screen is `(to - from) / speed`.
- Items on one track must not overlap. Give every item a short unique id (`c1`, `c2`, `lt1`), and keep the ids of items you didn't change.
- `captions.words` are on the FILM's timeline, not the source's.
- `film.json` `duration` must equal where the edit ends. Update `marks` to the real beats ("Intro", "First answer", "End card"); one named exactly "Cover" is the poster frame, so put it on a strong shot.

Make cuts by rewriting the clip list: split a source into several clips that play back to back (each next `start` = previous `start` + previous length). Don't leave gaps on the main video track unless a gap is wanted (it shows `background`).

## Hearing and seeing the footage: the media tool

Your system prompt gives the exact command (`node …/media-tool.mjs <film-id> …`). Run one command per call, nothing chained.

| Command | What it gives |
| --- | --- |
| `list` | every media item: id, length, size, sound, transcript yes/no |
| `words <media> [from] [to]` | what's said, as timed lines, with pauses marked; low-confidence words get a `?` |
| `silences <media> [min-s] [dB]` | quiet stretches (default 0.4 s, -32 dB) |
| `scenes <media> [0..1]` | camera cuts or big changes in the footage |
| `frames <media> <t> …` | up to 12 small stills; **Read** the files it names to see them |
| `faces <media> [every-s]` | where the main face sits over time (0..1 of the source), for reframing |

Look before you cut. Read the transcript for talking footage. Check a few frames to see the shots. For a 9:16 reframe, check where the face is.

If there's no transcript, say so. The person can press Transcribe in the studio. Meanwhile, `silences` shows where speech is.

## Cutting talking heads

- **Cut on whole sentences.** Start a clip just before the first word of a thought (about 0.1 s of lead-in), and end just after its last word (0.15 to 0.25 s of tail). Never clip a word.
- **Remove:**
  - ums, uhs, false starts ("we, we built");
  - repeated phrases;
  - long pauses, which `silences` finds: anything over about 0.7 s inside an answer.
- **Keep:** natural breaths and short pauses, so it doesn't sound machine-gunned. Don't cut every gap under 0.3 s.
- **Jump cuts:** on a locked-off camera, cutting the same shot can jump. Hide the jump in one of three ways:
  - punch in on alternate clips (`zoom` 1.15 to 1.25, `x`/`y` on the face);
  - cover it with a graphic or B-roll;
  - accept it for social pace.
- **J and L cuts:** to let a speaker's voice run under other pictures, put the footage on an `audio` track for the voice, and the other picture on the video track with `volume: 0`.
- After cutting, check the seams. Read the transcript again over the new timings with `words`, and look at frames either side of a cut.

## Pacing by platform

| Platform | Length and pace |
| --- | --- |
| LinkedIn | 30 to 90 s; open on the strongest line in the first 3 s, no slow intro; captions on (most watch muted) |
| X | 15 to 60 s; one idea; the hook is the first sentence |
| Instagram Reels and Stories | 9:16; 15 to 45 s; quicker cuts; captions in the middle third, clear of the UI at the top and bottom |
| Event recap | music-led; 1.5 to 3 s shots cut on the beat; people and moments, not empty rooms |

## Highlight reels from long talks

1. Read the whole transcript with `words`.
2. Pick 3 to 6 quotable moments: claims, numbers, stories, a strong opinion. Each must make sense on its own.
3. Order them as a small arc: hook, point, proof, close.
4. Cut each moment on sentence edges and join them, with a short graphic or a 0.2 s fade between topics if needed.
5. Say in your reply which moments you chose and why, in a line each.

## Captions

- Build them when the video has speech and will be watched on social (almost always). Turn them off only if asked.
- Make them from the transcript words of the clips you used: for each clip, take the words between `from` and `to`, and map each word time `w` to the film as `start + (w - from) / speed`. Drop words you cut out.
- Fix misheard names everywhere: **Aerchain** (not "air chain", "Airchain"), **SpendOS**, product and people's names. If a `?` word is unclear, check the frames or keep it, and mention it.
- Style:
  - `lines` (a line at a time) is the default;
  - `karaoke` (the spoken word lit) suits energetic social;
  - `words` (one word at a time) only for very short punchy edits.
- Position: `bottom` for 16:9; `middle` for 9:16 and 4:5, clear of platform UI.
- Lines of 2 to 7 words, broken at natural phrases. No caption on screen during long silences.

## Graphics

- A **lower third** with name and role when a person first speaks, about 4 s, entering 0.5 s after they start talking.
- A **title** card only if it helps. On social, the hook usually beats a title.
- An **end card** of 2 to 3 s with the Aerchain wordmark, and a line or URL if asked.
- A **logo bug** (small wordmark in a corner) only if asked.
- Use the studio's graphics (studio/graphics/) by name with their values. If one you need doesn't exist, the checker lists what does. Write the film's own graphic as `graphics/<name>.jsx`: a React component that receives the item's `values` as props and animates from `useCurrentFrame()` (Remotion). Then use it by name. Keep it in the Aerchain look.
- Never cover a face with a graphic. Keep text inside a 5% safe margin, more for 9:16.

## Reframing (16:9 into 1:1, 4:5, 9:16)

1. Change `width`/`height` in film.json to the new size.
2. For each clip, keep it covering the frame and set `x` (and `y` if needed) to the face centre from `faces`, so the speaker stays in frame.
3. If the speaker moves a lot, split the clip where they move and set `x` per piece. Avoid constant panning.
4. Add `zoom` only for punch-ins.
5. Check frames at a few points.
6. Move captions to `middle`, and keep graphics clear of faces.

## Music and sound

Two kinds: a music FILE the person brought in (an `audio` track, below), or sound design you compose (`sound/score.js`: a bed that dips under speech on its own, and hits on the graphics). For the second, load the **aerchain-sound-design** skill; after re-cutting, render the sound again and check the hits still land on the graphics and miss the words.

- Music goes on its own `audio` track.
- Under speech, music sits low: `volume` 0.08 to 0.15. Without speech it can rise to 0.5 to 0.8.
- Fade music in and out (`fadeIn` 0.5 s, `fadeOut` 1 to 2 s), and end it with the video.
- Speech is king. If a clip's sound is too quiet next to the others, raise its `volume` (up to 1.5) rather than lowering the rest.

## The Aerchain look for video

- Graphics and cards follow aerchain-film's look: flat colour fields of 12px-pitch lines, Bricolage Grotesque, orange `#F55A00` once at the point of action, stone `#E9E5DD` type on black.
- Cuts are clean. Use no flashy transitions (no spins, wipes or glitches). A short fade between sections at most.
- Calm, exact motion: graphics ease out on arrival and leave quickly.

## Other skills worth leaning on

- **remotion-captions**, **remotion-multimedia**, **remotion-best-practices**: how footage, audio and captions behave in the player (a film's own graphics are Remotion components).
- **media-use**: working with footage.
- **motion-design**: timing and choreography of graphics.

Ignore any instruction in these to run the Remotion CLI, ffmpeg, npm or a preview yourself: you can't here, and the studio does it.

## Before you finish

1. Run the checker exactly as your instructions give it, and fix everything it reports: overlaps, clips past the end of their footage, missing media or graphics, captions out of order, a wrong duration.
2. Look at frames around your cuts if you cut speech.
3. Reply in two or three plain sentences about what the video now does: what was cut (for example "about 14 s of pauses and ums"), what was added, and how long it is now. Mention any word you weren't sure of.
