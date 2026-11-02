import { connection } from "next/server";
import { isBrandRunning, linksFor, readBrandChat, runBrandTurn, stopBrandTurn } from "@/lib/studio/brand-claude";
import { checkAttachments } from "@/lib/studio/attachments";
import { kitDir, readBrand } from "@/lib/studio/brands";
import type { ChatEvent } from "@/lib/studio/contract";
import { allowed, refused } from "@/lib/studio/films";

// Claude building or tidying the kit. POST streams the turn (a ChatEvent per
// `data:` line; `done` carries the kit); DELETE stops it; GET is the history.

const missing = () => Response.json({ error: "That kit no longer exists." }, { status: 404 });

export async function GET(request: Request, ctx: RouteContext<"/api/studio/brands/[id]/chat">) {
  await connection();
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  if (!(await readBrand(id))) return missing();
  return Response.json(await readBrandChat(id), { headers: { "x-studio-running": isBrandRunning(id) ? "1" : "0" } });
}

export async function POST(request: Request, ctx: RouteContext<"/api/studio/brands/[id]/chat">) {
  if (!allowed(request)) return refused();
  const { id } = await ctx.params;
  if (!(await readBrand(id))) return missing();
  // `links` (and the older single `url`) are extra links; any in the words
  // count too.
  const body = (await request.json().catch(() => null)) as { prompt?: unknown; url?: unknown; links?: unknown; attachments?: unknown } | null;
  // Attachments must be files already saved in this kit's guide/.
  const attachments = await checkAttachments(kitDir(id), "guide", body?.attachments);
  let prompt = typeof body?.prompt === "string" ? body.prompt.slice(0, 20_000) : "";
  if (!prompt.trim() && attachments.length) prompt = "Have a look at what I attached.";
  if (!prompt.trim()) return Response.json({ error: "Type what you'd like changed in the kit." }, { status: 400 });
  const extra = [
    ...(typeof body?.url === "string" ? [body.url] : []),
    ...(Array.isArray(body?.links) ? body.links.filter((l): l is string => typeof l === "string").slice(0, 12) : []),
  ];
  const links = linksFor(prompt, extra);
  if (isBrandRunning(id)) return Response.json({ error: "Claude is still working on this kit. Wait for it, or stop it first." }, { status: 409 });

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
      void runBrandTurn(id, prompt, links, emit, attachments).finally(() => {
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
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/studio/brands/[id]/chat">) {
  if (!allowed(request)) return refused();
  return Response.json({ stopped: stopBrandTurn((await ctx.params).id) });
}
