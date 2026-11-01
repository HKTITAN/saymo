import { checkKit, deleteBrand, readBrand, withBrand, writeBrand } from "@/lib/studio/brands";
import { allowed, refused } from "@/lib/studio/films";

const missing = () => Response.json({ error: "That kit no longer exists." }, { status: 404 });

export async function GET(request: Request, ctx: RouteContext<"/api/studio/brands/[id]">) {
  if (!allowed(request)) return refused();
  const kit = await readBrand((await ctx.params).id);
  return kit ? Response.json(kit) : missing();
}

// Saves the whole kit as the page edits it.
export async function PUT(request: Request, ctx: RouteContext<"/api/studio/brands/[id]">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  return withBrand(id, async () => {
    const previous = await readBrand(id);
    if (!previous) return missing();
    const kit = checkKit(id, body, previous);
    if (typeof kit === "string") return Response.json({ error: kit }, { status: 400 });
    await writeBrand(kit);
    return Response.json(kit);
  });
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/studio/brands/[id]">) {
  if (!allowed(request)) return refused();
  const problem = await deleteBrand((await ctx.params).id);
  return problem ? Response.json({ error: problem }, { status: 409 }) : new Response(null, { status: 204 });
}
