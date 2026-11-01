import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { isId, postDir } from "@/lib/tool/store";

const TYPES = { png: "image/png", jpg: "image/jpeg" } as const;

// A post's photo and image files, for the preview and the export. Every
// new version gets a new `?v=`, so each one can be kept for good.
export async function GET(_req: Request, ctx: RouteContext<"/api/posts/[id]/files/[name]">) {
  const { id, name } = await ctx.params;
  const match = /^[a-z0-9-]+\.(png|jpg)$/.exec(name);
  if (!isId(id) || !match) return new Response(null, { status: 404 });
  const file = path.join(postDir(id), name);
  const info = await stat(file).catch(() => null);
  if (!info) return new Response(null, { status: 404 });
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: {
      "Content-Type": TYPES[match[1] as keyof typeof TYPES],
      "Content-Length": String(info.size),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
