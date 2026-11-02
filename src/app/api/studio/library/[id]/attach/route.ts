import { allowed, refused } from "@/lib/studio/films";
import { attachToFilm, LibraryError } from "@/lib/studio/references";

// Copies an item into a film's refs/ as attachments, for apps outside the
// browser (the MCP server and the command line). The studio page fetches
// the files and attaches them like any other instead.
export async function POST(request: Request, ctx: RouteContext<"/api/studio/library/[id]/attach">) {
  if (!allowed(request)) return refused();
  const body = (await request.json().catch(() => null)) as { film?: unknown } | null;
  if (typeof body?.film !== "string") return Response.json({ error: "Say which film to attach it to." }, { status: 400 });
  try {
    return Response.json(await attachToFilm((await ctx.params).id, body.film), { status: 201 });
  } catch (error) {
    const known = error instanceof LibraryError;
    return Response.json({ error: known ? error.message : "Unable to attach it. Try again." }, { status: known ? 400 : 500 });
  }
}
