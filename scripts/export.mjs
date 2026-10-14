// Renders the post into export/: for each version, one MP4 per motion and a
// PNG of the main design's still frame, each in 4K (3840 x 2160) and 1080p
// (1920 x 1080).
// Frames are stepped one by one (not screen-recorded), so every video is
// smooth and loops cleanly. The page is captured at 2x for 4K, and the 1080p
// files are those same frames at half size, so the two always match.
//
// usage: npm run export                      every version and motion
//        npm run export -- skyline           one version, every motion
//        npm run export -- original scenes   one version, one motion

import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { post } from "../src/content/post.ts";

const PORT = 3200;
const BASE = `http://localhost:${PORT}`;
const FPS = 60;
const LOOPS = 2; // each video plays its loop twice
const CLIP = { x: 0, y: 0, width: 1920, height: 1080 }; // in post pixels
const NAME = `aerchain-speaker-${post.slug}`;

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

await mkdir("export", { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });

const open = async (params = {}) => {
  await page.goto(`${BASE}/?${new URLSearchParams({ export: "1", ...params })}`);
  await page.waitForFunction(() => window.__post?.ready, null, { timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  // The photo is added after the page loads, so wait for it as well.
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
};

// The page lists its versions and motions; the first motion is the main design.
await open();
const all = await page.evaluate(() => ({ motions: window.__post.motions, versions: window.__post.versions }));
const args = process.argv.slice(2);
const pick = (list) => {
  const chosen = list.filter((x) => args.includes(x.id));
  return chosen.length ? chosen : list;
};

for (const { id: version, suffix } of pick(all.versions)) {
  const name = `${NAME}${suffix}`;

  // The still: the first motion's still frame.
  await open({ version });
  await page.evaluate((s) => window.__post.renderAt(s), all.motions[0].still);
  await page.screenshot({ path: `export/${name}-4k.png`, clip: CLIP });
  await finished(ffmpeg(["-i", `export/${name}-4k.png`, "-vf", HALF, `export/${name}.png`]), "the still");
  console.log(`export/${name}-4k.png\nexport/${name}.png`);

  for (const { id: motion, duration, still } of pick(all.motions)) {
    await open({ version, motion });
    const frames = Math.round(duration * FPS) * LOOPS;
    const uhd = `export/${name}-${motion}-4k.mp4`;
    const hd = `export/${name}-${motion}.mp4`;

    const encoder = ffmpeg(
      [
        "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
        "-filter_complex", `[0:v]split=2[a][b];[a]${TO_VIDEO}[uhd];[b]${HALF},${TO_VIDEO}[hd]`,
        "-map", "[uhd]", ...x264("5.2"), uhd,
        "-map", "[hd]", ...x264("4.2"), hd,
      ],
      "pipe",
    );

    for (let i = 0; i < frames; i++) {
      // Videos open on the still frame, so the post's thumbnail is the design.
      await page.evaluate((s) => window.__post.renderAt(s), still + i / FPS);
      const png = await page.screenshot({ clip: CLIP, type: "png" });
      if (!encoder.stdin.write(png)) await once(encoder.stdin, "drain");
      if (i % FPS === 0) process.stdout.write(`\r${name} ${motion}: ${Math.round((i / frames) * 100)}%   `);
    }
    encoder.stdin.end();
    await finished(encoder, `${name} ${motion}`);
    process.stdout.write(`\r${uhd}\n${hd} (${frames} frames, ${(frames / FPS).toFixed(0)}s)\n`);
  }
}

await browser.close();
if (server) process.kill(-server.pid);
