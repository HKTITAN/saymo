import { isBrandId } from "@/lib/studio/brand-tokens";
import { kitDir, readBrand } from "@/lib/studio/brands";
import { allowed, refused } from "@/lib/studio/films";
import { inside, serveFile } from "@/lib/studio/serve";

// A kit's fonts, logos and guideline files, for stage pages and the kit page.
export async function GET(request: Request, ctx: RouteContext<"/studio/brand/[id]/[...path]">) {
  if (!allowed(request)) return refused();
  const { id, path: segments } = await ctx.params;
  if (!isBrandId(id) || !(await readBrand(id))) return new Response(null, { status: 404 });
  if (!["fonts", "logos", "guide"].includes(segments[0] ?? "")) return new Response(null, { status: 404 });
  const file = inside(kitDir(id), segments);
  return file ? serveFile(request, file) : new Response(null, { status: 404 });
}
