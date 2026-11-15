import { allowed, refused } from "@/lib/studio/films/films";
import { deleteMedia, readMedia } from "@/lib/studio/films/media";

// One file's record.
export async function GET(request: Request, ctx: RouteContext<"/api/studio/films/[id]/media/[mid]">) {
  if (!allowed(request)) return refused();
  const { id, mid } = await ctx.params;
  const media = await readMedia(id, mid);
  return media ? Response.json(media) : Response.json({ error: "That file isn't in this film." }, { status: 404 });
}

// Takes a file out of the film, unless the edit still uses it.
export async function DELETE(request: Request, ctx: RouteContext<"/api/studio/films/[id]/media/[mid]">) {
  if (!allowed(request)) return refused();
  const { id, mid } = await ctx.params;
  const result = await deleteMedia(id, mid);
  if (result === "in use") {
    return Response.json({ error: "The edit still uses this file. Take its clips off the timeline first." }, { status: 409 });
  }
  if (result === "missing") return Response.json({ error: "That file isn't in this film." }, { status: 404 });
  return new Response(null, { status: 204 });
}
