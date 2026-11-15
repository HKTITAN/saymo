// Cuts a team member out of a photo, for the team post's orange tiles. Crops
// a square and turns it black and white toned to the palette (black to ink,
// white to stone). A photo already cut out (some pixels fully transparent)
// keeps its own edges; any other needs a flat background, which is removed:
// every pixel near the corner colour that touches the edge of the square.
// The orange comes from the tile behind it on the post.
//
// usage: node scripts/team-photo.mjs <input> <name> <left> <top> <crop>
// Every photo is framed the same way: the head (top of the hair to the
// neck) about 54% of the square's height, 11% of it free above the head,
// and the body running edge to edge across the bottom (so no orange shows
// beside the shoulders): the face is centred where the body allows, or moved
// sideways as little as it takes. The four made so far:
//   node scripts/team-photo.mjs assets/speakers/darshan-kadam.png darshan-kadam 58 22 302
//   node scripts/team-photo.mjs assets/speakers/suket-seth.png suket-seth 27 -20 222
//   node scripts/team-photo.mjs assets/speakers/amit-sahu.png amit-sahu 15 1 204
//   node scripts/team-photo.mjs assets/speakers/harshit-manaktala.png harshit-manaktala 5 -6 215
//   node scripts/team-photo.mjs assets/speakers/kartik-malik.png kartik-malik 1 140 1880 match
//
// Writes public/team/<name>-200.png and <name>-400.png (1x and 2x).

import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const TILE = 200; // tile size on the 1920 x 1080 post: TEAM_PHOTO in team.tsx
const TOLERANCE = 7; // how far from the background grey still counts as background
const INK = [0x14, 0x14, 0x14];
const STONE = [0xe9, 0xe5, 0xdd];

const [, , input, name, left, top, crop, match] = process.argv;
// `match` as a sixth argument brings a photo's tones in line with the rest
// of the team: its brightness (mean grey) and contrast (spread of greys) are
// moved to these, measured across the first four photos.
const TEAM_TONE = { mean: 97, spread: 77 };
if (!input || !name) {
  console.error("usage: node scripts/team-photo.mjs <input> <name> <left> <top> <crop>");
  process.exit(1);
}
const box = { left: Number(left), top: Number(top), width: Number(crop), height: Number(crop) };
// A negative top leaves room above a head that sits at the very top of a
// cut-out photo: the photo is padded with transparency there.
const above = Math.max(0, -box.top);
box.top += above;
const source = await sharp(input)
  .ensureAlpha()
  .extend({ top: above, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();

await mkdir("public/team", { recursive: true });

const src = await sharp(source).extract(box).raw().toBuffer();
let cutOut = false;
for (let i = 3; i < src.length; i += 4) if (src[i] === 0) cutOut = true;

// Cut-outs often end in a see-through row or column at the photo's edge.
// Wherever the photo is solid a few pixels in from the bottom or a side,
// the edge is filled from there, so no thin line of the tile shows through.
// Where it is see-through further in too (round a shoulder), it stays so.
const BAND = 6;
const n = box.width;
const at = (x, y) => (y * n + x) * 4;
if (cutOut) {
  for (let e = 0; e < n; e++) {
    for (const [edge, inward] of [
      [(d) => at(e, n - 1 - d), at(e, n - 1 - BAND)], // bottom
      [(d) => at(d, e), at(BAND, e)], // left
      [(d) => at(n - 1 - d, e), at(n - 1 - BAND, e)], // right
    ]) {
      if (src[inward + 3] < 250) continue;
      for (let d = 0; d < BAND; d++) {
        const i = edge(d);
        if (src[i + 3] < 250) for (let k = 0; k < 4; k++) src[i + k] = src[inward + k];
      }
    }
  }
}
const fixed = () => sharp(src, { raw: { width: n, height: n, channels: 4 } });

for (const scale of [1, 2]) {
  const size = TILE * scale;
  // A light blur against the photo's dot screen (moire). sharp blurs after
  // the resize, so it is capped: a big photo shrunk a long way would
  // otherwise come out soft.
  const sigma = box.width / size > 1 ? Math.min(0.6, 0.55 * (box.width / size)) : 0;
  // The crop's edges are stretched outwards before the blur and resize and
  // trimmed off after, so where the person runs off the square (shoulders,
  // the bottom edge) the edge stays solid and the orange tile behind does
  // not show through as a thin line.
  const pad = 12;
  const big = Math.round(((box.width + 2 * pad) * size) / box.width);
  const inset = Math.round((big - size) / 2);
  let img = sharp(
    await fixed()
      .extend({ top: pad, bottom: pad, left: pad, right: pad, extendWith: "copy" })
      .png()
      .toBuffer(),
  );
  if (sigma > 0.3) img = img.blur(sigma);
  const px = await sharp(await img.resize(big, big, { kernel: "lanczos3" }).png().toBuffer())
    .extract({ left: inset, top: inset, width: size, height: size })
    .raw()
    .toBuffer();
  const g = (i) => 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];

  let alpha;
  if (cutOut) {
    alpha = (i) => px[i * 4 + 3];
  } else {
    // Flood the background in from the edges.
    const bg = g(0);
    const mask = new Uint8Array(size * size); // 255 = background
    const stack = [];
    for (let i = 0; i < size; i++) stack.push(i, (size - 1) * size + i, i * size, i * size + size - 1);
    while (stack.length) {
      const p = stack.pop();
      if (mask[p] || Math.abs(g(p) - bg) > TOLERANCE) continue;
      mask[p] = 255;
      const x = p % size;
      if (p >= size) stack.push(p - size);
      if (p < size * (size - 1)) stack.push(p + size);
      if (x > 0) stack.push(p - 1);
      if (x < size - 1) stack.push(p + 1);
    }
    // A slight feather so the cut edge is not stair-stepped.
    const soft = await sharp(Buffer.from(mask), { raw: { width: size, height: size, channels: 1 } })
      .blur(0.6 * scale)
      .raw()
      .toBuffer();
    const softCh = soft.length / (size * size);
    alpha = (i) => 255 - soft[i * softCh];
  }

  // Tone matching, over the person's pixels only.
  let tone = (v) => v;
  if (match === "match") {
    const vals = [];
    for (let i = 0; i < size * size; i++) if (alpha(i) > 200) vals.push(g(i));
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const spread = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    tone = (v) => Math.max(0, Math.min(255, (v - mean) * (TEAM_TONE.spread / spread) + TEAM_TONE.mean));
  }

  const rgba = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const t = Math.min(1, tone(g(i)) / 255);
    for (let k = 0; k < 3; k++) rgba[i * 4 + k] = Math.round(INK[k] + (STONE[k] - INK[k]) * t);
    rgba[i * 4 + 3] = alpha(i);
  }
  const file = `public/team/${name}-${size}.png`;
  await sharp(rgba, { raw: { width: size, height: size, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(file);
  console.log(file);
}
