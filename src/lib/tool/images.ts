import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import type { Crop } from "./doc";
import { type Face, findFace, removeBackground } from "./vision";

// The tool's photo and image treatments, the same looks as scripts/post/photo.mjs
// and scripts/post/skyline.mjs, made on upload instead of on the command line.

const run = promisify(execFile);

// Pictures sharp cannot open, like an iPhone's HEIC photos, are turned into
// JPEG first by `sips`, which comes with macOS.
async function readable(upload: Buffer) {
  const meta = await sharp(upload)
    .metadata()
    .catch(() => null);
  if (meta && !(meta.format === "heif" && meta.compression === "hevc")) return upload;
  const tmp = await mkdtemp(path.join(os.tmpdir(), "speaker-post-"));
  try {
    await writeFile(path.join(tmp, "upload"), upload);
    await run("sips", ["-s", "format", "jpeg", path.join(tmp, "upload"), "--out", path.join(tmp, "upload.jpg")]);
    return await readFile(path.join(tmp, "upload.jpg"));
  } catch {
    throw new Error("That file could not be opened as a picture. Try a JPG or PNG.");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

const TILE = 240; // the speaker photo on the post: PHOTO in post.tsx
const BACKDROP = "#454545"; // the studio grey behind the original speaker photo
const PANEL_W = 920; // the line panel, as in lines.ts
const PANEL_H = 1080;
const INK = [0x14, 0x14, 0x14];
const STONE = [0xe9, 0xe5, 0xdd];

// ---------------------------------------------------------------------------
// Speaker photo

// Photos are kept at up to 2000px, plenty for a 480px tile cropped tight.
const PHOTO_MAX = 2000;

export async function savePhoto(dir: string, upload: Buffer) {
  const { data, info } = await sharp(await readable(upload))
    .rotate()
    .resize({ width: PHOTO_MAX, height: PHOTO_MAX, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });
  const source = path.join(dir, "photo-source.png");
  await writeFile(source, data);
  await rm(path.join(dir, "photo-plain.png"), { force: true });
  // A small copy to crop on in the browser.
  await sharp(data)
    .flatten({ background: BACKDROP })
    .resize({ width: 720, height: 720, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toFile(path.join(dir, "photo-preview.jpg"));
  const face = await findFace(source);
  return { width: info.width, height: info.height, crop: cropAround(info.width, info.height, face) };
}

export function clampCrop(crop: Crop, width: number, height: number): Crop {
  const size = Math.round(Math.min(Math.max(crop.size, 48), width, height));
  return {
    x: Math.round(Math.min(Math.max(crop.x, 0), width - size)),
    y: Math.round(Math.min(Math.max(crop.y, 0), height - size)),
    size,
  };
}

// Frames the face as the original speaker tile does: the face is 41% of the
// tile's width, centred, with its top a third of the way down.
function cropAround(width: number, height: number, face: Face | null): Crop {
  if (!face) {
    const size = Math.min(width, height);
    return clampCrop({ x: (width - size) / 2, y: height > width ? (height - size) * 0.15 : 0, size }, width, height);
  }
  const size = face.width / 0.414;
  return clampCrop(
    { x: face.x + face.width / 2 - size / 2, y: face.y - 0.33 * size, size },
    width,
    height,
  );
}

// Writes photo-240.png and photo-480.png. With `plain`, the background is
// first swapped for the studio grey; returns false if that was not possible.
export async function bakePhoto(dir: string, crop: Crop, plain: boolean) {
  let input = path.join(dir, "photo-source.png");
  let madePlain = false;
  if (plain) {
    const lifted = path.join(dir, "photo-plain.png");
    const ready = (await stat(lifted).catch(() => null)) !== null;
    if (ready || (await removeBackground(input, lifted)) === "done") {
      input = lifted;
      madePlain = true;
    }
  }
  const flat = await sharp(input).flatten({ background: BACKDROP }).png().toBuffer();
  const box = { left: crop.x, top: crop.y, width: crop.size, height: crop.size };
  for (const scale of [1, 2]) {
    const size = TILE * scale;
    // A light blur before shrinking keeps a photo's fine dot screen from
    // beating against the pixel grid (moire), as in scripts/post/photo.mjs.
    const sigma = box.width / size > 1 ? 0.55 * (box.width / size) : 0;
    let img = sharp(flat).extract(box).greyscale();
    if (sigma > 0.3) img = img.blur(sigma);
    await img
      .resize(size, size, { kernel: "lanczos3" })
      .png({ compressionLevel: 9 })
      .toFile(path.join(dir, `photo-${size}.png`));
  }
  return madePlain;
}

// ---------------------------------------------------------------------------
// Landmark image

// Kept at up to 3000px, so it stays sharp in 4K even when made bigger.
const IMAGE_MAX = 3000;
const MIN_SKY = 150; // smaller patches of the background colour stay in

// Cuts the landmark out, tones it to the palette (black to ink, white to
// stone) and trims it to its edges. Returns its size at 100%: as big as fits
// the panel's width and four fifths of its height.
export async function saveImage(dir: string, upload: Buffer) {
  const { data, info } = await sharp(await readable(upload))
    .rotate()
    .resize({ width: IMAGE_MAX, height: IMAGE_MAX, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const source = path.join(dir, "image-source.png");
  await sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toFile(source);

  let rgba: Buffer = data;
  let note: string;
  if (transparentShare(data) > 0.01) {
    note = "Kept the image's own transparent background.";
  } else if (keyScreen(data, W, H)) {
    note = "Keyed out the magenta screen.";
  } else if (keyFlatBackground(data, W, H)) {
    note = "Removed the plain background.";
  } else {
    const lifted = path.join(dir, "image-lifted.png");
    const result = await removeBackground(source, lifted);
    if (result === "done") {
      rgba = await sharp(lifted).resize(W, H, { fit: "fill" }).ensureAlpha().raw().toBuffer();
      note = "Removed the background automatically.";
    } else {
      note =
        result === "no-subject"
          ? "Could not find a landmark to cut out, so the whole photo is used."
          : "Background removal is not available on this Mac, so the whole photo is used.";
    }
  }

  const box = tone(rgba, W, H);
  if (!box) throw new Error("Nothing was left after removing the background.");
  await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .extract(box)
    .png({ compressionLevel: 6 })
    .toFile(path.join(dir, "image.png"));

  const fit = Math.min(PANEL_W / box.width, (PANEL_H * 0.8) / box.height);
  const round = (v: number) => Math.round(v * 100) / 100;
  return { width: round(box.width * fit), height: round(box.height * fit), note };
}

function transparentShare(rgba: Buffer) {
  let clear = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] === 0) clear++;
  return clear / (rgba.length / 4);
}

// A magenta screen, as the landmarks made with AI come on (generate.ts).
// Each pixel is as solid as it is far from the screen colour, and soft
// edges are unmixed from it, so no magenta fringe is left on the grey.
function keyScreen(rgba: Buffer, W: number, H: number) {
  // The screen colour: the median along the top edge and down the sides.
  const at = (x: number, y: number) => (Math.round(y) * W + x) * 4;
  const edge: number[] = [];
  for (let x = 0; x < W; x += 4) edge.push(at(x, 0));
  for (let y = 0; y < H * 0.6; y += 4) edge.push(at(0, y), at(W - 1, y));
  const median = (k: number) => edge.map((o) => rgba[o + k]).sort((a, b) => a - b)[edge.length >> 1];
  const screen = [median(0), median(1), median(2)];
  if (!(screen[0] > 170 && screen[2] > 170 && screen[1] < 110)) return false;

  const reach = Math.min(screen[0], screen[2]) - screen[1];
  for (let o = 0; o < rgba.length; o += 4) {
    const spill = Math.min(rgba[o], rgba[o + 2]) - rgba[o + 1];
    let a = 1 - spill / reach;
    a = a < 0.06 ? 0 : a > 0.94 ? 1 : a;
    if (a === 0) {
      rgba[o + 3] = 0;
      continue;
    }
    // pixel = a x landmark + (1 - a) x screen, and the landmark is grey;
    // green carries the least of the screen, so it gives the grey back.
    const grey = Math.round(Math.min(255, Math.max(0, (rgba[o + 1] - (1 - a) * screen[1]) / a)));
    rgba[o] = rgba[o + 1] = rgba[o + 2] = grey;
    rgba[o + 3] = Math.round(rgba[o + 3] * a);
  }
  return true;
}

// A flat background, as in scripts/post/skyline.mjs: its colour is read from the
// top-left pixel, and every large patch within a hair of it is cleared
// (sky enclosed between buildings included). Only counts when that clears
// at least a tenth of the photo.
function keyFlatBackground(rgba: Buffer, W: number, H: number) {
  const bg = [rgba[0], rgba[1], rgba[2]];
  const near = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    near[i] = bg.every((c, k) => Math.abs(rgba[i * 4 + k] - c) <= 2) ? 1 : 0;
  }
  const sky = new Uint8Array(W * H);
  const seen = new Uint8Array(W * H);
  let cleared = 0;
  for (let start = 0; start < W * H; start++) {
    if (!near[start] || seen[start]) continue;
    const patch = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      patch.push(p);
      const x = p % W;
      for (const q of [p - W, p + W, x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1]) {
        if (q >= 0 && q < W * H && near[q] && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (patch.length >= MIN_SKY) {
      for (const p of patch) sky[p] = 1;
      cleared += patch.length;
    }
  }
  if (cleared < W * H * 0.1) return false;
  for (let i = 0; i < W * H; i++) if (sky[i]) rgba[i * 4 + 3] = 0;
  return true;
}

// Tones the cut-out in place and returns the box around its solid part.
// Greys are stretched so the landmark spans ink to stone whatever the
// photo's exposure, and the most solid pixels are made fully solid (some
// editors stop at 253, which would let the lines show faintly through).
function tone(rgba: Buffer, W: number, H: number) {
  const grey = (i: number) =>
    (0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) / 255;

  const histogram = new Uint32Array(256);
  let solid = 0;
  let counted = 0;
  for (let i = 0; i < W * H; i++) {
    const a = rgba[i * 4 + 3];
    solid = Math.max(solid, a);
    if (a >= 128) {
      histogram[Math.round(grey(i) * 255)]++;
      counted++;
    }
  }
  if (!counted) return null;
  const percentile = (share: number) => {
    let sum = 0;
    for (let v = 0; v < 256; v++) {
      sum += histogram[v];
      if (sum >= counted * share) return v / 255;
    }
    return 1;
  };
  let lo = percentile(0.005);
  let hi = percentile(0.995);
  if (hi - lo < 0.1) [lo, hi] = [0, 1];

  let top = H;
  let left = W;
  let bottom = -1;
  let right = -1;
  for (let i = 0; i < W * H; i++) {
    const t = Math.min(1, Math.max(0, (grey(i) - lo) / (hi - lo)));
    for (let k = 0; k < 3; k++) rgba[i * 4 + k] = Math.round(INK[k] + (STONE[k] - INK[k]) * t);
    const a = Math.min(255, Math.round((rgba[i * 4 + 3] * 255) / solid));
    rgba[i * 4 + 3] = a;
    // The box follows the solid part, so a soft fringe never lifts the
    // landmark off the panel's bottom edge.
    if (a >= 128) {
      const x = i % W;
      const y = (i - x) / W;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}
