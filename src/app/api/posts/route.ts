import { connection } from "next/server";
import type { PostSummary } from "@/lib/tool/doc";
import { exportStatus } from "@/lib/tool/exporter";
import { createDoc, listDocs, readDoc, withPost } from "@/lib/tool/store";

// The tool's posts, newest first, each with how its video export stands.
export async function GET() {
  await connection();
  const docs = await listDocs();
  const posts: PostSummary[] = await Promise.all(
    docs.map(async (doc) => ({ doc, export: await exportStatus(doc.id) })),
  );
  return Response.json(posts);
}

// A new post: { from, mode }. "copy" keeps everything; "next" keeps the
// event and image and clears the speaker. Without `from` it starts from the
// latest post.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { from?: string | null; mode?: string };
  const mode = body.mode === "copy" ? "copy" : "next";
  const fromId = body.from ?? (await listDocs())[0]?.id ?? null;
  const doc = fromId
    ? await withPost(fromId, async () => {
        const from = await readDoc(fromId);
        return from ? createDoc(from, mode) : null;
      })
    : await createDoc(null, mode);
  if (!doc) return Response.json({ error: "That post no longer exists." }, { status: 404 });
  return Response.json(doc, { status: 201 });
}
