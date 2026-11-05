import { allowed, refused } from "@/lib/studio/films";
import { cleanIdeas, readIdeas, writeIdeas } from "@/lib/studio/ideas";

// The Ideas page's list (ideas.ts). GET: every idea. PUT [ideas]: the whole
// list as it is now (it's small); answers with it as saved.

export async function GET(request: Request) {
  if (!allowed(request)) return refused();
  return Response.json(await readIdeas());
}

export async function PUT(request: Request) {
  if (!allowed(request)) return refused();
  const list = cleanIdeas(await request.json().catch(() => null));
  if (!list) return Response.json({ error: "Send the list of ideas." }, { status: 400 });
  await writeIdeas(list);
  return Response.json(list);
}
