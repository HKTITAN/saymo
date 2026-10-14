# Aerchain speaker post

An animated speaker post in black, orange and stone: the headline and speaker on
stone at the left, and a staircase of scanlines on the right that moves.
Built for Darshan Kadam's SpendOS talk; set up so the next speaker is a quick swap.

## See it

```bash
npm run dev
```

Then open http://localhost:3200. The toolbar has two versions of the post:

1. **Version 1**: the lines on their own.
2. **Version 2**: the same post and motion, with Kuala Lumpur's Petronas
   Towers rising from the bottom edge of the line panel, their tips halfway
   up the post. The lines keep moving behind them.

And four motions:

1. **Scenes** (the main one): after the Solvd reference video. The panel moves
   between black, orange and stone in stepped wipes: an orange staircase rises,
   stone sweeps down from the top, an orange pixel circle bursts out of the
   right edge, then black slides back in from the middle. The logo changes
   colour line by line as each wipe passes behind it, and the orange "ai" flips.
2. **Climb**: the steps reach out one after another, lowest first.
3. **Breathe**: one slow wave runs up the staircase.
4. **Signal**: thinks, decides, acts. The lines cool to stone and search, lock
   back onto the steps in orange from the bottom up, then the top step fires
   across the panel.

Space pauses, keys 1 to 4 switch the motion, V switches the version.
**Download 4K** at the end of the toolbar saves the version and motion you are
watching as a 3840 x 2160 video (it serves the file made by `npm run export`,
so export first).

## Export

```bash
npm run export                    # both versions, every motion
npm run export -- skyline         # version 2 only
npm run export -- original scenes # version 1, one motion
```

Files land in `export/`, each in 4K and in 1080p. Version 2's files have
`-skyline` after the name.

- `aerchain-speaker-<name>-4k.png` and `aerchain-speaker-<name>.png`: the still
  (the rising staircase), 3840 x 2160 and 1920 x 1080
- `aerchain-speaker-<name>-<motion>-4k.mp4` and `aerchain-speaker-<name>-<motion>.mp4`:
  3840 x 2160 and 1920 x 1080, 60 fps, the loop played twice, opening on the
  still frame so the thumbnail is the design

Every frame is rendered one by one at 4K, so the videos are smooth and loop
cleanly; the 1080p files are the same frames at half size. A full export takes
about ten minutes. It uses Google Chrome, which is already on this Mac.

## Make the next speaker post

1. Put the photo in `assets/speakers/`.
2. Make the square tile (numbers are the crop's left, top and size in the
   original photo's pixels):
   ```bash
   node scripts/photo.mjs assets/speakers/jane-doe.png jane-doe 20 10 330
   ```
3. For version 2, put a landmark photo with a flat, single-colour sky in
   `assets/places/` and cut it out (the sky colour is read from the top-left
   corner). The numbers are where the tallest point sits (540 is halfway down
   the post), then the part of the photo to keep: its left, right and bottom
   edges in the photo's own pixels. Kuala Lumpur was made with:
   ```bash
   node scripts/skyline.mjs assets/places/kuala-lumpur.png kuala-lumpur 540 167 434 600
   ```
   The bigger the photo, the sharper it is in 4K.
4. Edit `src/content/post.ts`: headline lines, name, role, company, photo
   paths, the landmark's name and files, and the slug used for file names.
5. `npm run export`.

## Where things are

- `src/content/post.ts`: the words, the photo and the landmark
- `src/components/post/post.tsx`: layout of the post
- `src/components/post/versions.ts`: the two versions
- `src/components/post/lines.ts`: the scanlines, the four motions and the logo animation
- `src/components/post/palette.ts`: black, orange and stone
- `src/components/post/wordmark-paths.ts`: the Aerchain wordmark (from `assets/brand/aerchain-wordmark.svg`)
- `src/app/download/[version]/[motion]/route.ts`: hands the 4K video to the Download 4K button
- `scripts/export.mjs`, `scripts/photo.mjs`, `scripts/skyline.mjs`: export, speaker photo, landmark cut-out
- `assets/places/`: the original landmark photos
- `assets/reference/`: the line texture, the layout reference and the reference video
