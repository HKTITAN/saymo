# The post tool

Open http://localhost:3200/tool. Every post made there is listed with a live
thumbnail; **New post** starts the next speaker for the same event (headline,
date, place and landmark kept, speaker cleared), and each card's menu
duplicates or deletes it. Open a post to edit it:

- **Animation**: pick one of four (or press 1 to 4). Each tile plays when the
  pointer is over it, and the post's preview and video use the one picked.
  1 **Scenes** is the sample post's animation; 2 **Burst** makes every
  change of colour the stepped circle; 3 **Tide** is calm and orange only, a
  staircase that rolls in, breathes and rolls out; 4 **Signal** thinks,
  decides and acts: lines search, settle into steps, then fire across.
- **Headline**: one line per row. A line too long for the stone panel
  shrinks the whole headline to fit.
- **Speaker**: drop in any photo. The face is framed as on the sample
  post and the background is made the same plain grey (switch that off to
  keep the photo's own). Drag the square or zoom to change the crop.
- **Date and time**: pick the dates and time, and the two lines are written
  with the right weekdays; you can still type over them.
- **Location**: two lines. Under them, each of their words is a button: tap
  the ones to set in orange on the post, like the city.
- **Landmark**: type a city or a landmark under **Make one with AI** ("Dubai")
  and it is made in the same black and white style as the towers, cut out and
  ready, in about 20 seconds; every try is kept under **Earlier tries** to
  switch back to. Or drop in a photo of the place: its background is removed
  with the Mac's own background remover (the one behind Finder's Remove
  Background), and a PNG that is already cut out keeps its own edges. Place
  it with the sliders, or drag it in the preview and pinch to resize.

Everything saves as you type. **Make 4K video** renders the post exactly as
`npm run export` does (about 4 minutes), then **Download** offers the video
and the still, each in 4K and 1080p. Anything that still does not fit, like
a location line running into the line panel, is listed under the preview.

Making landmarks with AI goes through Vercel's AI Gateway with Google's
Nano Banana 2.1 model (`src/lib/tool/generate.ts`): the original towers go
along as the style example on a magenta screen, and the answer comes back on
the same screen, which is keyed out. It needs `AI_GATEWAY_API_KEY` in
`.env.local` (git ignores it) and a card on the Vercel account, which unlocks
Vercel's free monthly AI credit. Each picture costs about 4 cents. To make a
new key: `vercel ai-gateway api-keys create --limit 5 --refresh-period monthly`.

The sample post ([speaker-post.md](speaker-post.md)) is untouched by the tool: the tool starts with a
copy of it. Posts live in `posts/<id>/` (the words in `post.json`, plus the
photos, image and videos), which git ignores; deleting the folder starts
the tool afresh. The background remover is compiled from
`scripts/native/vision.swift` the first time it is needed, which takes a moment.
