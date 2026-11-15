# Plan: sketch on the frame

Written 2026-11-16. Pause the film, draw on it, and send: Claude gets your marks as a picture over the frame, plus exactly which parts of the film each mark touched, and lines you draw become paths things can move along.

## Why

Point (press P, click) already tells Claude which element you mean, because Saymo films are web pages on the stage and the stage knows every element under the pointer (`src/lib/studio/stage/bridge.ts`). Most motion notes don't fit one click, though: "these three, tighter together", "fly in along this curve", "this gap is too big", "put something here". Drawing says them in a second. Saymo can turn marks into exact parts and real paths because it owns the stage.

## How it works for the person

- **Start:** press S, or the pen button beside Point, on a paused film. The film pauses if it was playing. The cursor becomes a pen, and the panels stay where they are.
- **Draw** in the studio's accent colour. Strokes are smooth and thin out a little as you move faster. There's one pen, no tray of pens.
- **Erase:** hold E and rub to take away area. ⌘Z undoes the last mark while sketching.
- **What happens when you lift the pen:** a closed loop lights the parts it circles, the way Point outlines a hover. An open line shows a soft arrowhead at its end.
- **Escape** leaves sketch mode and keeps the marks.
- **The prompt box** shows a chip, "Sketch at 0:02.40, 3 marks", like the pinned Point chip. Type the note ("make these move along this, slower") and send. The marks clear once sent, and the chip's ✕ clears them without sending.
- **Video edits:** marks over footage name the clip under them (as Point does through `pickFromEdit`), and marks over a graphic name the graphic.

## What Claude receives

Each sketch becomes a `<sketch>` block in the turn message (`src/lib/studio/agent/claude.ts`, beside `<pointed>`), and a picture attached to the message:

```
<sketch>At 2.40 s they drew 3 marks over the film (picture: refs/sketches/3.png).
1. A loop around #title and #subtitle.
2. A line from #logo (start) curving right and down to film pixel (1520, 880) (end): 12 points, film pixels, in order: (310,240) (402,236) …
3. A line under #price, left to right.
"This", "these" and "here" mean the marked parts and places.</sketch>
```

- **Kinds:** a loop selects whatever lies mostly inside it. A line keeps its simplified points (at most 24) in film pixels, its direction, and the parts at its start and end and any it crosses. A short scribble that's neither counts as a mark only, with no parts.
- **The picture:** the frame at that moment with the marks drawn on top, made on the server and saved as `refs/sketches/<n>.png` in the film. Claude reads it like any attached picture.
- **Paths:** the saymo-film skill gets a "Sketches" section. It tells Claude to follow a line as a motion path (CSS `offset-path` or a Motion keyframe path in HTML films, an interpolated path in Remotion), keeping its shape and direction scaled to the film. It treats a loop as a group, and the picture as what the person saw.

## The pieces

1. **The sketch itself:** `src/lib/studio/films/sketch.ts` holds plain types and maths that both the page and the checks share:
   - `Stroke` (points in film pixels, with time)
   - `simplify` (Ramer-Douglas-Peucker down to 24 points)
   - `smooth` (Catmull-Rom for drawing)
   - `classify` (loop, line or mark: a closed loop is one whose ends meet within 6% of its length and that encloses real area)
   - `inside` (point in polygon)
   - `describe` (the `<sketch>` text)
2. **Asking the stage what's under the marks:** a new stage message, `{ type: "studio:hit-test"; strokes }` in `contract.ts`. The bridge samples each line every 12 film pixels with `elementsFromPoint`, using the same picking rule Point uses (`[id],[data-hf-id]` for HTML films, `[data-part]` for React). For loops it collects the elements whose box is mostly inside. It answers `{ type: "studio:hits"; hits: Picked[][] }`.
3. **The overlay:** `src/components/studio/film/sketch.tsx` is a canvas laid exactly over the stage at the film's scale, drawn in screen pixels and stored in film pixels. It handles the pen, eraser, undo inside sketching, the soft arrowhead and the loop highlight. It follows the studio's DialKit style, with a PikaIcons pen icon for the button.
4. **Wiring it in:** `studio.tsx` adds the S key and a `sketch` state beside `pinned`. `ChatContext` (`contract.ts`) gains `sketch?: SketchContext`, holding the time, the strokes and their hits. The chat sends it with the prompt.
5. **The picture:** a new route, `POST /api/studio/films/<id>/sketch`, takes the strokes and returns an attachment. It draws the frame at that moment with the same headless Chrome capture renders use (`captureHtml` in `scripts/studio/render.mjs`, for HTML and React films), lays the marks on it as SVG with `sharp`, and saves `refs/sketches/<n>.png`. Rust films get the marks on the film's last poster instead.
6. **Claude's side:** the `<sketch>` block in `userMessage`, and the "Sketches" section in `.claude/skills/saymo-film/SKILL.md` and `saymo-video-edit`.

## Status

Built on 2026-11-16, steps 1 to 5. Steps 1, 2 and 4 were checked headless on a real film: a loop came back as `#headline`, and the picture had the marks laid over the frame correctly. The overlay and the chip pass the type check and the build, but haven't been tried by hand yet, and no live Claude turn has been run with a sketch. Erasing removes whole marks, not part of one.

## Build order

Each step passes `npx tsc --noEmit`, `npm run lint` and `npm run build`.

1. **The maths and its checks.** `sketch.ts`, plus `scripts/studio/sketch-check.mjs` with checks run without a browser:
   - simplifying keeps corners
   - a circle reads as a loop, a C shape doesn't, and a scribble is a mark
   - point in polygon works
   - `describe` writes the block above
2. **The stage answers what's under the marks.** The hit-test message in `bridge.ts`, checked on a starter film from a Node script with Playwright: a loop around a known element names it.
3. **The overlay and the chip.** Drawing, erasing, undo, the arrowhead and the loop highlight, the S key, and the prompt-box chip. Sending includes the sketch in the chat context.
4. **The picture.** The sketch route, the frame capture and the composite. Check that `refs/sketches/<n>.png` shows the frame with the marks in the right places.
5. **Claude uses it.** The `<sketch>` block and the skill sections. Check on a copy of a film: circling two titles and saying "closer together" changes just those two, and a drawn curve becomes the path an element flies in on.

## Choices made

- **One pen.** A choice of pens is a drawing app's job. Here the marks are notes, so one clear pen and an eraser are enough.
- **Marks are sent once, then cleared.** The sketch lives with the message that carried it, and the film's history keeps it in `refs/sketches/`, so nothing piles up on the stage.
- **Our own code.** No drawing or annotation library is added. The smoothing and hit-testing are a few hundred lines we own, so the feel stays ours and nothing restricts how Saymo is shared.

## Risks

- **Moving films:** an element can be somewhere else a moment later. The sketch is tied to the moment it was drawn at, and the block says so.
- **Busy frames:** a loop can catch a full-frame background. Elements covering more than 80% of the frame are left out of a loop's selection unless nothing else is inside it.
- **Rust films:** they have no elements to name, so a sketch there is the picture and the paths only. The block says so.
