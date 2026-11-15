import { allowed, refused } from "@/lib/studio/films/films";
import { toEntry, trashItem, updateItem } from "@/lib/studio/library/references";

const missing = () => Response.json({ error: "That item isn't in the library any more." }, { status: 404 });

// Rename it, change its note or tags, or file it in a folder.
export async function PATCH(request: Request, ctx: RouteContext<"/api/studio/library/[id]">) {
  if (!allowed(request)) return refused();
  const result = await updateItem((await ctx.params).id, await request.json().catch(() => null));
  if (result === null) return missing();
  if (typeof result === "string") return Response.json({ error: result }, { status: 400 });
  return Response.json(toEntry(result));
}

// Into the trash for a day; restore brings it back.
export async function DELETE(request: Request, ctx: RouteContext<"/api/studio/library/[id]">) {
  if (!allowed(request)) return refused();
  return (await trashItem((await ctx.params).id)) ? new Response(null, { status: 204 }) : missing();
}
