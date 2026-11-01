import { duplicateBrand } from "@/lib/studio/brands";
import { allowed, refused } from "@/lib/studio/films";

export async function POST(request: Request, ctx: RouteContext<"/api/studio/brands/[id]/duplicate">) {
  if (!allowed(request)) return refused();
  const kit = await duplicateBrand((await ctx.params).id);
  return kit ? Response.json(kit, { status: 201 }) : Response.json({ error: "That kit no longer exists." }, { status: 404 });
}
