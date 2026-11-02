import { allowed, refused } from "@/lib/studio/films";
import { brandFile } from "@/lib/studio/references";
import { serveFile } from "@/lib/studio/serve";

// A brand kit's file as the library uses it: its rules written out
// (rules.md), a logo drawn as a PNG (?as=png) so Claude can look at it, or
// a small picture for a card (?as=thumb). Kits stay read-only here.
export async function GET(request: Request, ctx: RouteContext<"/api/studio/library/brand/[kit]/[...path]">) {
  if (!allowed(request)) return refused();
  const { kit, path } = await ctx.params;
  const as = new URL(request.url).searchParams.get("as");
  try {
    const found = await brandFile(kit, path, as);
    if (!found) return new Response(null, { status: 404 });
    if (found.text !== undefined) return new Response(found.text, { headers: { "Content-Type": found.type ?? "text/plain; charset=utf-8", "Cache-Control": "no-cache" } });
    return found.file ? serveFile(request, found.file, path.at(-1)?.toLowerCase().endsWith(".pdf") && !as ? { "Content-Type": "application/pdf" } : {}) : new Response(null, { status: 404 });
  } catch {
    return new Response(null, { status: 404 });
  }
}
