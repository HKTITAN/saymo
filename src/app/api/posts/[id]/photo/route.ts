import type { Crop } from "@/lib/tool/doc";
import { bakePhoto, clampCrop, savePhoto } from "@/lib/tool/images";
import { fileUrl, postDir, readDoc, withPost, writeDoc } from "@/lib/tool/store";

const missing = () => Response.json({ error: "That post no longer exists." }, { status: 404 });
const PLAIN_FAILED = "Could not pick out the person in this photo, so its own background stays.";

// A new speaker photo, sent as the form field "file". The face is framed
// as on the original post and, unless it fails, the background is made the
// same plain grey.
export async function POST(req: Request, ctx: RouteContext<"/api/posts/[id]/photo">) {
  const { id } = await ctx.params;
  const file = (await req.formData().catch(() => null))?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No photo was sent." }, { status: 400 });
  const upload = Buffer.from(await file.arrayBuffer());

  return withPost(id, async () => {
    const doc = await readDoc(id);
    if (!doc) return missing();
    const dir = postDir(id);
    let saved;
    try {
      saved = await savePhoto(dir, upload);
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 422 });
    }
    const plain = await bakePhoto(dir, saved.crop, true);
    doc.photo = {
      x1: fileUrl(id, "photo-240.png"),
      x2: fileUrl(id, "photo-480.png"),
      source: { width: saved.width, height: saved.height, preview: fileUrl(id, "photo-preview.jpg") },
      crop: saved.crop,
      plain,
    };
    doc.updatedAt = new Date().toISOString();
    await writeDoc(doc);
    return Response.json({
      photo: doc.photo,
      updatedAt: doc.updatedAt,
      note: plain ? undefined : PLAIN_FAILED,
    });
  });
}

// A new crop, or the plain background on or off: { crop?, plain? }.
export async function PATCH(req: Request, ctx: RouteContext<"/api/posts/[id]/photo">) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { crop?: Crop; plain?: boolean };

  return withPost(id, async () => {
    const doc = await readDoc(id);
    if (!doc) return missing();
    const photo = doc.photo;
    if (!photo?.source || !photo.crop) {
      return Response.json({ error: "Upload a photo first." }, { status: 409 });
    }
    const { width, height } = photo.source;
    const crop = body.crop ? clampCrop(body.crop, width, height) : photo.crop;
    const wanted = typeof body.plain === "boolean" ? body.plain : photo.plain;
    const plain = await bakePhoto(postDir(id), crop, wanted);
    doc.photo = {
      ...photo,
      x1: fileUrl(id, "photo-240.png"),
      x2: fileUrl(id, "photo-480.png"),
      crop,
      plain,
    };
    doc.updatedAt = new Date().toISOString();
    await writeDoc(doc);
    return Response.json({
      photo: doc.photo,
      updatedAt: doc.updatedAt,
      note: wanted && !plain ? PLAIN_FAILED : undefined,
    });
  });
}
