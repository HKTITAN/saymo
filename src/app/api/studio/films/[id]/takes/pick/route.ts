import { allowed, readFilm, refused } from "@/lib/studio/films/films";
import { pickTake } from "@/lib/studio/films/takes";

// Keeps one of the three versions: the film becomes it, as one step.
export async function POST(request: Request, ctx: RouteContext<"/api/studio/films/[id]/takes/pick">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  if (!(await readFilm(id))) return Response.json({ error: "That film no longer exists." }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { take?: unknown } | null;
  if (typeof body?.take !== "string") return Response.json({ error: "Say which version to keep." }, { status: 400 });
  const problem = await pickTake(id, body.take);
  if (problem) return Response.json({ error: problem }, { status: 409 });
  return Response.json({ film: await readFilm(id) });
}
