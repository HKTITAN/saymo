import { cleanBrief, readBrief, writeBrief } from "@/lib/studio/brief";
import { allowed, isId, refused } from "@/lib/studio/films";

// The film's blank-page brief (brief.ts). GET: the brief, or null. PUT: the
// brief as the person left it (a call flipped, or made).

export async function GET(request: Request, ctx: RouteContext<"/api/studio/films/[id]/brief">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  if (!isId(id)) return Response.json({ error: "There's no film with that id." }, { status: 404 });
  return Response.json(await readBrief(id));
}

export async function PUT(request: Request, ctx: RouteContext<"/api/studio/films/[id]/brief">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  if (!isId(id) || !(await readBrief(id))) return Response.json({ error: "This film has no brief." }, { status: 404 });
  const next = cleanBrief(await request.json().catch(() => null));
  if (!next) return Response.json({ error: "Send the brief with its beats." }, { status: 400 });
  await writeBrief(id, next);
  return Response.json(next);
}
