import { allowed, refused } from "@/lib/studio/films";
import { startTranscription } from "@/lib/studio/media";

// Starts listening to what's said in a file (its words and their times go
// to transcript.json). Answers with the record, `transcribing` set; poll
// the media list until it clears. The first time ever, the studio sets up
// listening and fetches the speech model, which takes a few minutes.
export async function POST(request: Request, ctx: RouteContext<"/api/studio/films/[id]/media/[mid]/transcribe">) {
  if (!allowed(request)) return refused();
  const { id, mid } = await ctx.params;
  const result = await startTranscription(id, mid);
  if (result === null) return Response.json({ error: "That file isn't in this film." }, { status: 404 });
  if (result === "not ready") return Response.json({ error: "Wait until the file has finished coming in." }, { status: 409 });
  if (result === "no sound") return Response.json({ error: "This file has no sound to listen to." }, { status: 409 });
  return Response.json(result, { status: 202 });
}
