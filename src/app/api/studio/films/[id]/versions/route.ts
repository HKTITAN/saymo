import { allowed, listVersions, readFilm, refused } from "@/lib/studio/films/films";

// The film's versions, newest first: now, then the film after each prompt.
export async function GET(request: Request, ctx: RouteContext<"/api/studio/films/[id]/versions">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  const film = await readFilm(id);
  if (!film) return Response.json({ error: "That film no longer exists." }, { status: 404 });
  return Response.json({ versions: await listVersions(id, film) });
}
