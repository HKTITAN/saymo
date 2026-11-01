import { copyFile } from "node:fs/promises";
import path from "node:path";
import { fileUrl, postDir, readDoc, withPost, writeDoc } from "@/lib/tool/store";

// Goes back to an earlier landmark made with AI: { file }. It starts
// centred at 100%, like any new landmark.
export async function POST(req: Request, ctx: RouteContext<"/api/posts/[id]/image/take">) {
  const { id } = await ctx.params;
  const { file } = (await req.json().catch(() => ({}))) as { file?: unknown };

  return withPost(id, async () => {
    const doc = await readDoc(id);
    if (!doc) return Response.json({ error: "That post no longer exists." }, { status: 404 });
    const take = doc.takes?.find((t) => t.file === file);
    if (!take) return Response.json({ error: "That earlier try is gone." }, { status: 404 });
    const dir = postDir(id);
    await copyFile(path.join(dir, take.file), path.join(dir, "image.png"));
    const url = fileUrl(id, "image.png");
    doc.image = {
      name: take.name,
      x1: url,
      x2: url,
      width: take.width,
      height: take.height,
      place: { x: 0, y: 0, scale: 1 },
      note: take.note,
      take: take.file,
    };
    doc.updatedAt = new Date().toISOString();
    await writeDoc(doc);
    return Response.json({ image: doc.image, updatedAt: doc.updatedAt });
  });
}
