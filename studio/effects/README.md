# Effect previews

One scene per effect on the studio's Effects page (`src/lib/studio/films/effects.ts`
lists them). `/api/studio/effects/<id>` loads the effect's part files from
`studio/starters/html/assets/parts/`, then `<id>.js`, on a dark 1920 by 1080
stage. Each scene sets `window.preview = (stage) => ({ duration, still, parts })`:
`parts` are the parts it made, `still` is the moment shown at rest, and the
scene plays from 0 while the pointer is over its tile.
