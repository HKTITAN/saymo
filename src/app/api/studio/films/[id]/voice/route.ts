import { allowed, readFilm, refused } from "@/lib/studio/films";
import { MediaError } from "@/lib/studio/media";
import { makeVoiceover } from "@/lib/studio/voice";

// Reads words out in one of the Mac's voices and brings the result into the
// film as a sound file: { text, voice?, rate?, name? } → Media ("importing").
export async function POST(request: Request, ctx: RouteContext<"/api/studio/films/[id]/voice">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  const film = await readFilm(id);
  if (!film) return Response.json({ error: "That film no longer exists." }, { status: 404 });
  if (film.kind !== "video") return Response.json({ error: "Voiceovers go into a video film." }, { status: 409 });
  const body = (await request.json().catch(() => null)) as { text?: unknown; voice?: unknown; rate?: unknown; name?: unknown } | null;
  if (typeof body?.text !== "string") return Response.json({ error: "Send the words to read out." }, { status: 400 });
  try {
    const media = await makeVoiceover(id, {
      text: body.text,
      voice: typeof body.voice === "string" ? body.voice : undefined,
      rate: typeof body.rate === "number" ? body.rate : undefined,
      name: typeof body.name === "string" ? body.name : undefined,
    });
    return Response.json(media, { status: 201 });
  } catch (error) {
    const message = error instanceof MediaError ? error.message : "The voiceover couldn't be made.";
    return Response.json({ error: message }, { status: error instanceof MediaError ? 400 : 500 });
  }
}
