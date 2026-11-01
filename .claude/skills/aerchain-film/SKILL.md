---
name: aerchain-film
description: Read first when working on a film in Aerchain's motion studio (a folder under films/<id>/ with a film.json). How a studio film is built for each engine, what film.json must say, which other skills to use, the Aerchain look, and how to check the work. Use for every change to a studio film.
---

# Aerchain studio films

The studio at `/studio` is Aerchain's own motion tool. The person you work with sees the film playing in it, scrubs a timeline, points at things and asks you for changes. They never see code, file names or engine names. Your job: change the film's files so the film on their screen changes the way they asked.

The contract is `src/lib/studio/contract.ts` (read it if anything below is unclear). Everything a film needs lives in its own folder, `films/<id>/`. You may only write there.

**Video films:** if film.json says `"kind": "video"` (there's an edit.json), the film is an edit of footage the person brought in. Load the **aerchain-video-edit** skill as well: you change the edit through edit.json, not by rewriting the component, and you look at the footage with the media tool. The film.json rules, the Aerchain look and "Before you finish" below still apply.

## film.json: keep it true

`film.json` is what the studio reads to show the film. Keep it current whenever you change the film:

- `duration` (seconds), `fps`, `width`, `height`: must match what the film actually does. If you make the film longer, change `duration` too.
- `title`: leave it unless asked.
- `marks`: the named moments on the timeline, `{ "t": 1.2, "label": "Orange rises" }`. Keep one per real beat (a thing arriving, leaving or changing), labelled in plain words, in time order. Update them when timings change.
- `params`: the values the person can change from the panel without you. Expose the few that matter (main colours, the headline words, speeds or timings, an on/off for an element). Shape: `{ "key": "accent", "label": "Accent colour", "type": "color", "value": "#F55A00" }`; types are `number` (with `min`, `max`, `step`, `unit`), `color`, `text`, `toggle`, `choice` (with `options`). Keys are camelCase; labels are plain English. The film must read the current values (see each engine below) and fall back to the `value` in film.json.
- Never touch `id`, `engine`, `createdAt`, `session`.

## The three engines

Pick by what the film needs; stay with the film's current engine unless it can't do the job.

### html (default): HyperFrames

`index.html` is the whole film: HTML and CSS for what's on screen, one **paused** GSAP timeline for how it moves.

- The root element carries `data-composition-id="main"`, `data-start="0"`, `data-duration`, `data-fps`, `data-width`, `data-height`, matching film.json. Timed elements carry `class="clip"`, `data-start`, `data-duration`, `data-track-index`.
- The timeline is `gsap.timeline({ paused: true })` and is registered as `window.__timelines["main"]`. Never play it, never use `repeat: -1`, `Date.now()`, `Math.random()` without a seed, or timers: the studio seeks it to any moment and every moment must look the same each time.
- End the timeline with `tl.set({}, {}, DURATION)` so its length is the film's length.
- Read params as `const P = Object.assign({ accent: "#F55A00" }, window.__params);` before building anything.
- Give every element a person might point at an `id` (`#headline`, `#orange-bar`). When they point at something, its id is in the message.
- Fonts and images go in `assets/`, referenced by relative paths.
- Lean on the **hyperframes** skill (its render contract and what each kind of video needs) and the **gsap-core**, **gsap-timeline**, **gsap-plugins**, **gsap-utils** and **gsap-performance** skills. Ignore any instruction in them to run `npx hyperframes …`, start a preview, install packages, render or open a browser: you can't here, and the studio does it.

### react: Remotion

For films driven by data or lists, captions from a transcript, audio, or video clips.

- `src/Film.jsx` default-exports the component. It receives the params as props (with defaults matching film.json) and draws frame by frame with `useCurrentFrame()` and `useVideoConfig()` from `remotion`.
- Animate only from the frame number (`interpolate`, `spring`), never with CSS transitions, timers or state.
- Put `data-part="headline"` and similar on things a person might point at.
- Static files go in `public/`, loaded with `staticFile()`.
- Lean on **remotion-best-practices** first, then **remotion-captions**, **remotion-multimedia**, **remotion-markup** as needed. Ignore instructions to run the Remotion CLI, Studio or `npm`.

### rust: fframes

For heavy generative scenes (thousands of moving shapes) where a browser would be slow. Previews in the studio as a quick draft video, so it's slower to iterate: only use it when the others can't cope.

- A Cargo crate drawing SVG per frame. Values come from `params.json` beside `Cargo.toml`.
- No `build.rs`, no build scripts, no proc-macro crates, no new dependencies (there's no network; only already-downloaded crates build).
- Lean on the **fframes-video** skill. Ignore instructions to run cargo yourself; use the check below.

### Switching engine

Only if asked, or if the film truly can't be done in its engine. Copy the right starter from `studio/starters/<engine>/` into the film folder, rebuild the film there, remove the old engine's files, and set `"engine"` in film.json. Say in your reply that you rebuilt it.

## The Aerchain look

Unless asked otherwise, films look like Aerchain:

- Colours from `src/components/post/palette.ts`: black `#1E1E1E` with `#141414` lines, orange `#F55A00` with `#DB5000`, stone `#D3CCBF` with `#C2BAAC`, light stone `#E9E5DD` for type on black. Orange is the accent: use it once, at the point of action.
- Every colour field is a flat field of horizontal lines on a 12px pitch: an 8px line and darker 2px gaps. Lines are continuous flat strokes, one colour each, and move in one direction; colour arrives from the right.
- Type is Bricolage Grotesque (SemiBold 600 for headlines, tracking about -1%, the `opsz` axis set to the size). A copy of the font is in `studio/remotion/public/fonts/BricolageGrotesque-Variable.ttf`; copy it into the film.
- Flat: no gradients, glows, drop shadows, glass or 3D. Motion is calm and exact: ease out on arrival, nothing bounces.
- For principles of timing and choreography see **motion-design**. For faux product UI (app windows, dashboards, cursors) see **stageshow**.
- Words on screen: plain English, sentence case, no em dashes.

## Sound

Every film can have a sound track, written as a score in `sound/score.js` (Strudel music, Tone.js hits on the film's moments) and rendered by the studio. Starters come with one. Load the **aerchain-sound-design** skill before writing or changing sound, and whenever you change the film's timing or marks, check the score still lands on them: run the sound command from your instructions and read where each hit falls.

## Before you finish

1. Run the check, exactly as given in your instructions (`node …/scripts/studio/check-film.mjs`), and fix every error. Fix warnings that affect what's on screen; one about an empty first frame matters, since the first frame is the thumbnail.
2. Make sure film.json's duration, marks and params match the film.
3. Reply in two or three plain sentences about what changed on screen.
