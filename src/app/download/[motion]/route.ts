import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { MOTION_BY_ID } from "@/components/post/lines";
import { post } from "@/content/post";
import { TEAM_SLUG } from "@/content/team-slug";

// Hands the 4K video of one motion to the browser as a download. The files
// are made by `npm run export` and live in export/. While an export is still
// writing one (a .part file) the request waits for it, rather than handing
// out half a video; with no video at all it answers 204, so the browser
// never saves an error message as a file.
// `?status` answers { state: "ready" | "exporting" | "missing", percent }
// for the toolbar instead.

const EXPORT_DIR = path.join(process.cwd(), "export");
const WAIT_MS = 10 * 60 * 1000; // longest an export can take to finish
const exists = (file: string) => stat(file).catch(() => null);

export async function GET(req: Request, ctx: RouteContext<"/download/[motion]">) {
  const { motion } = await ctx.params;
  if (!Object.hasOwn(MOTION_BY_ID, motion)) {
    return new Response(null, { status: 404 });
  }

  // `?post=team` hands out the team post's video instead.
  const isTeam = new URL(req.url).searchParams.get("post") === "team";
  const name = isTeam
    ? `aerchain-team-${TEAM_SLUG}-${motion}-4k.mp4`
    : `aerchain-speaker-${post.slug}-${motion}-4k.mp4`;
  const file = path.join(EXPORT_DIR, name);
  const part = `${file}.part`;

  if (new URL(req.url).searchParams.has("status")) {
    // A new version being made wins over the finished file still on disk:
    // that one is the old version until the export replaces it.
    const exporting = Boolean(await exists(part));
    const ready = !exporting && Boolean(await exists(file));
    const progress = await readFile(path.join(EXPORT_DIR, "progress.json"), "utf8")
      .then((text) => JSON.parse(text) as { percent?: number })
      .catch(() => null);
    return Response.json(
      {
        state: ready ? "ready" : exporting ? "exporting" : "missing",
        percent: exporting ? (progress?.percent ?? null) : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // While a new version is being made, wait for it rather than hand out the
  // old one.
  const start = Date.now();
  while (!req.signal.aborted && (await exists(part)) && Date.now() - start < WAIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const info = await exists(file);
  if (!info || (await exists(part))) return new Response(null, { status: 204 });

  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(info.size),
      "Content-Disposition": `attachment; filename="${name}"`,
      // Never a cached copy of an older export.
      "Cache-Control": "no-store",
    },
  });
}
