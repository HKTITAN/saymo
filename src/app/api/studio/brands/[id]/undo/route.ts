import { isBrandRunning, undoBrand } from "@/lib/studio/brand-claude";
import { allowed, refused } from "@/lib/studio/films";

// Puts the kit back as it was before Claude's last turn.
export async function POST(request: Request, ctx: RouteContext<"/api/studio/brands/[id]/undo">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  if (isBrandRunning(id)) return new Response("Claude is still working on this kit.", { status: 409 });
  const kit = await undoBrand(id);
  return kit ? Response.json(kit) : new Response("There's nothing of Claude's to undo.", { status: 409 });
}
