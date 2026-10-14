import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { MOTION_BY_ID } from "@/components/post/lines";
import { VERSIONS } from "@/components/post/versions";
import { post } from "@/content/post";

// Hands the 4K video of one version and motion to the browser as a download.
// The files are made by `npm run export` and live in export/.
export async function GET(_req: Request, ctx: RouteContext<"/download/[version]/[motion]">) {
  const { version, motion } = await ctx.params;
  const v = VERSIONS.find((x) => x.id === version);
  if (!v || !Object.hasOwn(MOTION_BY_ID, motion)) {
    return new Response("There is no video with that name.", { status: 404 });
  }

  const name = `aerchain-speaker-${post.slug}${v.suffix}-${motion}-4k.mp4`;
  const file = path.join(process.cwd(), "export", name);
  const info = await stat(file).catch(() => null);
  if (!info) {
    return new Response("This video has not been exported yet. Run npm run export.", {
      status: 404,
    });
  }

  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(info.size),
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}
