import { allowed, refused } from "@/lib/studio/films/films";
import { dropImport, readImport } from "@/lib/studio/input/slides";

// The slides brought in so far, and throwing them away (closing the card
// without making a film).
export async function GET(request: Request, ctx: RouteContext<"/api/studio/slides/[imp]">) {
  if (!allowed(request)) return refused();
  const { imp } = await ctx.params;
  const found = await readImport(imp);
  return found ? Response.json(found) : Response.json({ error: "Those slides are gone." }, { status: 404 });
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/studio/slides/[imp]">) {
  if (!allowed(request)) return refused();
  const { imp } = await ctx.params;
  await dropImport(imp);
  return new Response(null, { status: 204 });
}
