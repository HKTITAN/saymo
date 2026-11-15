import { DEFAULT_PROVIDER, isProviderId } from "@/lib/studio/agent/ai-types";
import { checkAttachments } from "@/lib/studio/input/attachments";
import type { ChatContext } from "@/lib/studio/films/contract";
import { allowed, filmDir, readFilm, refused } from "@/lib/studio/films/films";
import { discardTakes, readTakes, startTakes } from "@/lib/studio/films/takes";

// Three versions of one prompt, made at once (takes.ts). GET says how they're
// going, POST starts them, DELETE stops them and throws them away.

const missing = () => Response.json({ error: "That film no longer exists." }, { status: 404 });

export async function GET(request: Request, ctx: RouteContext<"/api/studio/films/[id]/takes">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  if (!(await readFilm(id))) return missing();
  return Response.json({ takes: await readTakes(id) });
}

export async function POST(request: Request, ctx: RouteContext<"/api/studio/films/[id]/takes">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  if (!(await readFilm(id))) return missing();
  const body = (await request.json().catch(() => null)) as { prompt?: unknown; context?: Partial<ChatContext>; provider?: unknown } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 8000) : "";
  if (!prompt) return Response.json({ error: "Type what you'd like changed." }, { status: 400 });
  const attachments = await checkAttachments(filmDir(id), "refs", body?.context?.attachments);
  const t = Number(body?.context?.t);
  const context: ChatContext = { t: Number.isFinite(t) ? Math.max(0, t) : 0, pick: null, ...(attachments.length ? { attachments } : {}) };
  const provider = isProviderId(body?.provider) ? body.provider : DEFAULT_PROVIDER;
  const takes = await startTakes(id, prompt, context, provider);
  if (typeof takes === "string") return Response.json({ error: takes }, { status: 409 });
  return Response.json({ takes }, { status: 202 });
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/studio/films/[id]/takes">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  await discardTakes(id);
  return new Response(null, { status: 204 });
}
