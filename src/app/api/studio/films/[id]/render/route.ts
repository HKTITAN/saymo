import { allowed, readFilm, refused } from "@/lib/studio/films";
import { ensureDraft, renderStatus, startRender } from "@/lib/studio/render";

const missing = () => Response.json({ error: "That film no longer exists." }, { status: 404 });

// Where the film's render is. With ?stage=1 (asked by a Rust film's stage,
// which plays its draft), a draft is started if the film changed since the
// last one, and `current` says whether the draft on disk is up to date.
export async function GET(request: Request, ctx: RouteContext<"/api/studio/films/[id]/render">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  const film = await readFilm(id);
  if (!film) return missing();
  if (new URL(request.url).searchParams.get("stage") === "1" && film.engine === "rust") {
    return Response.json(await ensureDraft(id));
  }
  return Response.json(await renderStatus(id));
}

// Starts a render: "draft" (quick, the film's own size), "final" (4K and
// the film's own size) or "sizes" (every size, each laid out for its frame). One render runs at a time; others wait in line.
export async function POST(request: Request, ctx: RouteContext<"/api/studio/films/[id]/render">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  if (!(await readFilm(id))) return missing();
  const body = (await request.json().catch(() => null)) as { quality?: unknown } | null;
  const quality = body?.quality === "draft" || body?.quality === "final" || body?.quality === "sizes" ? body.quality : null;
  if (!quality) return Response.json({ error: 'Ask for a "draft", "final" or "sizes" render.' }, { status: 400 });
  startRender(id, quality);
  return Response.json(await renderStatus(id), { status: 202 });
}
