import { allowed, duplicateFilm, refused } from "@/lib/studio/films/films";

// A copy of the film, without its renders, history or chat.
export async function POST(request: Request, ctx: RouteContext<"/api/studio/films/[id]/duplicate">) {
  if (!allowed(request)) return refused();
  const copy = await duplicateFilm((await ctx.params).id);
  return copy
    ? Response.json(copy, { status: 201 })
    : Response.json({ error: "That film no longer exists." }, { status: 404 });
}
