import { AttachmentError, saveAttachment } from "@/lib/studio/input/attachments";
import { kitDir, readBrand } from "@/lib/studio/brands/brands";
import { allowed, refused } from "@/lib/studio/films/films";

// A file attached to a prompt in the kit's chat, saved in the kit's guide/
// with the rest of what it was made from. The body is the file, its name in
// `x-file-name` (URL-encoded).
export async function POST(request: Request, ctx: RouteContext<"/api/studio/brands/[id]/attachments">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  if (!(await readBrand(id))) return Response.json({ error: "That kit no longer exists." }, { status: 404 });
  let name = request.headers.get("x-file-name") ?? "";
  try {
    name = decodeURIComponent(name);
  } catch {}
  if (!name || !request.body) return Response.json({ error: "Send the file with its name." }, { status: 400 });
  try {
    return Response.json(await saveAttachment(kitDir(id), "guide", name, request.body), { status: 201 });
  } catch (error) {
    const known = error instanceof AttachmentError;
    return Response.json({ error: known ? error.message : "The file couldn't be attached. Try again." }, { status: known ? 400 : 500 });
  }
}
