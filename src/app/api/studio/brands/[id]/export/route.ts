import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { exportBrand, readBrand } from "@/lib/studio/brands";
import { allowed, refused } from "@/lib/studio/films";

// The kit as a .zip, to share or import into another studio.
export async function GET(request: Request, ctx: RouteContext<"/api/studio/brands/[id]/export">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  const kit = await readBrand(id);
  if (!kit) return new Response(null, { status: 404 });
  const zip = await exportBrand(id);
  const bytes = await readFile(zip);
  await rm(path.dirname(zip), { recursive: true, force: true });
  const name = `${kit.name.replace(/[^\w -]+/g, "").trim().replace(/\s+/g, "-") || "brand"}-kit.zip`;
  return new Response(bytes, {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
