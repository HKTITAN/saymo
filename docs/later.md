# For later

Saved on 2026-11-03: the things to add next, in order, kept here until the owner picks them up. Done items move out of this list.

## Decided

- **Sound controls stay where they are.** We asked about moving Volume, Mute and Change with Claude into the Film panel's Sound group on the right. The owner said no, so the sound panel keeps floating over the pick on the timeline.

## Done from this list

- Claude's music lane on video edits is now called **Score**, so it doesn't clash with your own Music track (2026-11-03).
- A slide film's voiceover has its own **Voiceover** lane on the timeline, editable like Music and Effects: volume, mute, reset, and Change with Claude (2026-11-03).
- **Sphere carousel** part for HTML films: cards on a turning sphere with lines to a centre card (2026-11-03).
- **The preview draws text exactly like the render**: the stage now adds the text style HyperFrames uses (2026-11-03).
- **Every size**: one render makes 16:9, 1:1, 4:5 and 9:16, each laid out for its frame (2026-11-03).
- **Try 3**: three versions of one prompt at once, only when asked, then pick one (2026-11-03).

## In progress

- **Motion Studio as a Mac app** (from Pond). Built in Swift in `desktop/`, kept local and off GitHub until the owner says to push it. Left: signing, updates, Homebrew, a real icon (see `desktop/README.md`).
- **The references library** (being built, 2026-11-03).

## Bigger features

1. **"Send to Motion Studio" browser extension** (from Pond). Right-click any image, video or page on Pinterest, X or anywhere, and it lands in a film as a reference. Pairs with the references library.
2. **Prompt templates with fields** (from Prompt Motion): product film, explainer, launch film and showreel, each with fields to fill in and already following the studio rules.
3. **Start a film from a reference link.** Paste an X post or a Prompt Motion link, and Claude makes our branded version of it.
4. **Make another like this one.** Turn a finished film into a template with fields, so the next speaker post or event film is a fill-in job.
5. **A check before render.** Flags text too close to the edge or under Instagram's buttons, weak contrast, and anything that breaks the studio rules.
6. **A shortcuts sheet.** Press `?` to see every keyboard shortcut in one place (from Pond).
7. **GIF and poster export** next to the MP4, for LinkedIn previews and emails.
8. **The same film in another language.** The on-screen text and voiceover in Hindi or another language, keeping the timing.
9. **Review links.** Teammates comment at exact moments, and Claude works through the comments.

## Clean-up worth doing

10. **Move old films' music to the new engine** (Tone.js), one at a time after listening, so nothing in-house depends on Strudel. Optional.
11. **Try the new pieces with real use.** So far each has only been tested with stand-ins:
   - the mic in English and Hindi, with a real voice;
   - a first SpendOS product film with the borrowed skills;
   - a real reel take;
   - Codex, once it's installed (`npm install --global @openai/codex`, then `codex login`);
   - PowerPoint slides with LibreOffice (`brew install --cask libreoffice`);
   - the studio's MCP server in Claude Desktop or Cursor.

## Only when we decide to sell

12. **Turn off the GPL ffmpeg part of the Rust engine** (fframes' `libav-agree-gpl`), or drop that engine from the product.
13. **Put API key setup on the product's home page**, so a new user can paste a key first.
14. **Take out the Aerchain material.** Kept for now, at the owner's call.
15. **Smaller selling leftovers:**
    - the sample `studio/hyperframes/aerchain-bands` still loads GSAP;
    - skill updates overwrite the "In Motion Studio" notes;
    - run `STUDIO_EDITION=product npm run licences` again;
    - run `cargo fetch` so the Rust engine's crates are in the licence check;
    - test the product edition from start to finish.
16. **The owner's own tasks:**
    - a Remotion company licence once we're past 3 people;
    - a PikaIcons team licence, only if we use paid icons;
    - a lawyer's review.

## Small leftovers, the owner's

- One-time Google sign-in setup for saving to Drive.
- Delete the test repo `moreshruti/aerchain-motion-library-test` on GitHub.
- Delete the merged `v2-speaker-post` branch.
- Add port 3201 to Google's sign-in redirect addresses so Drive works in the Mac app.
