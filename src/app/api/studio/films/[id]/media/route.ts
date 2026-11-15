import { allowed, readFilm, refused } from "@/lib/studio/films/films";
import { importMedia, listMedia, MediaError } from "@/lib/studio/films/media";

// A video film's files (footage, photos, sound), in the order they came in.
export async function GET(request: Request, ctx: RouteContext<"/api/studio/films/[id]/media">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  if (!(await readFilm(id))) return Response.json({ error: "That film no longer exists." }, { status: 404 });
  return Response.json(await listMedia(id));
}

// Brings a file in. The body is the file itself, streamed to disk as it
// arrives (footage can be gigabytes); `x-file-name` is its name, URL-encoded.
// Answers at once with the record ("importing"); the rest happens after.
export async function POST(request: Request, ctx: RouteContext<"/api/studio/films/[id]/media">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  const film = await readFilm(id);
  if (!film) return Response.json({ error: "That film no longer exists." }, { status: 404 });
  if (film.kind !== "video") return Response.json({ error: "Footage goes into a video film." }, { status: 409 });
  const raw = request.headers.get("x-file-name");
  if (!raw || !request.body) return Response.json({ error: "Send the file with its name." }, { status: 400 });
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {}
  try {
    return Response.json(await importMedia(id, name, request.body), { status: 201 });
  } catch (error) {
    const message = error instanceof MediaError ? error.message : "The file couldn't be brought in.";
    return Response.json({ error: message }, { status: error instanceof MediaError ? 400 : 500 });
  }
}
