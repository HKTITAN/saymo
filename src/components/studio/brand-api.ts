import type { BrandKit, BrandSummary } from "@/lib/studio/brand";
import { type ChatEvent, type ChatMessage, STUDIO_HEADERS } from "@/lib/studio/contract";
import { StudioError, streamEvents } from "./api";

// The studio's calls for brand kits (/api/studio/brands). Like the film
// calls, every request carries STUDIO_HEADERS.

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
  } catch {}
  if (!res.ok) {
    const said = body && typeof body === "object" && "error" in body ? String(body.error) : text.slice(0, 200);
    throw new StudioError(said || `The studio answered with error ${res.status}. Try again in a moment.`);
  }
  return body as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const kit = (id: string) => `/api/studio/brands/${id}`;

export const brandApi = {
  list: () => call<BrandSummary[]>("/api/studio/brands"),
  create: (name: string) => call<BrandKit>("/api/studio/brands", json("POST", { name })),
  get: (id: string) => call<BrandKit>(kit(id)),
  save: (k: BrandKit) => call<BrandKit>(kit(k.id), json("PUT", k)),
  remove: (id: string) => call<void>(kit(id), { method: "DELETE" }),
  duplicate: (id: string) => call<BrandKit>(`${kit(id)}/duplicate`, json("POST")),
  // A font, logo or guideline file; the kit sorts it by kind.
  upload: (id: string, file: File) =>
    call<{ file: string }>(`${kit(id)}/files`, { method: "POST", body: file, headers: { "x-file-name": encodeURIComponent(file.name) } }),
  import: (file: File) => call<BrandKit>("/api/studio/brands/import", { method: "POST", body: file }),
  exportUrl: (id: string) => `${kit(id)}/export`,
  history: async (id: string) => {
    const res = await fetch(`${kit(id)}/chat`, { headers: STUDIO_HEADERS }).catch(() => null);
    if (!res?.ok) return { messages: [] as ChatMessage[], running: false };
    return { messages: ((await res.json().catch(() => [])) ?? []) as ChatMessage[], running: res.headers.get("x-studio-running") === "1" };
  },
  chat: (id: string, body: { prompt: string; url?: string }, onEvent: (event: ChatEvent) => void, signal?: AbortSignal) =>
    streamEvents(`${kit(id)}/chat`, body, onEvent, signal),
  stop: (id: string) => call<void>(`${kit(id)}/chat`, { method: "DELETE" }),
  undo: (id: string) => call<BrandKit>(`${kit(id)}/undo`, json("POST")),
};

// A kit's own file (font, logo) as the browser loads it.
export const brandFile = (id: string, file: string, version?: string) =>
  `/studio/brand/${id}/${file.split("/").map(encodeURIComponent).join("/")}${version ? `?v=${encodeURIComponent(version)}` : ""}`;

export const FONT_FILE = /\.(ttf|otf|woff2?)$/i;
export const LOGO_FILE = /\.(svg|png|webp)$/i;
export const KIT_ACCEPTS = ".ttf,.otf,.woff,.woff2,.svg,.png,.webp,.jpg,.jpeg,.pdf,.txt,.md";
