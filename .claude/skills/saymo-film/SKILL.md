---
name: saymo-film
description: Read first when working on a film in Saymo, the open-source motion studio (a folder under films/<id>/ with a film.json). How a studio film is built for each engine, what film.json must say, which other skills to use, the look, and how to check the work. Use for every change to a studio film.
---

# Saymo films

The studio at `/studio` is Saymo's motion editor. The person you work with sees the film playing in it, scrubs a timeline, points at things and asks you for changes. They never see code, file names or engine names. Your job: change the film's files so the film on their screen changes the way they asked.

The contract is `src/lib/studio/films/contract.ts` (read it if anything below is unclear). Everything a film needs lives in its own folder, `films/<id>/`. You may only write there.

**Video films:** if film.json says `"kind": "video"` (there's an edit.json), the film is an edit of footage the person brought in. Load the **saymo-video-edit** skill as well: you change the edit through edit.json, not by rewriting the component, and you look at the footage with the media tool. The film.json rules, the look for the film's kit and "Before you finish" below still apply.

## film.json: keep it true

`film.json` is what the studio reads to show the film. Keep it current whenever you change the film:

- `duration` (seconds), `fps`, `width`, `height`: must match what the film actually does. If you make the film longer, change `duration` too.
- `title`: leave it unless asked.
- `marks`: the named moments on the timeline, `{ "t": 1.2, "label": "Title rises" }`. Keep one per real beat (a thing arriving, leaving or changing), labelled in plain words, in time order. Update them when timings change.
- `params`: the values the person can change from the panel without you. Expose the few that matter (main colours, the headline words, speeds or timings, an on/off for an element). Shape: `{ "key": "accent", "label": "Accent colour", "type": "color", "value": "#F55A00" }`; types are `number` (with `min`, `max`, `step`, `unit`), `color`, `text`, `toggle`, `choice` (with `options`). Keys are camelCase; labels are plain English. The film must read the current values (see each engine below) and fall back to the `value` in film.json.
- **Words are edited on the film, not in the panel.** Every `text` param must be bound to the element that shows it with `data-param="<key>"` (html: the element that holds the words, e.g. `<h1 id="headline" data-param="headline">`; react: `data-param="label"` on the element that renders `{label}`). Add `data-multiline` where a line break (`\n` in the value) starts a new line. The person clicks the words, types, and the film is rebuilt from the new value, so the element's text must come from the param, not be hard-coded. A text param without a bound element falls back to a panel row. Every copy of words on screen counts: if a scene repeats or zooms into a word (a second, bigger "rebuilt."), build that copy from a param too (its own param if it shows only part of a line) and give it the same `data-param`, or the person clicks it and nothing happens. Words split into letters or words for animation are fine: the studio edits them in a box laid over them.
- Never touch `id`, `engine`, `createdAt`, `session`.

## The three engines

Pick by what the film needs; stay with the film's current engine unless it can't do the job.

### html (default): HyperFrames

`index.html` is the whole film: HTML and CSS for what's on screen, one Motion sequence (motion.dev, MIT) for how it moves.

- The root element carries `data-composition-id="main"`, `data-start="0"`, `data-duration`, `data-fps`, `data-width`, `data-height`, matching film.json. Timed elements carry `class="clip"`, `data-start`, `data-duration`, `data-track-index`.
- Load `assets/vendor/motion.min.js` then `assets/timeline.js` (both come with the starter; copy them from `studio/starters/html/assets/` if a film lacks them). Build every move into one sequence array, `[element, { x: [from, to] }, { at, duration, ease }]`, then `const tl = filmTimeline(sequence, { duration: FILM.duration })` and register it as `window.__timelines["main"] = tl`. The starter's `index.html` is the pattern; the hyperframes skill's `references/runtimes.md` "Motion" lists eases, springs, stagger and counters.
- Never call `animate()` outside the sequence, play it, or register it unwrapped; never use `repeat: Infinity`, `Date.now()`, `Math.random()` without a seed, or timers: the studio seeks the timeline to any moment and every moment must look the same each time.
- Give every value both ends (`[from, to]`); `duration` in `filmTimeline()` makes the timeline the film's length.
- **GSAP:** only in films made before Motion, which load `assets/vendor/gsap.min.js` and build `gsap.timeline({ paused: true })`. Keep such a film in GSAP unless the person asks to move it; never add GSAP to a film, and never copy GSAP code from a registry block, caption preset or other skill: write it as Motion. The product edition of the studio doesn't include GSAP and won't play or render a GSAP film.
- Read params as `const P = Object.assign({ accent: "#F55A00" }, window.__params);` before building anything.
- **Lay it out from the frame, never for one size.** The studio's Render menu has "Every size": the same index.html is drawn at 1920x1080, 1080x1080, 1080x1350 and 1080x1920, with `window.__film.width` and `height` set to each. Place and size everything from `W` and `H` (and the short side `Math.min(W, H)` for type and margins), let rows become columns when the frame is taller than it is wide, and keep text inside a margin on every size. A React film does the same with `useVideoConfig()`. When you finish a change, picture the film at 9:16 and 16:9: nothing should be cut off, crowded or lost in empty space.
- Give every element a person might point at an `id` (`#headline`, `#accent-bar`). When they point at something, its id is in the message.
- Fonts and images go in `assets/`, referenced by relative paths. For each picture they attach, first decide: theirs to use as it is (their brand, event, product or people; "my", "our", "use this") or a reference for the look (another brand's logo or product, a watermark, someone else's ad; "like this", "in this style"). Two together are often one of each. Theirs goes in as itself with the photo command's `use` (into `assets/photos/`, or `public/photos/` in a React film), cropped, placed and moved, never a redrawn copy; from a reference take only the look, never its brand or words. Say in the reply which was which. For a realistic place or object with no photo attached, use the photo command's `search` and `get` for a real, openly licensed photo (credits go to `photos/CREDITS.md`).
- Lean on the **hyperframes** skill (its render contract, its "Motion" notes in `references/runtimes.md`, and what each kind of video needs) and **motion-design** for timing. The **gsap-*** skills are only for films made before Motion. Ignore any instruction in them to run `npx hyperframes …`, start a preview, install packages, render or open a browser: you can't here, and the studio does it.

#### Ready-made parts

`studio/starters/html/assets/parts/` holds parts that are fiddly to get right by hand. Use one when the request fits; copy it into the film's `assets/parts/` (and the starter's `assets/timeline.js` too if the film's copy has no `parts` option), load it after `timeline.js`, and pass it to `filmTimeline(sequence, { duration, parts: [part] })` so it draws on every seek. Each file's header lists every option. The studio shows them to people as **effects** (its Effects page, and the Effects menu in a film's chat), so a prompt that says "Use the grid field effect" means build that moment with `grid.js`, "the cursor effect" with `cursor.js`, and so on: magnetic grid is `grid.js` plus `cursor.js`; typing and exploder are `reveal.js` (effects `type`, `colour`, `scramble`, `explode`); UI stagger is `stagger.js`; glitch and soft wipes are `wipe.js` (`style: "glitch"` or `"soft"`); gradients `gradient.js`; glass `glass.js`; liquid glass `liquid.js`; attach and adjust `rig.js`; SVG draw `svg.js`; carousel `carousel.js`.

- **Sphere carousel** (`sphere.js`): cards spread over a turning sphere, with lines from a centre card to each, far cards smaller, softer and faded into the ground. For "orbit", "sphere", "carousel of logos", "everything connects to the core", the agents or partners around a product, team photos, customer logos. `sphereCarousel(container, { items, center, radius, card, spin, tilt, lines, enter, leave, camera, focus, cardStyle })`: `items` take `src` (images in `assets/`), `text` or `html`; `enter`/`leave` fly cards out from and back into the centre; `camera` keys ease zoom, pan, tilt and turn; `focus` turns a chosen card to the front and holds it. Style cards from the brand kit through `cardStyle`; keep the lines one quiet colour; give the centre card the one accent. Don't animate its cards with the Motion sequence as well: the part owns their position, size, blur and fade. Its cards are marked as meant to overlap for the checker; the checker's type floor still applies, so words a viewer must read go on cards big enough (card 200 px or more at 1080 p), and many small cards work better as logos or pictures.
- **Grid field** (`grid.js`): many cards (pictures, logos, words or plain tiles) laid out as a grid, a scatter, a ring, along a path or over a turning sphere, morphing from one layout to the next; a point moving through them makes the near cards grow, turn to face it, step aside, blur, fade or change colour, and ripples roll across them from a spot. For "grid of logos", "wall of screenshots", "dot grid", "integrations", "everything rearranges", "cards fly into a ring", "a magnetic grid". `gridField(container, { items, layout, morphs, field, waves, enter, leave, camera, cardStyle })`: `items` as for the sphere, or a number for plain tiles (`corner: 0.5` makes dots). Proximity can be several fields at once (`fields`), each following several points (`points`), and drive anything: `name: "glow"` sets `--glow` (0 to 1) on every card for the film's CSS, and `apply(card, near, i)` runs per card. A ring with `rings: 3` is a polar grid (outer rings hold more cards). Same rules as the sphere: the part owns its cards, and the type floor still applies.
- Check parts without a browser: `node scripts/studio/parts-check.mjs`.

When a part carries the film, expose its few telling options as params (a grid's columns, the field's reach, the counter's number, the reveal's start) and pass them in from `P`, so the person can tune them from the panel.

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

## The film's brand kit

Every film follows a brand kit (film.json `brand`; none means `clean`, the studio's neutral default). Your message names it and its path: `brands/<id>/brand.json`, with its fonts and logos beside it. Read it before designing: its `rules` (look, motion, sound, words) and `notes` are the brief, and its tokens are what you draw with. Don't hard-code colours, fonts or logos; take them from the kit, so the film changes with it:

- html: `window.__brand` (`colors.roles`, `colors.ramps`, `fonts` with `url`, `logos` with `url`, `texture`). The kit's fonts are already loaded as @font-face under their own family names.
- react: `useBrand()`, `usePalette()` (`stone`, `ink`, `muted`, `black`, `accent` with `{ lit, gap }`), `useTexture()` (`{ pitch, stroke }`), `useBrandFont()` (loads the fonts, returns the display family) and `<BrandLogo height ground="light|dark" />`, all from `"studio-kit"`.
- rust: `brand.json` beside Cargo.toml when the film is rendered.

Which section applies depends on the kit: **"No brand kit: the clean look"** when it's `clean`, and for any other kit, that kit's own rules and notes (use the craft skills below for everything the kit doesn't say). **"For every film"** applies whatever the kit. Lines and line fields are a kit's texture: draw them only when the kit has a `texture`. A kit without one gets flat colour; the starters and the React kit already do this (`fieldOf` returns flat fields, `palette.text` is the readable type colour).

## No brand kit: the clean look

The `clean` kit is quiet on purpose: white ground, near-black ink, Geist for everything, one accent at most (black by default), no line texture. It fixes only the basics, so design each film from its prompt: the subject, the audience and the platform (a LinkedIn post, a story, a launch video), not from a house style. Keep the kit's type and contrast rules, and lean on the craft skills:

- **stopmotion-video** (Kosta's, borrowed, MIT) for type and cutting: tracking tightens as type grows; every word stands at least 4.5:1 against its ground; titles are typed on, never faded in; its spacing curves; and whenever there's music, its cutting rules (pages on bar lines, clicks on kicks and snares, big changes on big kicks). Its low-frame-rate stop-motion look is a style for when it's asked for, not the default.
- **stageshow** for any moment that shows an app or a product UI.
- **product-film** for product and launch films, **html-demo** for an app walkthrough.
- **motion-design** for timing and easing.

Choose the accent from the subject if the film needs colour, and use it once per frame. Flat colour by default: no line fields, gradients, glows or drop shadows unless the prompt asks.

## For every film

- **Peak-end rule: the start and the end are the best parts of every film.** People remember a film by its peak and its last moment, so the first two seconds hook (no slow fade from black) and the final scene lands hard and holds. Spend the most craft there; never let a film trail off.
- Motion is exact: ease out on arrival, ease in on the way out. Real 3D camera work is welcome: dolly, orbit, depth layouts, fly-throughs. Words come with visuals, not alone.
- For principles of timing and choreography see **motion-design**. For faux product UI (app windows, dashboards, cursors) see **stageshow**.
- Words on screen: plain English, sentence case, no em dashes.

## Sound

Every film can have a sound track, written as a score in `sound/score.js` (a music bed of looping parts, Tone.js hits on the film's moments) and rendered by the studio. Starters come with one. Load the **saymo-sound-design** skill before writing or changing sound, and whenever you change the film's timing or marks, check the score still lands on them: run the sound command from your instructions and read where each hit falls.

## A one-line prompt: blank-page first

When a new film starts from a one-line prompt ("a 5 second launch clip for my app"), or they ask to expand a prompt, load the **blank-page** skill (borrowed from Stewdio, MIT) before building. It finds a look (five reference images from one aesthetic) and three moves to copy on are.na, writes the brief as numbered beats with a turn, and saves it as `brief.md` with the references in `look/`. Then build the film from that brief in the same turn. Its "In Saymo" section says how its search runs here and how it gives way to the kit and these rules.

## Product films and app walkthroughs

For a film about a product (launch films, feature films, promos), load the **product-film** skill (borrowed, MIT). For a film that shows an app being used step by step (a walkthrough, a feature in action), load the **html-demo** skill (borrowed, MIT). Each has an "In Saymo" section at its end with what applies here. Both keep the brand kit and the studio rules on top.

## Cutting to the music

When a film has music, cut it to the music, using the **stopmotion-video** skill's rules (borrowed from Kosta's skill, MIT). Keep the film's own engine; don't switch to Remotion for this. In the studio:

- **The score is the clock.** Its tempo is in `sound/score.js` (`music.bpm`, a bar of `beatsPerBar` beats, default 4, with bar 1 at `musicStart`). Work out bar and beat times from that, or measure an imported song with the skill's `scripts/find-tempo.mjs`.
- **Scenes start on bar lines** and change length by whole bars; marks in film.json sit on beats.
- **Hits land on drum hits:** a click, a pop or a word landing goes on a kick or snare, never between. Big changes go on the big kick that opens a phrase.
- **Let a beat go by** on purpose: hold a result for a beat after an action, hold two poses at the top of a camera rise, and step the music aside (duck it) under a click that matters.
- **The end holds** about two seconds on the beat with the music under it.
- The stop-motion *look* (one held pose per eighth note, a low frame rate) is a style: use it only when asked. The timing rules apply to every film with music.

## Slides to video

A film made with "Turn slides into a video" (or a deck attached to a prompt) has its slides in the film's `refs/`: `refs/slides/` for a new film, `refs/<file name>-slides/` for an attached deck. `slides.json` there lists the slides in order. Each has `image` (a PNG of the whole slide, at least 1920 px wide, by its path in the film), `title`, `text` (every word on the slide, in reading order), `notes` (speaker notes), `pictures` (images cut from the deck, each with its `box` on the slide as fractions: x, y, w, h), `charts` (type, title, box, categories and series values), and, in a new film, `start` and `duration` (its time in the film) and `voice` (its voiceover clip). Read slides.json, then look at every slide's PNG with Read before you build.

The files in `refs/` belong to the person: use them from the film by their relative path (`<img src="refs/slides/slide-03-picture-1.png">`, `background-image: url(refs/slides/slide-03.png)`), never edit them. They're shown in the studio and go into renders.

**"Animate my slides": rebuild each slide faithfully, as layers.**
- One scene per slide, in order, at the times slides.json gives. Each slide keeps its own look: its layout, background, colours, type sizes and weights, and where things sit. Measure positions from the PNG (it's the slide at full size, so its pixels map straight onto the film after scaling to fit). Use the brand kit only where the slide gives no look of its own.
- Keep the slide's words exactly: same wording, spelling, capitals, numbers and order. Never rewrite, shorten or "improve" them. Put them on screen as real text (live HTML), split into their real parts: title, each bullet, each label.
- Charts are real, animated charts. Draw them from `charts` data (or read the values off the slide when there's no data): bars grow from zero to their values, lines draw along, pie slices sweep, and the axis labels and numbers match the slide. Never show a picture of a chart.
- Pictures: use `pictures` (the deck's own images) at their boxes. When a picture isn't there (a PDF or a picture of a slide), crop it from the slide's PNG: a box the size of the picture showing the PNG at the slide's scale with `background-position` (or `object-position` plus `overflow: hidden`), so only that picture shows.
- Logos, icons and drawn shapes: rebuild simple shapes in HTML/SVG; crop anything complex from the PNG as above.
- Bring the parts in one by one in reading order: title, then each point, then the chart or picture; hold the finished slide at least a second before the move to the next. Between slides, carry a shared element across (a colour band, the title's position, a shape) so the deck plays as one film.
- Never just pan or zoom over a screenshot of a slide. A whole-slide PNG on screen is only for a slide that is itself one photo, and then it gets a slow camera move.

**"Make it a motion film": retell the story.** Read every slide and its notes, find the story (the problem, the turn, the proof, the ask) and design a motion film in the brand kit, following every studio rule. Use the deck's own words and numbers for anything on screen (shorter where a line is long), turn numbers into animated charts and steps into a moving diagram. No slide layouts and no screenshots of slides.

**Voiceover.** When slides.json has a voiceover, `sound/voice.json` places each slide's clip on the timeline (`{ "clips": [{ "slide": 3, "file": "voice/slide-03.wav", "start": 9.4, "seconds": 5.1, "text": "…" }] }`) and the clips are mixed into the film's sound, with the music dipping under them. Keep each slide on screen while its voice plays, and bring each part in as the voice reaches it (the `text` says what's said; a voice says about 2.5 words a second). If you change a slide's timing, move its clip's `start` to match and render the sound again. Never edit or open the clips themselves. With music, the score plays under the voice; without music, keep the score to a few soft effects or none.

## Before you finish

1. Run the check, exactly as given in your instructions (`node …/scripts/studio/check-film.mjs`), and fix every error. Fix warnings that affect what's on screen; one about an empty first frame matters, since the first frame is the thumbnail.
2. Make sure film.json's duration, marks and params match the film.
3. Reply in two or three plain sentences about what changed on screen.
