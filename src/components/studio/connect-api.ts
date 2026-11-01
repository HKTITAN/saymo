import type { ConnectionsStatus, FilmConnections, GithubRepo } from "@/lib/studio/connect-types";
import { STUDIO_HEADERS } from "@/lib/studio/contract";
import { StudioError } from "./api";

// The studio's calls for Google Drive and GitHub. Tokens never come here:
// the page only ever sees names, links and settings.

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...STUDIO_HEADERS, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
    });
  } catch {
    throw new StudioError("Unable to reach the studio. Check that it's still running, then try again.");
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new StudioError(body?.error ?? `The studio answered with error ${res.status}. Try again in a moment.`);
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const connectApi = {
  status: () => call<ConnectionsStatus>("/api/studio/connect"),
  // A page visit, not a fetch: Google's sign-in needs the whole window.
  googleStartUrl: () => `/api/studio/connect/google/start?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`,
  setGoogle: (change: { active?: string; autoDrafts?: boolean; folderName?: string }) => call<void>("/api/studio/connect/google", json("PATCH", change)),
  disconnectGoogle: (email: string) => call<void>("/api/studio/connect/google", json("DELETE", { email })),
  startGithub: () => call<{ result: "connected" | "code" }>("/api/studio/connect/github/start", { method: "POST" }),
  pollGithub: () => call<{ result: "connected" | "waiting" | "expired" }>("/api/studio/connect/github/poll", { method: "POST" }),
  cancelGithub: () => call<void>("/api/studio/connect/github/start", { method: "DELETE" }),
  chooseRepo: (owner: string, name: string) => call<GithubRepo>("/api/studio/connect/github/repo", json("PUT", { owner, name })),
  disconnectGithub: () => call<void>("/api/studio/connect/github", { method: "DELETE" }),
  film: (id: string) => call<FilmConnections>(`/api/studio/films/${id}/connect`),
  saveFilm: (id: string, to: "drive" | "github") => call<FilmConnections>(`/api/studio/films/${id}/connect`, json("POST", { to })),
};
