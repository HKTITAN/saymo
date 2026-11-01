import { isRunning, noteWentBack } from "@/lib/studio/claude";
import { allowed, readFilm, refused, restoreVersion, withFilm } from "@/lib/studio/films";

// Puts the film back as it was in version n. The film as it was is kept
// first as a new version, so going back never loses anything.
export async function POST(request: Request, ctx: RouteContext<"/api/studio/films/[id]/versions/[n]/restore">) {
  if (!allowed(request)) return refused();
  const { id, n: raw } = await ctx.params;
  if (!(await readFilm(id))) return Response.json({ error: "That film no longer exists." }, { status: 404 });
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return Response.json({ error: "That version doesn't exist." }, { status: 404 });
  if (isRunning(id)) {
    return Response.json({ error: "Claude is still working on this film. Stop it first, then go back." }, { status: 409 });
  }
  const body = (await request.json().catch(() => null)) as { t?: unknown } | null;
  const t = typeof body?.t === "number" && Number.isFinite(body.t) && body.t >= 0 ? body.t : 0;
  const done = await withFilm(id, async () => {
    // A turn may have started while this waited its turn.
    if (isRunning(id)) return "busy" as const;
    return restoreVersion(id, n, t);
  });
  if (done === "busy") {
    return Response.json({ error: "Claude is still working on this film. Stop it first, then go back." }, { status: 409 });
  }
  if (!done) return Response.json({ error: "That version is no longer kept." }, { status: 404 });
  await noteWentBack(id, done.about);
  return Response.json(done.film);
}
