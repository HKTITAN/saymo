import { stat } from "node:fs/promises";
import path from "node:path";
import { allowed, outDir, readFilm, refused } from "@/lib/studio/films";
import { serveFile } from "@/lib/studio/serve";

const FILES = new Set(["draft.mp4", "4k.mp4", "1080p.mp4", "poster.png"]);

// One of the film's renders. ?download=1 hands it over as a download named
// after the film and when it was rendered, e.g. "line-field-4k-4-nov-17-27.mp4",
// so each render saves as its own file and the newest is easy to find (with
// one name for every render, the Mac saved them as "(4)", "(5)"... and the
// plain name was the oldest).
export async function GET(request: Request, ctx: RouteContext<"/api/studio/films/[id]/out/[file]">) {
  if (!allowed(request)) return refused();
  const { id, file } = await ctx.params;
  if (!FILES.has(file)) return new Response(null, { status: 404 });
  const film = await readFilm(id);
  if (!film) return new Response(null, { status: 404 });
  const headers: Record<string, string> = {};
  if (new URL(request.url).searchParams.get("download") === "1") {
    const slug = film.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "film";
    const made = (await stat(path.join(outDir(id), file)).catch(() => null))?.mtime;
    const when = made
      ? `-${made.getDate()}-${made.toLocaleString("en-GB", { month: "short" }).toLowerCase()}-${String(made.getHours()).padStart(2, "0")}-${String(made.getMinutes()).padStart(2, "0")}`
      : "";
    const ext = path.extname(file);
    headers["Content-Disposition"] = `attachment; filename="${slug}-${path.basename(file, ext)}${when}${ext}"`;
  }
  return serveFile(request, path.join(outDir(id), file), headers);
}
