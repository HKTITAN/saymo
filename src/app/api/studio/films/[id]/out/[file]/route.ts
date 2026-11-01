import path from "node:path";
import { allowed, outDir, readFilm, refused } from "@/lib/studio/films";
import { serveFile } from "@/lib/studio/serve";

const FILES = new Set(["draft.mp4", "4k.mp4", "1080p.mp4", "poster.png"]);

// One of the film's renders. ?download=1 hands it over as a download named
// after the film, e.g. "line-field-4k.mp4".
export async function GET(request: Request, ctx: RouteContext<"/api/studio/films/[id]/out/[file]">) {
  if (!allowed(request)) return refused();
  const { id, file } = await ctx.params;
  if (!FILES.has(file)) return new Response(null, { status: 404 });
  const film = await readFilm(id);
  if (!film) return new Response(null, { status: 404 });
  const headers: Record<string, string> = {};
  if (new URL(request.url).searchParams.get("download") === "1") {
    const slug = film.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "film";
    headers["Content-Disposition"] = `attachment; filename="${slug}-${file}"`;
  }
  return serveFile(request, path.join(outDir(id), file), headers);
}
