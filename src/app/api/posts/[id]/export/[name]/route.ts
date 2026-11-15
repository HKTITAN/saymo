import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { exportDir } from "@/lib/tool/exporter";
import { isId } from "@/lib/tool/store";

const TYPES = { mp4: "video/mp4", png: "image/png" } as const;

// Hands one exported file to the browser as a download.
export async function GET(_req: Request, ctx: RouteContext<"/api/posts/[id]/export/[name]">) {
  const { id, name } = await ctx.params;
  const match = /^speaker-post-[a-z0-9-]+\.(mp4|png)$/.exec(name);
  if (!isId(id) || !match) return new Response(null, { status: 404 });
  const file = path.join(exportDir(id), name);
  const info = await stat(file).catch(() => null);
  if (!info) return new Response(null, { status: 404 });
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: {
      "Content-Type": TYPES[match[1] as keyof typeof TYPES],
      "Content-Length": String(info.size),
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
