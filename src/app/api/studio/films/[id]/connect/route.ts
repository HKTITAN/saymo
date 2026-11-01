import { filmConnections, saveFilmNow } from "@/lib/studio/connect";
import { failed } from "@/lib/studio/connect-http";
import { allowed, readFilm, refused } from "@/lib/studio/films";

// Where this film's last render and source were saved.
export async function GET(request: Request, ctx: RouteContext<"/api/studio/films/[id]/connect">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  if (!(await readFilm(id))) return Response.json({ error: "That film no longer exists." }, { status: 404 });
  return Response.json(await filmConnections(id));
}

// { to: "drive" | "github" }: save now (Try again, Save code now).
export async function POST(request: Request, ctx: RouteContext<"/api/studio/films/[id]/connect">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { to?: unknown } | null;
  if (body?.to !== "drive" && body?.to !== "github") return Response.json({ error: "Say where to save it." }, { status: 400 });
  try {
    await saveFilmNow(id, body.to);
    return Response.json(await filmConnections(id), { status: 202 });
  } catch (error) {
    return failed(error);
  }
}
