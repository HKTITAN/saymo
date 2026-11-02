// A route's answer as server-sent events: `job` gets `emit` and runs while
// the stream is open; each event is one `data:` line. When the page goes
// away the job carries on, its events dropped.

export function eventStream<E>(job: (emit: (event: E) => void) => Promise<void>, onError: (error: unknown) => E) {
  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: E) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          open = false;
        }
      };
      job(emit)
        .catch((error) => emit(onError(error)))
        .finally(() => {
          if (!open) return;
          open = false;
          controller.close();
        });
    },
    cancel() {
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
