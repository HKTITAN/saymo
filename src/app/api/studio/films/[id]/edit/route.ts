import { checkEdit, readEdit, saveEdit } from "@/lib/studio/edit-store";
import { allowed, readFilm, refused } from "@/lib/studio/films";

// A video film's edit (edit.ts): its tracks, clips, graphics and captions.
export async function GET(request: Request, ctx: RouteContext<"/api/studio/films/[id]/edit">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  const edit = await readEdit(id);
  return edit ? Response.json(edit) : Response.json({ error: "This film has no edit." }, { status: 404 });
}

// Saves the whole edit. Checked first; the film's length follows where the
// edit now ends.
export async function PUT(request: Request, ctx: RouteContext<"/api/studio/films/[id]/edit">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  const film = await readFilm(id);
  if (!film) return Response.json({ error: "That film no longer exists." }, { status: 404 });
  if (film.kind !== "video") return Response.json({ error: "Only a video film has an edit." }, { status: 409 });
  const edit = await checkEdit(id, await request.json().catch(() => null));
  if (typeof edit === "string") return Response.json({ error: edit }, { status: 400 });
  const saved = await saveEdit(id, edit);
  return saved ? Response.json(saved) : Response.json({ error: "That film no longer exists." }, { status: 404 });
}
