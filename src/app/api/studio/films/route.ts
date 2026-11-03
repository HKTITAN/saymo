import { restoreCarryOns } from "@/lib/studio/carry-on";
import { runAutoTurn } from "@/lib/studio/claude";
import { allowed, createFilm, listFilms, refused } from "@/lib/studio/films";
import { nameOldFilms } from "@/lib/studio/naming";
import { startSound } from "@/lib/studio/sound-render";
import { newFilm } from "@/lib/studio/validate";

// The studio's films, newest first.
export async function GET(request: Request) {
  if (!allowed(request)) return refused();
  // After a restart, films waiting to carry on by themselves pick up again.
  void restoreCarryOns(runAutoTurn);
  // Films made before films named themselves get a name, once per server.
  nameOldFilms();
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
