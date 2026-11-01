import { copyFile, rm } from "node:fs/promises";
import path from "node:path";
import type { Take } from "@/lib/tool/doc";
import { GenerateError, generateLandmark } from "@/lib/tool/generate";
import { saveImage } from "@/lib/tool/images";
import { fileUrl, postDir, readDoc, withPost, writeDoc } from "@/lib/tool/store";

const missing = () => Response.json({ error: "That post no longer exists." }, { status: 404 });
const KEEP = 8; // earlier tries kept per post

// A landmark made with AI from what was typed ("Dubai"), in the post's own
// style, cut out and stood on the panel like an upload. Each one is also
// kept as an earlier try.
export async function POST(req: Request, ctx: RouteContext<"/api/posts/[id]/image/generate">) {
  const { id } = await ctx.params;
  const { place } = (await req.json().catch(() => ({}))) as { place?: unknown };
  const words = typeof place === "string" ? place.trim().slice(0, 80) : "";
  if (!words) return Response.json({ error: "Type a city or a landmark first." }, { status: 400 });
  if (!(await readDoc(id))) return missing();

  // The post is not held while the picture is being made.
  let made;
  try {
    made = await generateLandmark(words);
  } catch (error) {
    if (!(error instanceof GenerateError)) throw error;
    return Response.json({ error: error.message, action: error.action }, { status: error.status });
  }

  return withPost(id, async () => {
    const doc = await readDoc(id);
    if (!doc) return missing();
    const dir = postDir(id);
    let saved;
    try {
      saved = await saveImage(dir, made.image);
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 422 });
    }
    const file = `take-${Date.now().toString(36)}.png`;
    await copyFile(path.join(dir, "image.png"), path.join(dir, file));
    const take: Take = {
      file,
      url: fileUrl(id, file),
      name: made.name,
      width: saved.width,
      height: saved.height,
      note: `Made with AI from “${words}”.`,
    };
    const takes = [take, ...(doc.takes ?? [])];
    await Promise.all(takes.slice(KEEP).map((t) => rm(path.join(dir, t.file), { force: true })));
    doc.takes = takes.slice(0, KEEP);
    const url = fileUrl(id, "image.png");
    doc.image = {
      name: take.name,
      x1: url,
      x2: url,
      width: take.width,
      height: take.height,
      place: { x: 0, y: 0, scale: 1 },
      note: take.note,
      take: file,
    };
    doc.updatedAt = new Date().toISOString();
    await writeDoc(doc);
    return Response.json({ image: doc.image, takes: doc.takes, updatedAt: doc.updatedAt });
  });
}
