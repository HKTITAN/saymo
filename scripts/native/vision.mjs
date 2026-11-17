// The same three jobs as vision.swift, for a PC without macOS's Vision
// framework (Windows, Linux): Google's MediaPipe (Apache 2.0) run in
// Chrome, which renders already need. Nothing leaves the machine; the
// models are fetched once and checked before use.
//
// usage: node vision.mjs cutout <in.png> <out.png>
//          lifts the subject out of a photo and writes it as a PNG on a
//          transparent background; exits with code 2 when there is no subject
//        node vision.mjs face <in.png> [more.png ...]
//          prints the largest face as {"x","y","width","height"} in the
//          photo's pixels, measured from the top-left, or null; a line
//          for each picture
//        node vision.mjs matte <in.mp4> <out-dir>
//          the person in every frame of a video, as a grey mask at the
//          frame's size (white is them), one PNG per frame (m00001.png on);
//          prints how many frames

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MEDIAPIPE = path.join(ROOT, "node_modules/@mediapipe/tasks-vision");
const MODELS = path.join(ROOT, "node_modules/.cache/studio-vision");
const BASE = "https://storage.googleapis.com/mediapipe-models";

// Each model at a fixed version, checked against its SHA-256.
const MODEL = {
  // BlazeFace, the short-range face finder (faces within a few metres).
  face: { file: "blaze_face_short_range.tflite", url: `${BASE}/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`, sha256: "b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f" },
  // The person finder made for video: small and steady from frame to frame.
  person: { file: "selfie_segmenter.tflite", url: `${BASE}/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite`, sha256: "191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b" },
  // Hair, skin and clothes apart from the background: a sharper outline of
  // a person in a photo than the video model gives.
  people: { file: "selfie_multiclass_256x256.tflite", url: `${BASE}/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite`, sha256: "c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0" },
  // Lifts out whatever is at a point: for photos of things, not people.
  thing: { file: "magic_touch.tflite", url: `${BASE}/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite`, sha256: "e24338a717c1b7ad8d159666677ef400babb7f33b8ad60c4d96db4ecf694cd25" },
};

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

async function model(name) {
  const m = MODEL[name];
  const to = path.join(MODELS, m.file);
  if (existsSync(to)) return to;
  await mkdir(MODELS, { recursive: true });
  const part = `${to}.${randomBytes(4).toString("hex")}.part`;
  try {
    const res = await fetch(m.url, { redirect: "follow" });
    if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
    const hash = createHash("sha256");
    const count = new Transform({
      transform(chunk, _enc, next) {
        hash.update(chunk);
        next(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body), count, createWriteStream(part));
    if (hash.digest("hex") !== m.sha256) throw new Error(`${m.file} didn't download correctly`);
    await rename(part, to);
  } catch (error) {
    // fail() exits at once, so the part is cleared first.
    await rm(part, { force: true });
    fail(`The ${name} model couldn't be fetched (it needs the internet once): ${error.message}`);
  } finally {
    await rm(part, { force: true });
  }
  return to;
}

// Chrome with a page of our own: MediaPipe's code and the models come from
// node_modules and the model cache, the pictures from `files`, all through
// the page's own address, so nothing is fetched from the web.
const ORIGIN = "http://vision.saymo";
async function open(files) {
  const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
  const page = await browser.newPage();
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const [, area, ...rest] = url.pathname.split("/");
    const name = decodeURIComponent(rest.join("/"));
    let file = null;
    if (area === "mp") file = path.join(MEDIAPIPE, name);
    else if (area === "model") file = path.join(MODELS, path.basename(name));
    else if (area === "in") file = files[Number(name)] ?? null;
    if (area === "" || area === "index.html") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>vision</title>" });
    if (!file || !existsSync(file)) return route.fulfill({ status: 404, body: "" });
    const type = file.endsWith(".mjs") || file.endsWith(".js") ? "text/javascript" : file.endsWith(".wasm") ? "application/wasm" : "application/octet-stream";
    route.fulfill({ contentType: type, body: await readFile(file) });
  });
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(PAGE);
  return { browser, page };
}

// Runs in the page: sets up the tasks and the mask maths.
const PAGE = `(async () => {
  const mp = await import("${ORIGIN}/mp/vision_bundle.mjs");
  const files = await mp.FilesetResolver.forVisionTasks("${ORIGIN}/mp/wasm");
  const base = (name) => ({ modelAssetPath: "${ORIGIN}/model/" + name, delegate: "CPU" });
  const picture = async (i) => createImageBitmap(await (await fetch("${ORIGIN}/in/" + i)).blob());

  // A mask at the picture's size from a confidence mask at any size:
  // enlarged smoothly, then its soft edge pulled in to about a pixel, and a
  // hairline off the edge so no rim of the old background shows.
  function crisp(conf, mw, mh, w, h) {
    const soft = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const fy = Math.min(mh - 1, Math.max(0, ((y + 0.5) * mh) / h - 0.5));
      const y0 = Math.floor(fy), y1 = Math.min(mh - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < w; x++) {
        const fx = Math.min(mw - 1, Math.max(0, ((x + 0.5) * mw) / w - 0.5));
        const x0 = Math.floor(fx), x1 = Math.min(mw - 1, x0 + 1), tx = fx - x0;
        const top = conf[y0 * mw + x0] * (1 - tx) + conf[y0 * mw + x1] * tx;
        const bottom = conf[y1 * mw + x0] * (1 - tx) + conf[y1 * mw + x1] * tx;
        const v = top * (1 - ty) + bottom * ty;
        const t = Math.min(1, Math.max(0, (v - 0.35) / 0.3));
        soft[y * w + x] = t * t * (3 - 2 * t);
      }
    }
    const out = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let m = 1;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          for (let dx = -1; dx <= 1; dx++) m = Math.min(m, soft[yy * w + Math.min(w - 1, Math.max(0, x + dx))]);
        }
        out[y * w + x] = Math.round(m * 255);
      }
    }
    return out;
  }

  // Only the subject itself: stray specks the model saw elsewhere (a dark
  // table edge, a shadow) are dropped, keeping each piece at least a
  // quarter the size of the largest.
  function biggest(mask, w, h) {
    const label = new Int32Array(w * h).fill(-1);
    const sizes = [];
    const stack = [];
    for (let start = 0; start < w * h; start++) {
      if (mask[start] <= 127 || label[start] !== -1) continue;
      const id = sizes.length;
      let size = 0;
      label[start] = id;
      stack.push(start);
      while (stack.length) {
        const p = stack.pop();
        size++;
        const x = p % w, y = (p - x) / w;
        for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
          if (q >= 0 && label[q] === -1 && mask[q] > 127) {
            label[q] = id;
            stack.push(q);
          }
        }
      }
      sizes.push(size);
    }
    const largest = sizes.reduce((a, b) => Math.max(a, b), 0);
    const kept = (p) => label[p] >= 0 && sizes[label[p]] >= largest / 4;
    // A faint edge pixel stays only next to a piece that's kept.
    const out = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (kept(p)) out[p] = mask[p];
        else if (label[p] === -1 && mask[p] > 0) {
          let near = false;
          for (let dy = -2; dy <= 2 && !near; dy++) {
            for (let dx = -2; dx <= 2 && !near; dx++) {
              const xx = x + dx, yy = y + dy;
              near = xx >= 0 && yy >= 0 && xx < w && yy < h && kept(yy * w + xx);
            }
          }
          if (near) out[p] = mask[p];
        }
      }
    }
    return out;
  }

  async function png(rgba, w, h) {
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext("2d").putImageData(new ImageData(rgba, w, h), 0, 0);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  const grey = (mask, w, h) => {
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = mask[i];
      rgba[i * 4 + 3] = 255;
    }
    return rgba;
  };

  const tasks = {};
  window.vision = {
    async face(i) {
      tasks.face ??= await mp.FaceDetector.createFromOptions(files, { baseOptions: base("${MODEL.face.file}"), runningMode: "IMAGE", minDetectionConfidence: 0.5 });
      const found = tasks.face.detect(await picture(i)).detections.map((d) => d.boundingBox).filter(Boolean);
      return found.sort((a, b) => b.width - a.width)[0] ?? null;
    },

    // A photo's subject. With a face in it, the person: the multiclass
    // model draws hair and clothes better than anything general, but it
    // also sees people in pictures of things, so a face decides. Without
    // one, whatever sits at the middle of the frame, which is where a
    // subject usually is.
    async cutout(i) {
      const image = await picture(i);
      const w = image.width, h = image.height;
      let mask;
      if (await window.vision.face(i)) {
        tasks.people ??= await mp.ImageSegmenter.createFromOptions(files, { baseOptions: base("${MODEL.people.file}"), runningMode: "IMAGE", outputConfidenceMasks: true, outputCategoryMask: false });
        const r = tasks.people.segment(image);
        const background = r.confidenceMasks[0];
        mask = crisp(background.getAsFloat32Array().map((v) => 1 - v), background.width, background.height, w, h);
        r.close();
      } else {
        tasks.thing ??= await mp.InteractiveSegmenterLegacy.createFromOptions(files, { baseOptions: base("${MODEL.thing.file}"), outputConfidenceMasks: true, outputCategoryMask: false });
        const r = tasks.thing.segment(image, { keypoint: { x: 0.5, y: 0.5 } });
        const m = r.confidenceMasks[0];
        mask = crisp(m.getAsFloat32Array(), m.width, m.height, w, h);
        r.close();
      }
      mask = biggest(mask, w, h);
      const share = mask.reduce((n, v) => n + (v > 127), 0) / (w * h);
      // All of it or almost none: there was no subject to lift out.
      if (share < 0.01 || share > 0.97) return null;
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, w, h).data;
      // A plain picture (one flat colour, a blank wall) has no subject,
      // even if the model drew a shape on it: what it drew must stand out
      // from the rest in colour or in detail.
      const stats = [[0, 0, 0], [0, 0, 0]];
      for (let p = 0; p < w * h; p++) {
        const l = 0.2126 * pixels[p * 4] + 0.7152 * pixels[p * 4 + 1] + 0.0722 * pixels[p * 4 + 2];
        const s = stats[mask[p] > 127 ? 1 : 0];
        s[0]++;
        s[1] += l;
        s[2] += l * l;
      }
      const [outside, inside] = stats.map(([n, sum, sq]) => ({ mean: n ? sum / n : 0, spread: n ? Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2)) : 0 }));
      if (Math.abs(inside.mean - outside.mean) < 6 && inside.spread < 6) return null;
      for (let p = 0; p < w * h; p++) pixels[p * 4 + 3] = Math.round((pixels[p * 4 + 3] * mask[p]) / 255);
      return png(pixels, w, h);
    },

    // One frame of a video, in order; the video mode carries what it saw
    // from frame to frame, so the edge holds steady.
    async matte(i, ms) {
      tasks.person ??= await mp.ImageSegmenter.createFromOptions(files, { baseOptions: base("${MODEL.person.file}"), runningMode: "VIDEO", outputConfidenceMasks: true, outputCategoryMask: false });
      const image = await picture(i);
      const r = tasks.person.segmentForVideo(image, ms);
      const m = r.confidenceMasks[r.confidenceMasks.length - 1];
      const mask = crisp(m.getAsFloat32Array(), m.width, m.height, image.width, image.height);
      r.close();
      const { width, height } = image;
      image.close();
      return png(grey(mask, width, height), width, height);
    },
  };
})()`;

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err = (err + c).slice(-2000)));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `${cmd} ${code}`))));
  });

const [job, input, output] = process.argv.slice(2);
if (!job || !input) fail("usage: vision cutout <in> <out> | vision face <in> | vision matte <in-video> <out-dir>");
if (!existsSync(input)) fail(`cannot read ${input}`);

if (job === "face") {
  // Several pictures may follow the first: a line for each, in order.
  const pictures = process.argv.slice(3);
  await model("face");
  const { browser, page } = await open(pictures);
  try {
    for (let i = 0; i < pictures.length; i++) {
      const box = existsSync(pictures[i]) ? await page.evaluate((i) => window.vision.face(i), i) : null;
      console.log(
        box ? `{"x":${box.originX.toFixed(1)},"y":${box.originY.toFixed(1)},"width":${box.width.toFixed(1)},"height":${box.height.toFixed(1)}}` : "null",
      );
    }
  } finally {
    await browser.close();
  }
} else if (job === "cutout") {
  if (!output) fail("usage: vision cutout <in> <out>");
  await Promise.all([model("face"), model("people"), model("thing")]);
  const { browser, page } = await open([input]);
  let picture;
  try {
    picture = await page.evaluate(() => window.vision.cutout(0));
  } finally {
    await browser.close();
  }
  if (!picture) fail("no subject found", 2);
  await writeFile(output, Buffer.from(picture, "base64"));
} else if (job === "matte") {
  if (!output) fail("usage: vision matte <in-video> <out-dir>");
  await model("person");
  // Every frame as it is in the file (one mask each), with its time.
  const frames = await mkdtemp(path.join(tmpdir(), "studio-vision-"));
  try {
    await run("ffmpeg", ["-v", "error", "-i", input, "-map", "0:v:0", "-fps_mode", "passthrough", "-q:v", "2", path.join(frames, "f%05d.jpg")]);
    const files = (await readdir(frames))
      .filter((f) => f.endsWith(".jpg"))
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
      .map((f) => path.join(frames, f));
    if (!files.length) fail(`no frames in ${input}`);
    const probe = JSON.parse(await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=avg_frame_rate", "-of", "json", input]));
    const [n, d] = String(probe.streams?.[0]?.avg_frame_rate ?? "30/1").split("/").map(Number);
    const step = 1000 / (n && d ? n / d : 30);
    const { browser, page } = await open(files);
    try {
      for (let i = 0; i < files.length; i++) {
        const mask = await page.evaluate(([i, ms]) => window.vision.matte(i, ms), [i, Math.round(i * step)]);
        await writeFile(path.join(output, `m${String(i + 1).padStart(5, "0")}.png`), Buffer.from(mask, "base64"));
      }
    } finally {
      await browser.close();
    }
    console.log(files.length);
  } finally {
    await rm(frames, { recursive: true, force: true });
  }
} else {
  fail(`unknown job ${job}`);
}
