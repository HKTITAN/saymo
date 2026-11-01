import { readBrand, saveBrandFile, withBrand } from "@/lib/studio/brands";
import { allowed, refused } from "@/lib/studio/films";

// A font, logo or guideline file, sorted into fonts/, logos/ or guide/.
// The name comes in `x-file-name` (URL-encoded); the body is the file.
export async function POST(request: Request, ctx: RouteContext<"/api/studio/brands/[id]/files">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  if (!(await readBrand(id))) return Response.json({ error: "That kit no longer exists." }, { status: 404 });
  const name = decodeURIComponent(request.headers.get("x-file-name") ?? "");
  if (!name || !request.body) return Response.json({ error: "Send the file with its name." }, { status: 400 });
  const body = request.body;
  try {
    const file = await withBrand(id, () => saveBrandFile(id, name, body));
    return Response.json({ file }, { status: 201 });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
