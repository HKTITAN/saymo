import { allowed, refused } from "@/lib/studio/films/films";
import { startCutout } from "@/lib/studio/films/media";

// Starts cutting the person out of a video (cutout.webm: them on a
// see-through background, sound kept), for layouts where they stand in
// front of the graphics. Answers with the record, `cutting` set; poll the
// media list until it clears and `cutout` is set.
export async function POST(request: Request, ctx: RouteContext<"/api/studio/films/[id]/media/[mid]/cutout">) {
  if (!allowed(request)) return refused();
  const { id, mid } = await ctx.params;
  const result = await startCutout(id, mid);
  if (result === null) return Response.json({ error: "That file isn't in this film." }, { status: 404 });
  if (result === "not video") return Response.json({ error: "Only a video can be cut out." }, { status: 409 });
  if (result === "not ready") return Response.json({ error: "Wait until the file has finished coming in." }, { status: 409 });
  return Response.json(result, { status: 202 });
}
