import type { DocEdit } from "@/lib/tool/doc";
import { applyEdit, deleteDoc, readDoc, withPost, writeDoc } from "@/lib/tool/store";

const missing = () => Response.json({ error: "That post no longer exists." }, { status: 404 });

export async function GET(_req: Request, ctx: RouteContext<"/api/posts/[id]">) {
  const { id } = await ctx.params;
  const doc = await readDoc(id);
  return doc ? Response.json(doc) : missing();
}

// Saves what the browser edits: the words and where the image sits.
export async function PUT(req: Request, ctx: RouteContext<"/api/posts/[id]">) {
  const { id } = await ctx.params;
  const edit = (await req.json().catch(() => null)) as Partial<DocEdit> | null;
  if (!edit || typeof edit !== "object") {
    return Response.json({ error: "Nothing to save." }, { status: 400 });
  }
  return withPost(id, async () => {
    const doc = await readDoc(id);
    if (!doc) return missing();
    const next = { ...applyEdit(doc, edit), updatedAt: new Date().toISOString() };
    await writeDoc(next);
    return Response.json({ updatedAt: next.updatedAt });
  });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/posts/[id]">) {
  const { id } = await ctx.params;
  await withPost(id, () => deleteDoc(id));
  return new Response(null, { status: 204 });
}
