import { allowed, refused } from "@/lib/studio/films/films";
import { restoreItem, toEntry } from "@/lib/studio/library/references";

// Brings a deleted item back from the trash (deleted items wait a day).
export async function POST(request: Request, ctx: RouteContext<"/api/studio/library/[id]/restore">) {
  if (!allowed(request)) return refused();
  const item = await restoreItem((await ctx.params).id);
  return item ? Response.json(toEntry(item)) : Response.json({ error: "That item can't be brought back any more." }, { status: 404 });
}
