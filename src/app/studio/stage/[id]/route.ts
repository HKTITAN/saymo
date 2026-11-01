import { allowed, readFilm, refused } from "@/lib/studio/films";
import { stagePage } from "@/lib/studio/stage";

// The stage: the film alone at its own pixel size, for the studio to play
// in an iframe (see contract.ts, "The stage").
export async function GET(request: Request, ctx: RouteContext<"/studio/stage/[id]">) {
  if (!allowed(request)) return refused();
  const film = await readFilm((await ctx.params).id);
  if (!film) return new Response("That film no longer exists.", { status: 404 });
  return new Response(await stagePage(film), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
