import { allowed, refused } from "@/lib/studio/films/films";
import { listGraphics } from "@/lib/studio/films/graphics";

// The motion graphics a video film can place: the studio's library, plus a
// film's own with ?film=<id>.
export async function GET(request: Request) {
  if (!allowed(request)) return refused();
  const film = new URL(request.url).searchParams.get("film") ?? undefined;
  return Response.json(await listGraphics(film));
}
