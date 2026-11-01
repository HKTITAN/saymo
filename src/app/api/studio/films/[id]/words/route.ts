import { isRunning } from "@/lib/studio/claude";
import { allowed, readFilm, refused, replaceWords } from "@/lib/studio/films";

// Words retyped on the film that aren't a text param: swapped in the film's
// files when they appear there once; otherwise the studio asks Claude.
export async function POST(request: Request, ctx: RouteContext<"/api/studio/films/[id]/words">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  if (!(await readFilm(id))) return Response.json({ error: "That film no longer exists." }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { from?: unknown; to?: unknown; t?: unknown } | null;
  if (typeof body?.from !== "string" || typeof body.to !== "string") {
    return Response.json({ error: "Send the old and new words." }, { status: 400 });
  }
  if (isRunning(id)) return Response.json({ result: "ask" });
  const t = typeof body.t === "number" && Number.isFinite(body.t) ? body.t : 0;
  const result = await replaceWords(id, body.from.slice(0, 400), body.to.slice(0, 400), t);
  return Response.json({ result });
}
