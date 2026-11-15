import { readFile } from "node:fs/promises";
import path from "node:path";
import { EFFECTS } from "@/lib/studio/films/effects";
import { allowed, refused, ROOT } from "@/lib/studio/films/films";

// An effect's preview, for its tile on the Effects page: a page that loads
// the effect's parts (studio/starters/html/assets/parts) and its scene
// (studio/effects/<id>.js) on a dark 1920 by 1080 stage fitted to the
// frame. It shows the scene's still, plays from the start on a "play"
// message (the tile sends one while the pointer is over it) and goes back
// to the still on "stop".

const PARTS = path.join(ROOT, "studio/starters/html/assets/parts");
const SCENES = path.join(ROOT, "studio/effects");

// The studio's own dark look, with no brand: what a preview wears.
const BRAND = {
  id: "preview",
  name: "Preview",
  colors: { roles: { background: "#141414", surface: "#262626", ink: "#f2f2f2", muted: "#8a8a8a", accent: "#9747FF", onAccent: "#ffffff", line: "#2e2e2e" }, ramps: [] },
  fonts: [],
  logos: [],
};

// Scripts go inline, so nothing in them may close the script tag.
const inline = (code: string) => code.replace(/<\/(script)/gi, "<\\/$1");

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  const effect = EFFECTS.find((e) => e.id === id);
  if (!effect) return Response.json({ error: "There's no effect by that name." }, { status: 404 });
  const scripts = await Promise.all([...effect.parts.map((p) => readFile(path.join(PARTS, p), "utf8")), readFile(path.join(SCENES, `${effect.id}.js`), "utf8")]);
  return new Response(page(effect.name, scripts.map(inline)), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

function page(name: string, scripts: string[]) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${name.replace(/[<&]/g, "")}</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden;background:#141414}
#stage{position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0;overflow:hidden;background:#141414;color:#f2f2f2;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
</style>
</head>
<body>
<div id="stage"></div>
<script>window.__brand=${JSON.stringify(BRAND)};window.__film={width:1920,height:1080,fps:60,duration:6};</script>
${scripts.map((s) => `<script>\n${s}\n</script>`).join("\n")}
<script>
(() => {
  const stage = document.getElementById("stage");
  const fit = () => {
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    stage.style.transform = "translate(" + (innerWidth - 1920 * s) / 2 + "px, " + (innerHeight - 1080 * s) / 2 + "px) scale(" + s + ")";
  };
  fit();
  addEventListener("resize", fit);
  const { duration, still, parts } = window.preview(stage);
  const draw = (t) => { for (const p of parts) p.draw(t); };
  let playing = false;
  let start = 0;
  const tick = (now) => {
    if (!playing) return;
    draw(((now - start) / 1000) % duration);
    requestAnimationFrame(tick);
  };
  draw(still);
  addEventListener("message", (e) => {
    if (e.data?.preview === "play" && !playing) {
      playing = true;
      start = performance.now();
      requestAnimationFrame(tick);
    } else if (e.data?.preview === "stop" && playing) {
      playing = false;
      draw(still);
    }
  });
})();
</script>
</body>
</html>`;
}
