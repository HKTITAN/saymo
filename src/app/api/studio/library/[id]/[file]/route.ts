import path from "node:path";
import { allowed, refused } from "@/lib/studio/films/films";
import { itemDir, readItem, servable, textFor } from "@/lib/studio/library/references";
import { serveFile } from "@/lib/studio/server/serve";

const TYPES: Record<string, string> = { ".pdf": "application/pdf", ".md": "text/markdown; charset=utf-8", ".heic": "image/heic", ".heif": "image/heif", ".tif": "image/tiff", ".tiff": "image/tiff", ".bmp": "image/bmp", ".m4v": "video/mp4", ".csv": "text/csv; charset=utf-8" };

// An item's own files (the original, its card picture, a clip's stills and
// preview), and a note or link written out as text for Claude.
export async function GET(request: Request, ctx: RouteContext<"/api/studio/library/[id]/[file]">) {
  if (!allowed(request)) return refused();
  const { id, file } = await ctx.params;
  const item = await readItem(id);
  if (!item) return new Response(null, { status: 404 });
  if (file === "note.md" || file === "link.md") {
    const text = await textFor(item, file);
    return text === null ? new Response(null, { status: 404 }) : new Response(text, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-cache" } });
  }
  if (!servable(item, file)) return new Response(null, { status: 404 });
  const type = TYPES[path.extname(file).toLowerCase()];
  return serveFile(request, path.join(itemDir(id), file), type ? { "Content-Type": type } : {});
}
