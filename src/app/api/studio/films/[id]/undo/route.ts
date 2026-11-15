import { isRunning, noteUndo } from "@/lib/studio/agent/claude";
import { allowed, readFilm, refused, restoreLast, withFilm } from "@/lib/studio/films/films";

// Puts the film back as it was before Claude's last turn.
export async function POST(request: Request, ctx: RouteContext<"/api/studio/films/[id]/undo">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  if (!(await readFilm(id))) return Response.json({ error: "That film no longer exists." }, { status: 404 });
  if (isRunning(id)) {
    return Response.json({ error: "Claude is still working on this film. Stop it first, then undo." }, { status: 409 });
  }
  const film = await withFilm(id, () => restoreLast(id));
  if (!film) return Response.json({ error: "There's nothing to undo yet." }, { status: 409 });
  await noteUndo(id);
  return Response.json(film);
}
