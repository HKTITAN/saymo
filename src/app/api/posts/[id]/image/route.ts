import { rm } from "node:fs/promises";
import path from "node:path";
import { saveImage } from "@/lib/tool/images";
import { fileUrl, postDir, readDoc, withPost, writeDoc } from "@/lib/tool/store";

const missing = () => Response.json({ error: "That post no longer exists." }, { status: 404 });
const IMAGE_FILES = ["image.png", "image-source.png", "image-lifted.png"];

// "kuala-lumpur_towers.jpg" reads "Kuala lumpur towers".
const nameFrom = (file: string) => {
  const words = file.replace(/\.[a-z0-9]+$/i, "").replace(/[-_\s]+/g, " ").trim().slice(0, 60);
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// A new landmark, sent as the form field "file": cut out, toned and stood
// on the panel's bottom edge, centred, at 100%.
export async function POST(req: Request, ctx: RouteContext<"/api/posts/[id]/image">) {
  const { id } = await ctx.params;
  const file = (await req.formData().catch(() => null))?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No image was sent." }, { status: 400 });
  const upload = Buffer.from(await file.arrayBuffer());

  return withPost(id, async () => {
    const doc = await readDoc(id);
    if (!doc) return missing();
    let saved;
    try {
      saved = await saveImage(postDir(id), upload);
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 422 });
    }
    const url = fileUrl(id, "image.png");
    doc.image = {
      name: nameFrom(file.name),
      x1: url,
      x2: url,
      width: saved.width,
      height: saved.height,
      place: { x: 0, y: 0, scale: 1 },
      note: saved.note,
    };
    doc.updatedAt = new Date().toISOString();
    await writeDoc(doc);
    return Response.json({ image: doc.image, updatedAt: doc.updatedAt });
  });
}

// No landmark: the lines alone.
export async function DELETE(_req: Request, ctx: RouteContext<"/api/posts/[id]/image">) {
  const { id } = await ctx.params;
  return withPost(id, async () => {
    const doc = await readDoc(id);
    if (!doc) return missing();
    await Promise.all(IMAGE_FILES.map((f) => rm(path.join(postDir(id), f), { force: true })));
    doc.image = null;
    doc.updatedAt = new Date().toISOString();
    await writeDoc(doc);
    return Response.json({ updatedAt: doc.updatedAt });
  });
}
