# Moving films off GSAP

GSAP's licence bans its use in no-code visual animation tools that compete with Webflow (see [licences.md](licences.md)). Motion, which was Framer Motion (https://motion.dev, MIT), has no such clause, and neither do the browser's own animations (CSS animations and the Web Animations API).

## Can HyperFrames render without GSAP?

Its code says yes, in principle (hyperframes 0.8.227, `studio/hyperframes/node_modules/hyperframes/dist`, read on 2026-11-03):

- It drives the browser's own animations: `getAnimations()` appears in 11 files, and setting `.currentTime` in 14.
- It replaces the clock for frame-by-frame JavaScript animation, with overrides of `requestAnimationFrame`, `performance.now` and `Date.now`, plus "virtual" time.
- It handles Lottie too (10 files), besides GSAP (`window.gsap`, 8 files).

Motion animates through exactly these: the Web Animations API where it can, `requestAnimationFrame` otherwise. Frames should come out exact, but that isn't proven yet, so do the test below first.

## Plan

1. **Port the starter.** Move the HTML starter (`studio/starters/html/index.html`, which builds a `gsap.timeline` at line 164) to Motion's `animate()` sequences, or to plain Web Animations for simple moves. Use the vanilla `motion` package, not `motion/react`, because HyperFrames films are plain HTML.
2. **Test the frames.** Render the old and the new starter with the same timing (`scripts/studio/render.mjs`) and compare frames at about 10 points, including mid-ease and the last frame. They should match to within a pixel or two. Check that seeking back and forth gives the same frame every time, and include one spring, since springs are the reason to pick Motion over plain Web Animations.
3. **If they match,** update what Claude is told so it writes Motion, not GSAP:
   - the `hyperframes` skill, the `gsap-*` skills, `motion-design`, and the film skill that replaces `aerchain-film`;
   - remove `gsap.min.js` from the starter.

   Existing in-house films keep working; a product build ships no GSAP.
4. **The other engines need nothing.** Remotion films animate from the frame number, with no GSAP. fframes is Rust.

## Done (2026-11-03)

### What changed

- **The starter** (`studio/starters/html`) moves with Motion 14.3.1, the vanilla `motion` package's browser build, vendored as `assets/vendor/motion.min.js` with `motion.LICENSE.md` beside it. `gsap.min.js` is gone from it. The `.min.js` name matters: HyperFrames' checker skips minified vendor files, and would otherwise flag Motion's own `performance.now()`.
- **`assets/timeline.js`** (ours) wraps a Motion sequence as `filmTimeline(sequence, { duration })`, shaped like the timelines the studio always sought (`seek`, `pause`, `play`, `time`, `duration`), so the stage, `render.mjs` and HyperFrames' own renderer drive it unchanged. Two things make it exact:
  - Motion runs every value on the main thread. Left alone it hands some values to the browser's own animations, which HyperFrames would then seek a second time on its own clock. The wrapper makes Motion's one-time "can the browser animate?" check answer no.
  - A seek draws at once. Motion normally draws on the next animation frame; `seek()` runs that frame's work straight away (`Motion.frameSteps`).
- **The bridge** (`src/lib/studio/bridge.ts`) and **`render.mjs`'s own capture** seek a `filmTimeline`, a GSAP timeline, or a bare Motion animation. In the product edition (`STUDIO_EDITION=product`), a film that loads GSAP doesn't play in the stage, render or pass `check-film.mjs`; each says so in plain words.
- **What Claude is told:** the film skill (`.claude/skills/aerchain-film`), the `hyperframes` skill (a "Motion" section in `references/runtimes.md`, notes in `SKILL.md` and `format.md`), an "In Motion Studio" note at the top of each `gsap-*` skill and `motion-design`, `html-demo`'s studio section, and the engine line in `src/lib/studio/claude.ts`.

### Frame match

Old GSAP starter against the new Motion one, same timing, both 1920 x 1080 at 60 fps. Differences are out of 255 per colour channel.

| Test | Frames | Largest difference | Mean |
| --- | --- | --- | --- |
| Lossless HyperFrames frames, as `render.mjs` draws a final, film's own size | all 300 | 2 (266 frames identical) | 0.0000 |
| Seeking in Chrome as `render.mjs` does, at 10 times incl. mid-ease and the last frame | 10 | 1 | 0.0001 |
| The studio's stage, Motion film against GSAP film, both scrubbed with seek messages | 10 | 1 | 0.0001 |
| The studio's stage against the rendered frames, outside the headline | 10 | 2 | |

With a spring added to both (a square flying 600 px and scaling from 0.2 with stiffness 180, damping 12; the GSAP side given the same physics written out by hand):

| Test | Largest difference | Mean | Where |
| --- | --- | --- | --- |
| Lossless, film's own size, all 300 frames | 2 everywhere but 3 frames | 0.00005 | |
| | 25 to 49 on those 3 frames | | Where Motion calls a spring settled and snaps it home: 0.19 px early, by design |
| Lossless 4K, all 300 frames | 2 everywhere but the same 3 frames (50 to 98 there) | 0.00005 | The same snap |

Seeking forwards, backwards and in a shuffled order, every time visited three times, always gave identical pixels, in Chrome and in the stage.

Through `render.mjs` itself (H.264), Motion against GSAP: draft largest 21, mean 0.0045; 1080p largest 35, mean 0.028; 4K largest 9, mean 0.005. Two renders of the same GSAP film differ by up to 27 (1080p) and 6 (4K) on their own, as the encoder spreads a 1 of 255 change through the frames that follow. So the lossless frames are the real comparison.

The stage and the renderer draw the headline's text slightly differently (up to 186 at glyph edges): the same for the GSAP film, so it isn't from Motion. Worth a look on its own.

### Checked

- A new film made through the studio's own API renders with Motion, draft and final with sound, in both editions; the product one contains no file or line mentioning GSAP.
- One of the team's GSAP films (copied into a test checkout) still plays in the stage and renders draft and final in-house; the product edition refuses it.
- `hyperframes check` passes on the new starter.

### Left

- **The sample composition** `studio/hyperframes/aerchain-bands` still loads GSAP from a CDN. Port it the same way, or leave it out of a product build.
- **Borrowed skills and presets** still contain GSAP code: `hyperframes-registry` blocks, the `hyperframes` caption presets, `remotion-to-hyperframes`, `hyperframes-cli`. The film skill tells Claude to rewrite any of it in Motion. A product build could drop the `gsap-*` skills altogether.
- **Skills updates overwrite the notes.** The `hyperframes`, `gsap-*`, `motion-design` and `html-demo` skills come from upstream (`skills-lock.json`); after an update, put the "In Motion Studio" notes back.
- **Older films:** move one to Motion only when someone asks. A product build mustn't ship them.
