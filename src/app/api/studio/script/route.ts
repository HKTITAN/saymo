import { allowed, refused } from "@/lib/studio/films";
import { LENGTHS, MAX_IDEA, type ScriptEvent } from "@/lib/studio/script";
import { writeScript } from "@/lib/studio/script-claude";

// Writes a script and storyboard from a topic or a pasted script. POST
// { idea, seconds, keep } streams ScriptEvents back (text/event-stream, one
// event per `data:` line). Closing the page stops Claude.
export async function POST(request: Request) {
  if (!allowed(request)) return refused();
  const body = (await request.json().catch(() => null)) as { idea?: unknown; seconds?: unknown; keep?: unknown } | null;
  const idea = typeof body?.idea === "string" ? body.idea.trim().slice(0, MAX_IDEA) : "";
  if (!idea) return Response.json({ error: "Type a topic, or paste your script." }, { status: 400 });
  const seconds = LENGTHS.find((s) => s === Number(body?.seconds)) ?? 30;
  const keep = body?.keep === true;

  const encoder = new TextEncoder();
  const stop = new AbortController();
  request.signal.addEventListener("abort", () => stop.abort(), { once: true });
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: ScriptEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          open = false;
        }
      };
      writeScript({ idea, seconds, keep }, emit, stop.signal)
        .catch((error) => emit({ kind: "error", message: `Something went wrong: ${String((error as Error)?.message ?? error)}` }))
        .finally(() => {
          if (!open) return;
          open = false;
          controller.close();
        });
    },
    cancel() {
      open = false;
      stop.abort();
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
