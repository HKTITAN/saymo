import { failed } from "@/lib/studio/connect/connect-http";
import { allowed, refused } from "@/lib/studio/films/films";
import { chooseRepo } from "@/lib/studio/connect/github";

// { owner, name }: uses that private repository for the film library, or
// makes it (private) if it doesn't exist.
export async function PUT(request: Request) {
  if (!allowed(request)) return refused();
  const body = (await request.json().catch(() => null)) as { owner?: unknown; name?: unknown } | null;
  if (typeof body?.owner !== "string" || typeof body?.name !== "string") {
    return Response.json({ error: "Say who owns the repository and what it's called." }, { status: 400 });
  }
  try {
    return Response.json(await chooseRepo(body.owner, body.name));
  } catch (error) {
    return failed(error);
  }
}
