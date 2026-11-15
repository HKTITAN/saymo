import { readDump, writeDump } from "@/lib/studio/library/brain-dump";
import { allowed, refused } from "@/lib/studio/films/films";

// The Ideas page's brain dump (brain-dump.ts). GET: { text }. PUT { text }:
// the whole page as it is now; answers with it as saved.

export async function GET(request: Request) {
  if (!allowed(request)) return refused();
  return Response.json({ text: await readDump() });
}

export async function PUT(request: Request) {
  if (!allowed(request)) return refused();
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  if (typeof body?.text !== "string") return Response.json({ error: "Send the notes as text." }, { status: 400 });
  await writeDump(body.text);
  return Response.json({ text: await readDump() });
}
