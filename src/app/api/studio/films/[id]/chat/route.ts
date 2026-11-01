import { connection } from "next/server";
import { isRunning, readChat, runTurn, stopTurn } from "@/lib/studio/claude";
import type { ChatContext, ChatEvent, ChatRequest } from "@/lib/studio/contract";
import { allowed, readFilm, refused } from "@/lib/studio/films";

// The film's conversation with Claude. POST sends one message and streams
// back what happens (text/event-stream, one ChatEvent per `data:` line);
// the turn carries on even if the page goes away. DELETE stops it; GET is
// the history.

const missing = () => Response.json({ error: "That film no longer exists." }, { status: 404 });

export async function GET(request: Request, ctx: RouteContext<"/api/studio/films/[id]/chat">) {
  await connection();
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  if (!(await readFilm(id))) return missing();
  return Response.json(await readChat(id), { headers: { "x-studio-running": isRunning(id) ? "1" : "0" } });
}

export async function POST(request: Request, ctx: RouteContext<"/api/studio/films/[id]/chat">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  if (!(await readFilm(id))) return missing();
  const body = (await request.json().catch(() => null)) as Partial<ChatRequest> | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.slice(0, 8000) : "";
  if (!prompt.trim()) return Response.json({ error: "Type what you'd like changed." }, { status: 400 });
  if (isRunning(id)) {
    return Response.json({ error: "Claude is still working on this film. Wait for it, or stop it first." }, { status: 409 });
  }

  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: ChatEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          open = false;
        }
      };
      void runTurn(id, { prompt, context: context(body?.context) }, emit).finally(() => {
        if (!open) return;
        open = false;
        controller.close();
      });
    },
    cancel() {
      // The page went away: the turn keeps going and its history is saved.
      open = false;
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/studio/films/[id]/chat">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  return Response.json({ stopped: stopTurn(id) });
}

// Only what's expected from the page, so nothing odd reaches the prompt.
function context(raw: unknown): ChatContext {
  const c = (raw ?? {}) as Partial<ChatContext>;
  const t = Number.isFinite(c.t) ? Math.max(0, Number(c.t)) : 0;
  // Selected timeline items: ids only, in the shape edit.json uses.
  const selection = Array.isArray(c.selection)
    ? c.selection.filter((s): s is string => typeof s === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(s)).slice(0, 50)
    : [];
  const extra = selection.length ? { selection } : {};
  const p = c.pick;
  if (!p || typeof p !== "object") return { t, pick: null, ...extra };
  const num = (v: unknown) => (Number.isFinite(v) ? Number(v) : 0);
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) || null : null);
  const r = p.rect;
  return {
    t,
    ...extra,
    pick: {
      x: num(p.x),
      y: num(p.y),
      id: str(p.id, 80),
      tag: str(p.tag, 20),
      text: str(p.text, 80),
      rect: r && typeof r === "object" ? { x: num(r.x), y: num(r.y), width: num(r.width), height: num(r.height) } : null,
    },
  };
}
