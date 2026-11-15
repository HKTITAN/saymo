import { allowed, readFilm, refused } from "@/lib/studio/films/films";
import { soundStatus, startSound } from "@/lib/studio/sound/sound-render";

const missing = () => Response.json({ error: "That film no longer exists." }, { status: 404 });

// Where the film's sound is: none yet, rendering (with the step), ready
// (its length and loudness) or failed (why).
export async function GET(request: Request, ctx: RouteContext<"/api/studio/films/[id]/sound">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  if (!(await readFilm(id))) return missing();
  return Response.json(await soundStatus(id));
}

// Renders the film's score again, even if the sound looks current.
export async function POST(request: Request, ctx: RouteContext<"/api/studio/films/[id]/sound">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  if (!(await readFilm(id))) return missing();
  await startSound(id, true);
  const status = await soundStatus(id);
  if (status.state === "none") {
    return Response.json({ error: "This film has no sound yet. Ask Claude to make some." }, { status: 409 });
  }
  return Response.json(status, { status: 202 });
}
