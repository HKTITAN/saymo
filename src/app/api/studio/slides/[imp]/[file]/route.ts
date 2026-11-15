import { allowed, refused } from "@/lib/studio/films/films";
import { inside, serveFile } from "@/lib/studio/server/serve";
import { importDir, isImportId } from "@/lib/studio/input/slides";

// A slide's picture, for the strip of thumbnails.
export async function GET(request: Request, ctx: RouteContext<"/api/studio/slides/[imp]/[file]">) {
  if (!allowed(request)) return refused();
  const { imp, file } = await ctx.params;
  if (!isImportId(imp) || !/^[a-z0-9-]{1,40}\.png$/.test(file)) return new Response(null, { status: 404 });
  const found = inside(importDir(imp), [file]);
  return found ? serveFile(request, found) : new Response(null, { status: 404 });
}
