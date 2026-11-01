import { allowed, createFilm, listFilms, refused } from "@/lib/studio/films";
import { startSound } from "@/lib/studio/sound-render";
import { newFilm } from "@/lib/studio/validate";

// The studio's films, newest first.
export async function GET(request: Request) {
  if (!allowed(request)) return refused();
  return Response.json(await listFilms());
}

// A new film, copied from the starter for its kind (an HTML film unless
// asked otherwise).
export async function POST(request: Request) {
  if (!allowed(request)) return refused();
  const settings = newFilm(await request.json().catch(() => null));
  if (typeof settings === "string") return Response.json({ error: settings }, { status: 400 });
  const film = await createFilm(settings);
  // Its starter's sound, rendered in the background (a few seconds).
  void startSound(film.id);
  return Response.json(film, { status: 201 });
}
