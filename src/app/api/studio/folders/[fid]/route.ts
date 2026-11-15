import { allowed, deleteFolder, refused, renameFolder } from "@/lib/studio/films/films";
import { folderName } from "@/lib/studio/films/validate";

const missing = () => Response.json({ error: "That folder no longer exists." }, { status: 404 });

export async function PATCH(request: Request, ctx: RouteContext<"/api/studio/folders/[fid]">) {
  if (!allowed(request)) return refused();
  const name = folderName(await request.json().catch(() => null));
  if (!name) return Response.json({ error: "Give the folder a name." }, { status: 400 });
  const folder = await renameFolder((await ctx.params).fid, name);
  return folder ? Response.json(folder) : missing();
}

// Its films stay, back under All films.
export async function DELETE(request: Request, ctx: RouteContext<"/api/studio/folders/[fid]">) {
  if (!allowed(request)) return refused();
  return (await deleteFolder((await ctx.params).fid)) ? new Response(null, { status: 204 }) : missing();
}
