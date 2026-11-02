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
