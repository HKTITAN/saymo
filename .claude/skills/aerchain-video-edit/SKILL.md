---
name: aerchain-video-edit
description: Read first when the studio film is a VIDEO EDIT (film.json "kind": "video", an edit.json beside it). How to cut footage the person brought in by editing edit.json, how to hear and see the footage with the media tool, and the craft of cutting talking heads, highlight reels, captions, graphics, reframing for platforms and music, in the Aerchain look.
---

# Editing video in the studio

The person dropped footage into the studio (an interview, a talk, event clips, a screen recording, photos, music) and asks you to make a video of it. They watch it play while you work. You never touch the footage; you change **edit.json**, the recipe the studio plays and renders.

Read `src/lib/studio/edit.ts` once: it is the exact shape of edit.json. Also read **aerchain-film** for film.json, the look for the film's kit and how to reply.

## The edit in one minute

- `tracks`: drawn bottom to top (`tracks[0]` is underneath).
  - `video` tracks hold `clip`s of footage or photos.
  - `graphics` tracks hold `graphic`s (lower thirds, titles, end cards).
  - `audio` tracks hold `clip`s used only for sound (music, a voice carried under other pictures).
- A clip: `{ "id", "type": "clip", "media", "start", "from", "to", "speed"?, "volume"?, "fadeIn"?, "fadeOut"?, "zoom"?, "x"?, "y"?, "box"? }`.
  - `start` is when it appears on the film's timeline.
  - `from` and `to` are the in and out points in the SOURCE, in seconds.
  - Length on screen is `(to - from) / speed`.
  - `box` (optional) is the part of the frame the clip fills, `{ "x", "y", "w", "h" }` as 0..1 of the frame. The clip covers the box as it would cover the frame (`zoom`, `x`, `y` frame it inside the box) and nothing shows outside it. No box means the whole frame.
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
| `cutout <media>` | the person cut out of their background (`cutout.webm`, see-through, sound kept), for clips set `"cutout": true`; waits until it's made, a minute or two for a long take |

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
- Use the studio's graphics (studio/graphics/) by name with their values. If one you need doesn't exist, the checker lists what does. Write the film's own graphic as `graphics/<name>.jsx`: a React component that receives the item's `values` as props and animates from `useCurrentFrame()` (Remotion). Then use it by name. Keep it in the film's kit (the Aerchain look only when the kit is `aerchain`).
- Never cover a face with a graphic. Keep text inside a 5% safe margin, more for 9:16.

## Reframing (16:9 into 1:1, 4:5, 9:16)

1. Change `width`/`height` in film.json to the new size.
2. For each clip, keep it covering the frame and set `x` (and `y` if needed) to the face centre from `faces`, so the speaker stays in frame.
3. If the speaker moves a lot, split the clip where they move and set `x` per piece. Avoid constant panning.
4. Add `zoom` only for punch-ins.
5. Check frames at a few points.
6. Move captions to `middle`, and keep graphics clear of faces.

## Half-and-half reels (speaker on top, a graphic per beat below)

The studio's "Record a reel" makes a 9:16 film (1080x1920) from a take read off its teleprompter, or from videos the person already had. The first message asks for this layout. Usually a script comes with it, attached in `refs/` as JSON: `{ "title", "beats": [{ "line", "visual" }] }`. `line` is what's said; `visual` is the idea for that beat's graphic.

1. **Look first.**
   - Run `list`, then `words` for the take. Without a transcript, use `silences` and say so.
   - Run `faces` for where the speaker sits.
   - Check `frames` at the start, middle and end.
2. **Cut the take.**
   - Trim the dead air before the first word and after the last, and the countdown or "okay" at the start.
   - Cut retakes: when a line is said twice, keep the better last one.
   - Cut long pauses as for any talking head.
   - Don't cut inside a beat's line unless it stumbles.
3. **Put the speaker on the top half.**
   - Every speaker clip on the main video track gets `"box": { "x": 0, "y": 0, "w": 1, "h": 0.5 }`.
   - A 16:9 Mac take covers that 1080x960 box with room to spare. Set `x` and `y` to the face centre from `faces` (often `y` 0.4 to 0.45, so there's headroom), and keep the eyes about a third down the box.
   - `zoom` 1 to 1.15 only. Punch in on alternate clips to hide jump cuts.
4. **Time the beats.**
   - Find each beat's line in the transcript: the first and last spoken word of it, matched loosely, since speech wanders from the script.
   - Map those times to the film (`start + (w - from) / speed`) after your cuts.
   - Each beat's graphic runs from just before its first word (about 0.1 s) to the next beat's start. The last one runs to the end. No gaps in the bottom half.
   - A beat that was skipped gets no graphic. Fold its idea into the next one if it fits.
5. **Make the bottom half.**
   - Write one graphic for the film, `graphics/beat.jsx`, plus its `graphics/beat.json` with the params (`title`, `kind`, `text`, `value`, whatever the ideas need). Place one item per beat on a graphics track with that beat's values. A beat that needs something very different can have its own `graphics/<name>.jsx`.
   - The graphic draws ONLY in the bottom half: a container at `top: H / 2`, `height: H / 2`, full width. Fill it with the brand's ground so the half is never empty.
   - Its subject is the beat's `visual`, drawn as motion: a number counting up, a list building, a before and after, a simple diagram, one key word set large. Not the spoken line typed out again (the captions carry the words).
   - Every graphic enters on its first word and settles fast (0.3 to 0.6 s). Leave cleanly before the next beat's graphic arrives, or hand over with the same ground so the seam never flashes.
   - Draw in the kit: `useBrandFont`, `usePalette`, `useTexture` and `LineBlock` from `studio-kit`, as studio/graphics/*.jsx do. Keep the palette's accent for the one point of action in each beat.
   - Set `background` to the brand's ground.
6. **Captions.**
   - Build them from the words you kept (see Captions). Use `position: "middle"`: they sit on the seam between the halves, which is where these reels carry them.
   - `lines` or `karaoke`, 2 to 5 words a line.
7. **Ending.**
   - End on the last word plus about 0.5 s, or a 2 s end card in the bottom half (or full frame) if the script closes with a call to action.
   - Update `marks` per beat, named by its idea. Put "Cover" on a beat with a strong graphic and the speaker mid-word, eyes open.
8. **Check.**
   - Run the checker.
   - Look at `frames` from a draft at a few beats if you can. The face must sit fully in the top half, and nothing in the bottom half may cross the seam.

With several videos and no script, find the ideas yourself from the transcript: one beat per thought, 3 to 8 s each. Say in your reply how many beats you made and anything you couldn't match to the script.

### Reel layouts, one per beat

A beat in the script can carry a `layout`; without one it's a split. Cut from one layout to the next on the beat's first word. Give `graphics/beat.jsx` a `layout` param (`"split"`, `"popout"`, `"graphic"`) and draw in the matching place.

- **split**: as above, the speaker on the top half and the beat's graphic below.
- **popout**: the beat's graphic on a card, with the speaker cut out of their background standing in front of it.
  1. Run `cutout <media>` on the take first. If it fails, use split for those beats and say why.
  2. The card is drawn by the beat's graphic: a rounded rectangle in the brand's surface colour filling the lower part of the frame (x from 4% to 96% of the width, y from 34% to 97% of the height, corners about 4.5% of the width), with the beat's visual inside it. Keep the card's top band (y 34% to 54%) quiet, because the captions sit there. Above the card is the edit's `background`, the brand's ground.
  3. For that beat, the take's clip moves to a video track above the graphics track (add one named "Front" if there isn't one), with `"cutout": true` and `"box": { "x": 0, "y": 0.02, "w": 1, "h": 0.6 }`. Frame it with `faces` so the face sits about a quarter of the way down the frame and the shoulders cross the card's top edge. Only one clip of the take plays at a time (the cutout carries the voice), so take that stretch off the main track.
  4. Check a draft frame there: the head clears the card's top edge, and no fringe of the old background shows round the hair. If it does, keep the speaker a little smaller.
- **graphic**: the graphic fills the frame. That stretch of the take moves to an audio track, so the voice carries on under it.
- **you**: the take fills the frame (no box), for a beat that's all about the person, like the hook or the sign-off.

## Music and sound

Two kinds: a music FILE the person brought in (an `audio` track, below), or sound design you compose (`sound/score.js`: a bed that dips under speech on its own, and hits on the graphics). For the second, load the **aerchain-sound-design** skill; after re-cutting, render the sound again and check the hits still land on the graphics and miss the words.

- Music goes on its own `audio` track.
- Under speech, music sits low: `volume` 0.08 to 0.15. Without speech it can rise to 0.5 to 0.8.
- Fade music in and out (`fadeIn` 0.5 s, `fadeOut` 1 to 2 s), and end it with the video.
- Speech is king. If a clip's sound is too quiet next to the others, raise its `volume` (up to 1.5) rather than lowering the rest.

## The look for video

For the `clean` kit (the default) or any other kit, follow that kit and aerchain-film's "No brand kit: the clean look": flat colour, no line fields. For the `aerchain` kit:

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
