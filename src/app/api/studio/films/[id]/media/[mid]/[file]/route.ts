import path from "node:path";
import { allowed, refused } from "@/lib/studio/films/films";
import { mediaDir, readMedia } from "@/lib/studio/films/media";
import { serveFile } from "@/lib/studio/server/serve";

// What the studio made from a file: its preview copy (with byte ranges, so
// the stage can seek in it), its timeline strip, loudness and words.
const FILES = new Set(["proxy.mp4", "proxy.m4a", "image.jpg", "image.png", "thumbs.jpg", "peaks.json", "transcript.json"]);

export async function GET(request: Request, ctx: RouteContext<"/api/studio/films/[id]/media/[mid]/[file]">) {
  if (!allowed(request)) return refused();
  const { id, mid, file } = await ctx.params;
  if (!FILES.has(file) || !(await readMedia(id, mid))) return new Response(null, { status: 404 });
  return serveFile(request, path.join(mediaDir(id, mid), file));
}
