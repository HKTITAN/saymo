// Renders the post into export/: one MP4 per motion and a PNG of the main
// design's still frame, each in 4K (3840 x 2160) and 1080p (1920 x 1080).
// Frames are stepped one by one (not screen-recorded), so every video is
// smooth and loops cleanly. The page is captured at 2x for 4K, and the 1080p
// files are those same frames at half size, so the two always match.
//
// usage: npm run export                  the post in src/content/post.ts, in
//                                        its main motion, into export/
//        npm run export -- burst tide    the same in other motions (`all` for
//                                        every one)
//        npm run export -- --post <id>   a post made in the tool, in the
//                                        motion picked for it, into
//                                        posts/<id>/export/

import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { post } from "../src/content/post.ts";
import { slugify } from "../src/lib/tool/doc.ts";

const PORT = 3200;
const BASE = `http://localhost:${PORT}`;
const FPS = 60;
const LOOPS = 2; // each video plays its loop twice
const CLIP = { x: 0, y: 0, width: 1920, height: 1080 }; // in post pixels

const args = process.argv.slice(2);
const postId = args.includes("--post") ? args[args.indexOf("--post") + 1] : null;
const doc = postId ? JSON.parse(await readFile(`posts/${postId}/post.json`, "utf8")) : null;
const OUT = postId ? `posts/${postId}/export` : "export";
const NAME = `aerchain-speaker-${doc ? slugify(doc.speaker.name) || "speaker" : post.slug}`;
// The tool's posts render on their own page.
const PAGE = postId ? `${BASE}/tool/render` : `${BASE}/`;
const QUERY = postId ? { id: postId } : { export: "1" };

// Exactly half size: each 2 x 2 block of the 4K frame becomes one pixel.
const HALF = "scale=1920:1080:flags=area";
// Tagged BT.709 so the orange plays back as the same orange everywhere.
const TO_VIDEO =
  "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p," +
  "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv";
// The level keeps the files playable everywhere, QuickTime included.
const x264 = (level) => [
  "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-tune", "animation",
  "-level:v", level, "-movflags", "+faststart",
];

const up = async () => {
  try {
    return (await fetch(BASE)).ok;
  } catch {
    return false;
  }
};

const ffmpeg = (args, stdin = "ignore") =>
  spawn("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: [stdin, "inherit", "inherit"] });

const finished = async (proc, what) => {
  const [code] = await once(proc, "close");
  if (code !== 0) throw new Error(`ffmpeg failed on ${what}`);
};

// Use the dev server if it is already running, otherwise start one.
let server;
if (!(await up())) {
  console.log("Starting the dev server...");
  server = spawn("npx", ["next", "dev", "-p", String(PORT)], { stdio: "ignore", detached: true });
  for (let i = 0; i < 90 && !(await up()); i++) await new Promise((r) => setTimeout(r, 1000));
}

await mkdir(OUT, { recursive: true });
// A tool post's last files go first, as the speaker's name may have changed.
if (postId) {
  for (const file of await readdir(OUT)) {
    if (/\.(mp4|png|part)$/.test(file)) await rm(`${OUT}/${file}`);
  }
}
// Read by the tool while it runs; the original's own progress is below.
const report = (record) => writeFile(`${OUT}/progress.json`, JSON.stringify(record));
const startedAt = new Date().toISOString();
if (postId) await report({ state: "running", percent: 0, startedAt });

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });

const open = async (params = {}) => {
  await page.goto(`${PAGE}?${new URLSearchParams({ ...QUERY, ...params })}`);
  await page.waitForFunction(() => window.__post?.ready, null, { timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  // The photo is added after the page loads, so wait for it as well.
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
};

// The page lists its motions; the first is the main design.
await open();
const motions = await page.evaluate(() => window.__post.motions);
const named = args.includes("all") ? motions : motions.filter((m) => args.includes(m.id));
const asked = postId
  ? [motions.find((m) => m.id === doc.motion) ?? motions[0]]
  : named.length
    ? named
    : motions.slice(0, 1);

// The still: the main motion's still frame (for a tool post, its own).
const main = postId ? asked[0] : motions[0];
if (main.id !== motions[0].id) await open({ motion: main.id });
await page.evaluate((s) => window.__post.renderAt(s), main.still);
await page.screenshot({ path: `${OUT}/${NAME}-4k.png`, clip: CLIP });
await finished(ffmpeg(["-i", `${OUT}/${NAME}-4k.png`, "-vf", HALF, `${OUT}/${NAME}.png`]), "the still");
console.log(`${OUT}/${NAME}-4k.png\n${OUT}/${NAME}.png`);

for (const { id: motion, duration, still } of asked) {
  await open({ motion });
  const frames = Math.round(duration * FPS) * LOOPS;
  const uhd = `${OUT}/${NAME}-${motion}-4k.mp4`;
  const hd = `${OUT}/${NAME}-${motion}.mp4`;

  const encoder = ffmpeg(
    [
      "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
      "-filter_complex", `[0:v]split=2[a][b];[a]${TO_VIDEO}[uhd];[b]${HALF},${TO_VIDEO}[hd]`,
      // Written under a .part name and renamed once complete, so Download 4K
      // never hands out a video that is still being made.
      "-map", "[uhd]", ...x264("5.2"), "-f", "mp4", `${uhd}.part`,
      "-map", "[hd]", ...x264("4.2"), "-f", "mp4", `${hd}.part`,
    ],
    "pipe",
  );

  for (let i = 0; i < frames; i++) {
    // Videos open on the still frame, so the post's thumbnail is the design.
    await page.evaluate((s) => window.__post.renderAt(s), still + i / FPS);
    const png = await page.screenshot({ clip: CLIP, type: "png" });
    if (!encoder.stdin.write(png)) await once(encoder.stdin, "drain");
    if (postId && i % 6 === 0) {
      // The tool's progress bar moves every tenth of a second of video.
      await report({ state: "running", percent: Math.round((i / frames) * 100), startedAt });
    } else if (!postId && i % FPS === 0) {
      const percent = Math.round((i / frames) * 100);
      process.stdout.write(`\r${motion}: ${percent}%   `);
      // Read by the viewer's Download 4K button while the export runs.
      await writeFile("export/progress.json", JSON.stringify({ motion, percent }));
    }
  }
  encoder.stdin.end();
  await finished(encoder, motion);
  await rename(`${uhd}.part`, uhd);
  await rename(`${hd}.part`, hd);
  if (!postId) await rm("export/progress.json", { force: true });
  process.stdout.write(`\r${uhd}\n${hd} (${frames} frames, ${(frames / FPS).toFixed(0)}s)\n`);
}

await browser.close();
if (server) process.kill(-server.pid);
if (postId) {
  const motion = main.id;
  await report({
    state: "done",
    finishedAt: new Date().toISOString(),
    // The tool compares this with the post's own, to tell when the video
    // no longer matches an edited post.
    docUpdatedAt: doc.updatedAt,
    files: {
      video4k: `${NAME}-${motion}-4k.mp4`,
      video: `${NAME}-${motion}.mp4`,
      image4k: `${NAME}-4k.png`,
      image: `${NAME}.png`,
    },
  });
}
