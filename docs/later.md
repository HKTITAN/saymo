# For later

Saved on 2026-11-03: the things to add next, in order, kept here until the owner picks them up. Done items move out of this list.

## Decided

- **Sound controls stay where they are.** We asked about moving Volume, Mute and Change with Claude into the Film panel's Sound group on the right. The owner said no, so the sound panel keeps floating over the pick on the timeline.

## Done from this list

- Claude's music lane on video edits is now called **Score**, so it doesn't clash with your own Music track (2026-11-03).
- A slide film's voiceover has its own **Voiceover** lane on the timeline, editable like Music and Effects: volume, mute, reset, and Change with Claude (2026-11-03).

## In progress

- **Motion Studio as a Mac app** (from Pond). Being built in `desktop/`, kept local and off GitHub until the owner says to push it.

## Bigger features

1. **"Send to Motion Studio" browser extension** (from Pond). Right-click any image, video or page on Pinterest, X or anywhere, and it lands in a film as a reference.
2. **A references library.** One shared place for saved references, sound references and brand material, with folders and tags, and any of it can be dropped into a prompt.
3. **Prompt templates with fields** (from Prompt Motion): product film, explainer, launch film and showreel, each with fields to fill in and already following the studio rules.
4. **Start a film from a reference link.** Paste an X post or a Prompt Motion link, and Claude makes our branded version of it.

## Clean-up worth doing

5. **Move old films' music to the new engine** (Tone.js), one at a time after listening, so nothing in-house depends on Strudel. Optional.
6. **Make the preview and the final render draw text exactly the same**, to fix the small difference at letter edges.
7. **Try the new pieces with real use.** So far each has only been tested with stand-ins:
   - the mic in English and Hindi, with a real voice;
   - a first SpendOS product film with the borrowed skills;
   - a real reel take;
   - Codex, once it's installed (`npm install --global @openai/codex`, then `codex login`);
   - PowerPoint slides with LibreOffice (`brew install --cask libreoffice`);
   - the studio's MCP server in Claude Desktop or Cursor.

## Only when we decide to sell

8. **Turn off the GPL ffmpeg part of the Rust engine** (fframes' `libav-agree-gpl`), or drop that engine from the product.
9. **Put API key setup on the product's home page**, so a new user can paste a key first.
10. **Take out the Aerchain material.** Kept for now, at the owner's call.
11. **Smaller selling leftovers:**
    - the sample `studio/hyperframes/aerchain-bands` still loads GSAP;
    - skill updates overwrite the "In Motion Studio" notes;
    - run `STUDIO_EDITION=product npm run licences` again;
    - run `cargo fetch` so the Rust engine's crates are in the licence check;
    - test the product edition from start to finish.
12. **The owner's own tasks:**
    - a Remotion company licence once we're past 3 people;
    - a PikaIcons team licence, only if we use paid icons;
    - a lawyer's review.

## Small leftovers, the owner's

- One-time Google sign-in setup for saving to Drive.
- Delete the test repo `moreshruti/aerchain-motion-library-test` on GitHub.
- Delete the merged `v2-speaker-post` branch.
