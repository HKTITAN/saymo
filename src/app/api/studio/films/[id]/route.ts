import { allowed, deleteFilm, editFilm, readFilm, refused } from "@/lib/studio/films";
import { soundLater } from "@/lib/studio/sound-render";
import { filmEdit } from "@/lib/studio/validate";

const missing = () => Response.json({ error: "That film no longer exists." }, { status: 404 });

export async function GET(request: Request, ctx: RouteContext<"/api/studio/films/[id]">) {
  if (!allowed(request)) return refused();
  const film = await readFilm((await ctx.params).id);
  return film ? Response.json(film) : missing();
}

// Saves what the panel changes: the name, size, length and param values.
export async function PATCH(request: Request, ctx: RouteContext<"/api/studio/films/[id]">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  const film = await readFilm(id);
  if (!film) return missing();
  const edit = filmEdit(film, await request.json().catch(() => null));
  if (typeof edit === "string") return Response.json({ error: edit }, { status: 400 });
  const next = await editFilm(id, edit);
  // A new length or new values can change the sound (it is exactly as long
  // as the film, and its effects may follow the values).
  if (next && (edit.duration !== undefined || edit.params !== undefined)) soundLater(id);
  return next ? Response.json(next) : missing();
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/studio/films/[id]">) {
  if (!allowed(request)) return refused();
  await deleteFilm((await ctx.params).id);
  return new Response(null, { status: 204 });
}
