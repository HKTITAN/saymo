# Plan: the words are the timeline

Written 2026-11-16. The first step of Saymo's own reel workflow (see the roadmap). Everything later, such as recording against the script, the beat sheet, cutting to the music and Try 3 for edits, builds on this.

## The idea

In a talking-head reel the story lives in the words; time only follows from them. So every cut, caption fix, graphic and sound hit should hang on a word, not on a time in seconds. Trim a sentence and everything attached to the rest moves with it, so nothing drifts. You or Claude say which words to keep, and code works out the seconds.

## What happens today

A video film's `edit.json` (`src/lib/studio/films/edit.ts`) is all seconds:

- A clip is `start` on the film plus `from`/`to` in the source file.
- A graphic is `start` and `duration` on the film.
- Captions are a copy of the transcript words moved to film time (`captionsFromClips` in `src/components/studio/video/edit-ops.ts`).
- Sound hits in `sound/score.js` sit on film times, guided by marks.

That causes four problems:

1. **Drift.** Cut two seconds early in the film and every graphic after the cut is now two seconds late, on the wrong words. Claude or you have to move each one by hand.
2. **Lost caption fixes.** Fixing a misheard word edits the copy. Rebuilding captions after a cut makes a fresh copy from the transcript, and the fix is gone.
3. **Claude cuts by guessing seconds.** It reads timed lines from the media tool, then writes `from`/`to` by hand, so a cut can clip the start of a word or leave a breath in.
4. **Sound falls out of sync** whenever the edit changes, until someone moves the hits.

## The design

### 1. A word is the anchor

A word in a transcript gets a stable address: `WordRef = "<mediaId>:<index>"` (index in that media's `transcript.json`). Transcripts are in source time and don't change when the edit changes, so the address survives every cut, move and speed change.

If a file is transcribed again, word indices can shift. The studio keeps the old transcript beside the new one for that moment, and each anchor moves to the new word that overlaps its old time most. An anchor that can't be placed is reported, never silently dropped.

### 2. Items can hang on words

`edit.json` becomes version 2. Everything from version 1 still works, since an item without an anchor keeps its seconds.

```ts
type Anchor = {
  word: WordRef;
  edge?: "start" | "end"; // which edge of the word; default "start"
  offset?: number; // seconds after that edge, may be negative; default 0
};

type Graphic = {
  // ...as today, plus:
  at?: Anchor; // where it starts
  until?: Anchor; // where it ends (else `duration` from `at`)
};

type Edit = {
  version: 2;
  // ...as today, plus:
  captions: {
    // ...as today, plus:
    fixes: Record<WordRef, { text?: string; hit?: boolean; hidden?: boolean }>;
  };
  marks: { label: string; at: Anchor }[]; // named moments the score lands on
};
```

Clips keep `from`/`to` in source seconds, which is already word-friendly: a word belongs to whichever clip plays its middle, as captions do today.

### 3. One resolver turns anchors into seconds

`resolveEdit(edit, transcripts)` goes in `src/lib/studio/films/anchors.ts`. It's plain TypeScript with no `@/` imports, so Node scripts can use it, as with `captions.ts`.

- For each anchor, it finds the clip that plays that word (the topmost visible video track first, then the earliest). It converts the word's source time to film time with `filmTime()` from `captions.ts`, which already handles speed.
- It fills in each anchored graphic's `start` and `duration`, builds the caption words with `fixes` applied, and turns `marks` into film times for the score.
- If a word was cut out of the film, the item moves to the nearest word that's still in, and the resolver returns a note ("The title now starts on 'launch' because 'today' was cut"). The note shows in the chat and Claude reads it.

Everything that plays or renders reads the resolved edit, so the Remotion composition in `studio/starters/video/` doesn't change. It's called in four places:

- `edit-store.ts`, when an edit is saved
- the timeline, live as you drag
- `render.mjs`, before a render
- `check-film.mjs`, which also fails on anchors pointing at words that don't exist

### 4. Cuts made from words, placed in the silence

`cutWords(edit, transcripts, peaks, refs)` goes in `anchors.ts`. It removes the words you name and closes the gap.

- **Where the cut goes:** in the middle of the silence between the last kept word and the first cut one, read from the media's `peaks.json` (100 loudness samples a second). It stays at least 40 ms clear of each word's edges.
- **No silence?** If the gap is shorter than 60 ms, it cuts right at the word boundary with a 10 ms fade, so there's no click.
- **Keeping a pause:** "keep the pause after 'machine'" keeps the silence up to the next word instead of halving it.
- **Fillers:** `fillers(words)` marks um, uh, hmm, "you know" and "like" when it stands alone, plus pauses over 0.8 s, so they can be cut together.

### 5. Claude works in words

- **Numbered words:** `media-tool.mjs words` lists each line with its words numbered (`12 machine`), the clip they're in, and where the silences are.
- **New commands:** `media-tool.mjs cut <film> <media> 12-18 [--keep-pause]` and `media-tool.mjs fillers <film>` make word cuts through `cutWords`, write `edit.json` and print what changed in words ("Cut 'so, um, basically' (0.9 s)").
- **The video-edit skill changes:** `.claude/skills/saymo-video-edit/SKILL.md` says to pick words by number, anchor every graphic to a word, add `marks` for the beats the score should hit, and never write cut times by hand.
- **Claude's reply names words, not seconds:** "Cut 'so, um, basically'; the title now lands on 'launch'."

### 6. Sound follows the words

For video films, the score reads `marks` from the resolved edit (it's already given the film's marks and speech spans, per `src/lib/studio/sound/sound.ts`). An edit change already re-renders the sound after a moment, so the hits move with the words with no extra work.

### 7. The transcript panel

A new panel, `src/components/studio/video/transcript.tsx`, shows the edit as text:

- **The edit as text:** every word the film plays, in order, and words that were cut appear faded and struck through.
- **Cut and restore:** select words and press Delete to cut them; press Delete on cut words to bring them back.
- **Fillers and pauses:** shown softly highlighted, with one row button to cut them all.
- **Graphics on words:** graphics show as small chips on their words; drag a chip to another word to move it.
- **Fixing a word:** double-click a word to fix it. That writes to `captions.fixes`, so the fix survives every later cut.
- **Kept in step:** clicking a word moves the playhead there, and the panel follows the playhead.

It follows the studio's DialKit style and uses PikaIcons for any icons.

## Build order

Each step ships on its own, keeps version 1 edits working, and passes `npx tsc --noEmit`, `npm run lint` and `npm run build`.

1. **Anchors and the resolver.** Done 2026-11-16: `src/lib/studio/films/anchors.ts`, the types in `edit.ts`, and 25 checks in `scripts/studio/edit-check.mjs`, all passing. Nothing calls it yet; step 2 wires it in. Planned as: types in `edit.ts`, `anchors.ts` with `resolveEdit`, and the transcript remap after re-transcribing. Add `scripts/studio/edit-check.mjs`, checks without a browser like `parts-check.mjs`. It covers anchors across splits, speed changes, cut words, duplicate clips and old edits.
2. **Play and render the resolved edit.** Done 2026-11-16: `edit-file.ts` reads an edit with its words turned into seconds, and the save route, the stage, renders, the sound (with `marks`), Claude's per-message summary and `check-film.mjs` all use it. The timeline places the edit again as you cut, and a graphic you drag or trim by hand stops following its word. Claude sees the notes in its summary and the checker prints them; showing them to the person in the studio waits for step 5. Planned as: Wire `resolveEdit` into `edit-store.ts`, the timeline, `render.mjs` and `check-film.mjs`, and show the resolver's notes in the chat.
3. **Word cuts.** Done 2026-11-16: `src/lib/studio/films/cuts.ts` (`cutWords`, `fillers`, `cutPauses`, `quietest`, and `captionsByWord` so caption fixes follow a cut), the media tool's numbered `words` plus `cut`, `fillers` and `pauses`, Claude's prompt and the video-edit skill, and 15 more checks in `edit-check.mjs` (40 in all). Planned as: `cutWords` and `fillers` with silence snapping, the media tool's `words`, `cut` and `fillers` commands, and the skill update. Check: cut a filler from a real clip and listen for clicks with `scripts/studio/listen.mjs`.
4. **Captions that keep their fixes.** `captions.fixes` replaces editing the copy, and the caption editor on the timeline writes fixes.
5. **The transcript panel** (section 7).
6. **Marks for the score.** `marks` with anchors, and the sound skill tells Claude to hit marks by label.

## Choices made

- **Anchors point at transcript words, not clips.** Clip ids change on every split, but words don't.
- **Seconds stay in `edit.json` alongside the anchors**, filled in by the resolver, so the composition, old edits and anything reading the file keep working.
- **No new format for motion films.** They have no transcript; their marks stay in seconds. The beat sheet (roadmap step 3) brings words to them later through the script.

## Risks

- **The same footage used twice** (a clip duplicated or split and moved): one word can play in two places. The resolver picks the topmost, earliest clip, and an anchor can name a clip to pin it (`clip?: string` on `Anchor`).
- **Transcripts that are wrong in time:** whisper's word times can be off by up to a tenth of a second. Silence snapping uses the real loudness from `peaks.json`, not the word times, so cuts land in real gaps.
- **Footage without speech** (b-roll, music): nothing to anchor to, so items stay in seconds, as today.
