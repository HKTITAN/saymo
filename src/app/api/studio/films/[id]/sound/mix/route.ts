import { allowed, readFilm, refused } from "@/lib/studio/films";
import { cleanSpans, readMix, remixSound, soundStatus, writeMix } from "@/lib/studio/sound-render";

const missing = () => Response.json({ error: "That film no longer exists." }, { status: 404 });

// The volume edits made by hand on the timeline's Music and Effects lanes
// (sound.ts SoundMix).
export async function GET(request: Request, ctx: RouteContext<"/api/studio/films/[id]/sound/mix">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  if (!(await readFilm(id))) return missing();
  return Response.json(await readMix(id));
}

// Saves the edits (all of them, replacing what was there) and mixes the
// stems again, which takes about a second; answers once the new sound.wav
// is in place.
export async function PUT(request: Request, ctx: RouteContext<"/api/studio/films/[id]/sound/mix">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  const film = await readFilm(id);
  if (!film) return missing();
  const now = await soundStatus(id);
  if (now.state === "none") {
    return Response.json({ error: "This film has no sound yet. Ask Claude to make some." }, { status: 409 });
  }
  const body = (await request.json().catch(() => null)) as { spans?: unknown } | null;
  if (!body || !Array.isArray(body.spans)) {
    return Response.json({ error: "Send the edits as { spans: [...] }." }, { status: 400 });
  }
  const spans = cleanSpans(body.spans, film.duration);
  await writeMix(id, spans);
  await remixSound(id);
  return Response.json({ mix: { spans }, status: await soundStatus(id) });
}
