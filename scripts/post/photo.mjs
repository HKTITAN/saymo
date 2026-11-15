// Crops a speaker photo to the square tile used on the post and writes it
// at 1x (export) and 2x (screen) sizes.
//
// usage: node scripts/post/photo.mjs <input> <name> <left> <top> <crop>
// e.g.   node scripts/post/photo.mjs ~/Pictures/alex.png alex-morgan 23 10 331

import sharp from "sharp";

const TILE = 240; // tile size on the 1920 x 1080 post: PHOTO in post.tsx

const [, , input, name, left, top, crop] = process.argv;
if (!input || !name) {
  console.error("usage: node scripts/post/photo.mjs <input> <name> <left> <top> <crop>");
  process.exit(1);
}

const box = { left: Number(left), top: Number(top), width: Number(crop), height: Number(crop) };

for (const scale of [1, 2]) {
  const size = TILE * scale;
  // A light blur before shrinking keeps the photo's fine dot screen from
  // beating against the pixel grid (moire) once it is scaled down.
  const sigma = (box.width / size) > 1 ? 0.55 * (box.width / size) : 0;
  let img = sharp(input).extract(box).greyscale();
  if (sigma > 0.3) img = img.blur(sigma);
  await img
    .resize(size, size, { kernel: "lanczos3" })
    .png({ compressionLevel: 9 })
    .toFile(`public/speakers/${name}-${size}.png`);
  console.log(`public/speakers/${name}-${size}.png`);
}
