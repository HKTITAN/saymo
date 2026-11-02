import { allowed, refused } from "@/lib/studio/films";
import { dropImport, readImport, SlidesError } from "@/lib/studio/slides";
import { checkOptions, makeSlideFilm } from "@/lib/studio/slides-film";
import type { SlidesEvent } from "@/lib/studio/slides-shared";
import { eventStream } from "@/lib/studio/sse";

// "Turn slides into a video", step 2: the motion film made from the slides
// kept, in her order, with the options she chose. Streams SlidesEvents;
// the last is "made", with the film and its first prompt to Claude.
export async function POST(request: Request, ctx: RouteContext<"/api/studio/slides/[imp]/film">) {
  if (!allowed(request)) return refused();
  const { imp } = await ctx.params;
  if (!(await readImport(imp))) return Response.json({ error: "Those slides are gone. Start again." }, { status: 404 });
  const options = await checkOptions(await request.json().catch(() => null));
  if (typeof options === "string") return Response.json({ error: options }, { status: 400 });
  return eventStream<SlidesEvent>(
    async (emit) => {
      const made = await makeSlideFilm(imp, options, (label) => emit({ kind: "step", label }));
      await dropImport(imp);
      emit({ kind: "made", ...made });
    },
    (error) => {
      if (!(error instanceof SlidesError)) console.error("Making a film from slides failed:", error);
      return { kind: "error", message: error instanceof SlidesError ? error.message : "The film couldn't be made. Try again." };
    },
  );
}
