import { allowed, filmDir, readFilm, refused } from "@/lib/studio/films";
import { inside, serveFile } from "@/lib/studio/serve";
import { stageBundle } from "@/lib/studio/stage";

// The film's own files, for its stage page (fonts, images, scripts), and
// __stage.js, a React film's Player bundle.
export async function GET(request: Request, ctx: RouteContext<"/studio/stage/[id]/[...path]">) {
  if (!allowed(request)) return refused();
  const { id, path: segments } = await ctx.params;
  const film = await readFilm(id);
  if (!film) return new Response(null, { status: 404 });
  if (segments.length === 1 && segments[0] === "__stage.js" && film.engine === "react") {
    return new Response(await stageBundle(id), {
      headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const file = inside(filmDir(id), segments);
  return file ? serveFile(request, file) : new Response(null, { status: 404 });
}
