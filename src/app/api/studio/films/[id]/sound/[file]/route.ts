import path from "node:path";
import { allowed, readFilm, refused } from "@/lib/studio/films";
import { serveFile } from "@/lib/studio/serve";
import { soundDir } from "@/lib/studio/sound-render";

const FILES = new Set(["sound.wav", "peaks.json"]);

// The film's rendered sound (with byte ranges, so it can be played and
// seeked) and its loudness outline for the timeline.
export async function GET(request: Request, ctx: RouteContext<"/api/studio/films/[id]/sound/[file]">) {
  if (!allowed(request)) return refused();
  const { id, file } = await ctx.params;
  if (!FILES.has(file) || !(await readFilm(id))) return new Response(null, { status: 404 });
  return serveFile(request, path.join(soundDir(id), file));
}
