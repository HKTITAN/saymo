import {
  type ChatEvent,
  type ChatMessage,
  type ChatRequest,
  type Engine,
  type Film,
  type FilmEdit,
  type FilmSummary,
  type RenderStatus,
  STUDIO_HEADERS,
} from "@/lib/studio/contract";

// The studio's calls to its own routes under /api/studio. Every request
// carries STUDIO_HEADERS; the server refuses anything that changes a film
// without them.

export class StudioError extends Error {}

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { ...STUDIO_HEADERS, ...init.headers } });
  } catch {
    throw new StudioError("Unable to reach the studio. Check that it's still running, then try again.");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const said = body && typeof body === "object" && "error" in body ? String(body.error) : text.slice(0, 200);
    throw new StudioError(said || `The studio answered with error ${res.status}. Try again in a moment.`);
  }
  return body as T;
}

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const film = (id: string) => `/api/studio/films/${id}`;

export const api = {
  list: () => call<FilmSummary[]>("/api/studio/films"),
  create: (body: { title?: string; engine?: Engine; kind?: "motion" | "video"; width?: number; height?: number }) =>
    call<Film>("/api/studio/films", send("POST", body)),
  get: (id: string) => call<Film>(film(id)),
  edit: (id: string, edit: FilmEdit) => call<Film>(film(id), send("PATCH", edit)),
  remove: (id: string) => call<void>(film(id), { method: "DELETE" }),
  duplicate: (id: string) => call<Film>(`${film(id)}/duplicate`, send("POST")),
  // The conversation so far, and whether Claude is still working on a turn
  // (a turn carries on when the page closes or reloads).
  history: async (id: string) => {
    let res: Response;
    try {
      res = await fetch(`${film(id)}/chat`, { headers: STUDIO_HEADERS });
    } catch {
      throw new StudioError("Unable to reach the studio. Check that it's still running, then try again.");
    }
    if (!res.ok) throw new StudioError(`Unable to load the chat (error ${res.status}). Try again in a moment.`);
    const messages = ((await res.json().catch(() => [])) ?? []) as ChatMessage[];
    return { messages, running: res.headers.get("x-studio-running") === "1" };
  },
  stop: (id: string) => call<void>(`${film(id)}/chat`, { method: "DELETE" }),
  undo: (id: string) => call<Film>(`${film(id)}/undo`, send("POST")),
  render: (id: string, quality: "draft" | "final") =>
    call<RenderStatus>(`${film(id)}/render`, send("POST", { quality })),
  renderStatus: (id: string) => call<RenderStatus>(`${film(id)}/render`),
};

export const outUrl = (id: string, file: string, download = false) =>
  `${film(id)}/out/${encodeURIComponent(file)}${download ? "?download=1" : ""}`;

export const stageUrl = (id: string) => `/studio/stage/${id}`;

// Sends one prompt and hands each event of Claude's turn to `onEvent` as it
// arrives. The answer is a stream of `data: {json}` lines (server-sent
// events). Resolves when the stream ends; aborting the signal stops reading.
export function chat(id: string, request: ChatRequest, onEvent: (event: ChatEvent) => void, signal?: AbortSignal) {
  return streamEvents(`${film(id)}/chat`, request, onEvent, signal);
}

// POSTs `body` to `url` and reads the answer as server-sent ChatEvents.
// Shared by a film's chat and a brand kit's.
export async function streamEvents(url: string, body: unknown, onEvent: (event: ChatEvent) => void, signal?: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(url, {
      ...send("POST", body),
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...STUDIO_HEADERS },
      signal,
    });
  } catch (error) {
    if (signal?.aborted) return;
    void error;
    throw new StudioError("Unable to reach Claude. Check that the studio is still running, then try again.");
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    let said = text;
    try {
      said = JSON.parse(text).error ?? text;
    } catch {}
    throw new StudioError(said || `Claude couldn't start (error ${res.status}). Try again in a moment.`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      // Events are separated by a blank line; each holds `data:` lines.
      let end = buffer.indexOf("\n\n");
      while (end !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) {
          try {
            onEvent(JSON.parse(data) as ChatEvent);
          } catch {}
        }
        end = buffer.indexOf("\n\n");
      }
    }
  } catch (error) {
    if (!signal?.aborted) throw error;
  }
}
