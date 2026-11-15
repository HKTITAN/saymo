import { AttachmentError, saveAttachment } from "@/lib/studio/input/attachments";
import { allowed, filmDir, readFilm, refused } from "@/lib/studio/films/films";

// A file attached to a prompt, saved in the film's refs/ for Claude to read.
// The body is the file, its name in `x-file-name` (URL-encoded).
export async function POST(request: Request, ctx: RouteContext<"/api/studio/films/[id]/attachments">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  if (!(await readFilm(id))) return Response.json({ error: "That film no longer exists." }, { status: 404 });
  let name = request.headers.get("x-file-name") ?? "";
  try {
    name = decodeURIComponent(name);
  } catch {}
  if (!name || !request.body) return Response.json({ error: "Send the file with its name." }, { status: 400 });
  try {
    return Response.json(await saveAttachment(filmDir(id), "refs", name, request.body), { status: 201 });
  } catch (error) {
    const known = error instanceof AttachmentError;
    return Response.json({ error: known ? error.message : "The file couldn't be attached. Try again." }, { status: known ? 400 : 500 });
  }
}
