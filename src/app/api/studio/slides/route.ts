import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { allowed, refused } from "@/lib/studio/films/films";
import { addToImport, importDir, newImport, readImport, SlidesError } from "@/lib/studio/input/slides";
import { extOf, isImageFile, isSlideFile, MAX_DECK_BYTES, MAX_IMAGE_BYTES, type SlidesEvent } from "@/lib/studio/input/slides-shared";
import { eventStream } from "@/lib/studio/server/sse";

// "Turn slides into a video", step 1: one file (a deck or a picture) at a
// time becomes slides. The body is the file, its name in `x-file-name`
// (URL-encoded); `x-import` adds to slides already brought in. The answer
// streams SlidesEvents: steps as it works, then the whole import.
export async function POST(request: Request) {
  if (!allowed(request)) return refused();
  let name = request.headers.get("x-file-name") ?? "";
  try {
    name = decodeURIComponent(name);
  } catch {}
  name = path.basename(name).replace(/[\u0000-\u001f]/g, "").trim().slice(0, 200);
  if (!name || !request.body) return Response.json({ error: "Send the file with its name." }, { status: 400 });
  if (!isSlideFile(name)) {
    return Response.json({ error: `${name} isn't slides. Drop a PDF, PowerPoint, Keynote or OpenDocument file, or pictures.` }, { status: 400 });
  }
  const asked = request.headers.get("x-import");
  const imp = asked ? await readImport(asked) : await newImport();
  if (!imp) return Response.json({ error: "Those slides are gone. Start again." }, { status: 404 });

  // Saved first, with a size cap, then converted.
  const limit = isImageFile(name) ? MAX_IMAGE_BYTES : MAX_DECK_BYTES;
  const file = path.join(importDir(imp.id), `upload-${Date.now().toString(36)}.${extOf(name)}`);
  let bytes = 0;
  const cap = new Transform({
    transform(chunk: Buffer, _enc, done) {
      bytes += chunk.length;
      if (bytes > limit) done(new SlidesError(`${name} is over ${limit / 1024 / 1024} MB.`));
      else done(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(request.body as import("node:stream/web").ReadableStream), cap, createWriteStream(file));
  } catch (error) {
    await rm(file, { force: true });
    const message = error instanceof SlidesError ? error.message : `${name} didn't arrive in full. Try again.`;
    return Response.json({ error: message }, { status: 400 });
  }

  return eventStream<SlidesEvent>(
    async (emit) => {
      try {
        const done = await addToImport(imp.id, file, name, (label) => emit({ kind: "step", label }));
        emit({ kind: "done", import: done });
      } finally {
        await rm(file, { force: true });
      }
    },
    (error) => {
      if (!(error instanceof SlidesError)) console.error("Slides import failed:", error);
      return {
        kind: "error",
        message: error instanceof SlidesError ? error.message : `${name} couldn't be turned into slides. Try exporting it as a PDF.`,
      };
    },
  );
}
