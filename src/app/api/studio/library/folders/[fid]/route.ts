import { allowed, refused } from "@/lib/studio/films/films";
import { deleteLibraryFolder, renameLibraryFolder } from "@/lib/studio/library/references";
import { folderName } from "@/lib/studio/films/validate";

const missing = () => Response.json({ error: "That folder no longer exists." }, { status: 404 });

export async function PATCH(request: Request, ctx: RouteContext<"/api/studio/library/folders/[fid]">) {
  if (!allowed(request)) return refused();
  const name = folderName(await request.json().catch(() => null));
  if (!name) return Response.json({ error: "Give the folder a name." }, { status: 400 });
  const folder = await renameLibraryFolder((await ctx.params).fid, name);
  return folder ? Response.json(folder) : missing();
}

// What was in it stays in the library.
export async function DELETE(request: Request, ctx: RouteContext<"/api/studio/library/folders/[fid]">) {
  if (!allowed(request)) return refused();
  return (await deleteLibraryFolder((await ctx.params).fid)) ? new Response(null, { status: 204 }) : missing();
}
