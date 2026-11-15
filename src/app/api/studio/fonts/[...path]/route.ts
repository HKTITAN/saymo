import path from "node:path";
import { allowed, refused, ROOT } from "@/lib/studio/films/films";
import { SHIPPED_FONTS } from "@/lib/studio/brands/personal-style";
import { inside, serveFile } from "@/lib/studio/server/serve";

// The OFL fonts the studio ships (studio/fonts/<id>/), so the personal style
// form can show each name in its own face. Only the listed font files.
const fontsDir = path.join(ROOT, "studio/fonts");

export async function GET(request: Request, ctx: RouteContext<"/api/studio/fonts/[...path]">) {
  if (!allowed(request)) return refused();
  const { path: segments } = await ctx.params;
  const [id, file] = segments;
  if (segments.length !== 2 || !SHIPPED_FONTS.some((f) => f.id === id && f.file === file)) return new Response(null, { status: 404 });
  const found = inside(fontsDir, segments);
  return found ? serveFile(request, found, { "Cache-Control": "public, max-age=86400" }) : new Response(null, { status: 404 });
}
