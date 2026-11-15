// Cuts a landmark out of a photo for the post's line panel. A PNG that is
// already cut out, on a transparent background, keeps its own edges. Any other
// photo needs a flat background: its colour is read from the top-left pixel,
// and every large area of that colour is removed (including sky enclosed
// between buildings). The photo is toned to the palette, black to the panel's
// ink and white to stone, and stood on the bottom edge of the line panel,
// centred, with its tallest point at a chosen height.
//
// usage: node scripts/post/skyline.mjs <photo> <name> [top] [left right bottom]
//   top                where the tallest point sits, in panel pixels from the
//                      top (default 540, halfway down the post)
//   left right bottom  the part of the photo to keep, in the photo's own
//                      pixels (default: all of it)
// e.g.   node scripts/post/skyline.mjs assets/places/kuala-lumpur-skyline.png kuala-lumpur 65 18 767 860
//        the skyline across the panel's full width, its soft outer edges
//        cropped so the tree line sits flush on the bottom edge
//
// Writes public/places/<name>-920.png and <name>-1840.png (1x and 2x).

import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const [input, name, ...numbers] = process.argv.slice(2);
if (!input || !name) {
  console.log("usage: node scripts/post/skyline.mjs <photo> <name> [top] [left right bottom]");
  process.exit(1);
}

const PANEL_W = 920;
const PANEL_H = 1080;
const INK = [0x14, 0x14, 0x14];
const STONE = [0xe9, 0xe5, 0xdd];
const MIN_SKY = 150; // smaller patches of the background colour stay in the photo

const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const [top = 540, left = 0, right = W, bottom = H] = numbers.map(Number);
const at = (i, k) => data[i * 4 + k];

// Already cut out: some pixels are fully transparent. Its own alpha is the
// mask, lifted so the most solid pixels are fully solid (some editors stop
// at 253, which would let the lines show faintly through the landmark).
let solid = 0;
let clear = 0;
for (let i = 0; i < W * H; i++) {
  solid = Math.max(solid, at(i, 3));
  if (at(i, 3) === 0) clear++;
}
const cutOut = clear > 0;

// Otherwise the background: pixels within a hair of the corner colour, in
// large patches.
const bg = [at(0, 0), at(0, 1), at(0, 2)];
const near = new Uint8Array(W * H);
for (let i = 0; i < W * H && !cutOut; i++) {
  near[i] = bg.every((c, k) => Math.abs(at(i, k) - c) <= 2) ? 1 : 0;
}
const sky = new Uint8Array(W * H);
const seen = new Uint8Array(W * H);
for (let start = 0; start < W * H; start++) {
  if (!near[start] || seen[start]) continue;
  const patch = [];
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const p = stack.pop();
    patch.push(p);
    const x = p % W;
    for (const q of [p - W, p + W, x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1]) {
      if (q >= 0 && q < W * H && near[q] && !seen[q]) {
        seen[q] = 1;
        stack.push(q);
      }
    }
  }
  if (patch.length >= MIN_SKY) for (const p of patch) sky[p] = 1;
}

// Toned cut-out of the kept part, and the row of its tallest point.
const w = right - left;
const h = bottom;
const rgba = Buffer.alloc(w * h * 4);
let tip = h;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = y * W + x + left;
    const o = (y * w + x) * 4;
    const grey = (0.2126 * at(i, 0) + 0.7152 * at(i, 1) + 0.0722 * at(i, 2)) / 255;
    for (let k = 0; k < 3; k++) rgba[o + k] = Math.round(INK[k] + (STONE[k] - INK[k]) * grey);
    const alpha = cutOut ? Math.min(255, Math.round((at(i, 3) * 255) / solid)) : sky[i] ? 0 : 255;
    rgba[o + 3] = alpha;
    if (alpha > 0) tip = Math.min(tip, y);
  }
}

// Tallest point at `top`, the bottom of the kept part on the panel's bottom
// edge, centred across the panel.
const scale = (PANEL_H - top) / (h - tip);
await mkdir("public/places", { recursive: true });
for (const k of [1, 2]) {
  const sw = Math.round(w * scale * k);
  const sh = Math.round(h * scale * k);
  const pw = PANEL_W * k;
  const ph = PANEL_H * k;
  let sized = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
    .resize(sw, sh, { kernel: "lanczos3" })
    .png()
    .toBuffer();
  // Anything wider than the panel is trimmed evenly from both sides, and any
  // empty sky above the panel's top edge is dropped.
  const cut = Math.max(0, Math.round((sw - pw) / 2));
  const over = Math.max(0, sh - ph);
  if (cut || over) {
    sized = await sharp(sized)
      .extract({ left: cut, top: over, width: Math.min(sw, pw), height: sh - over })
      .png()
      .toBuffer();
  }
  const file = `public/places/${name}-${pw}.png`;
  await sharp({ create: { width: pw, height: ph, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: sized, left: Math.max(0, Math.round((pw - sw) / 2)), top: ph - (sh - over) }])
    .png({ compressionLevel: 9 })
    .toFile(file);
  console.log(file);
}
console.log(
  `${cutOut ? "cut out already" : `background ${bg.join(",")}`}, tallest point at row ${tip}, scale ${scale.toFixed(3)}`,
);
