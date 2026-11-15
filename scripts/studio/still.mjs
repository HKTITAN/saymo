// One frame of a studio film as a PNG, as the stage plays it: the studio's
// own stage page in a frame, sought to a moment, then photographed. Used by
// sketch on the frame (src/lib/studio/films/sketch-picture.ts).
//
// usage: node scripts/studio/still.mjs <film-id> <seconds> <out.png> <studio-url>

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [id, tRaw, out, base] = process.argv.slice(2);
const fail = (m) => {
  console.error(m);
  process.exit(1);
};
if (!/^[a-z0-9]{8}$/.test(id ?? "")) fail("usage: still.mjs <film-id> <seconds> <out.png> <studio-url>");
const t = Number(tRaw);
if (!Number.isFinite(t) || t < 0) fail("The moment must be 0 or more seconds.");
if (!/^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(base ?? "")) fail("The studio address must be this Mac's.");
const film = JSON.parse(readFileSync(path.join(ROOT, "films", id, "film.json"), "utf8"));
const width = Math.round(film.width);
const height = Math.round(film.height);

const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width, height } });
  // Any page of the studio's own address, so the stage answers it.
  await page.goto(`${base}/api/studio/me`);
  const ok = await page.evaluate(
    ({ id, t, width, height }) =>
      new Promise((resolve) => {
        document.body.style.margin = "0";
        const frame = document.createElement("iframe");
        frame.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;border:0`;
        frame.src = `/studio/stage/${id}`;
        document.body.append(frame);
        const done = setTimeout(() => resolve(false), 20000);
        window.addEventListener("message", (e) => {
          if (e.data?.type !== "studio:ready") return;
          frame.contentWindow.postMessage({ type: "studio:seek", t }, location.origin);
          setTimeout(() => {
            clearTimeout(done);
            resolve(true);
          }, 500);
        });
      }),
    { id, t, width, height },
  );
  if (!ok) fail("The film didn't load in time to take its picture.");
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width, height } });
} finally {
  await browser.close();
}
