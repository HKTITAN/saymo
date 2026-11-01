import { exportStatus, startExport } from "@/lib/tool/exporter";
import { readDoc } from "@/lib/tool/store";

// How the post's video export stands.
export async function GET(_req: Request, ctx: RouteContext<"/api/posts/[id]/export">) {
  const { id } = await ctx.params;
  return Response.json(await exportStatus(id));
}

// Makes the 4K and 1080p video and still of the post as it is saved now.
export async function POST(_req: Request, ctx: RouteContext<"/api/posts/[id]/export">) {
  const { id } = await ctx.params;
  const doc = await readDoc(id);
  if (!doc) return Response.json({ error: "That post no longer exists." }, { status: 404 });
  if (!doc.photo || !doc.speaker.name.trim()) {
    return Response.json({ error: "Add the speaker's name and photo first." }, { status: 409 });
  }
  startExport(id);
  return Response.json(await exportStatus(id), { status: 202 });
}
