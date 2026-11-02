import { type AiStatus, DEFAULT_PROVIDER, isProviderId, type ProviderId } from "@/lib/studio/ai-types";
import { STUDIO_HEADERS } from "@/lib/studio/contract";
import { StudioError } from "./api";

// The studio's calls about its AIs. The API key goes to the server once, as
// it's saved, and never comes back.

async function call(url: string, init: RequestInit = {}): Promise<AiStatus> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      cache: "no-store",
      headers: { ...STUDIO_HEADERS, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
    });
  } catch {
    throw new StudioError("Unable to reach the studio. Check that it's still running, then try again.");
  }
  const body = (await res.json().catch(() => null)) as (AiStatus & { error?: string }) | null;
  if (!res.ok || !body) throw new StudioError(body?.error ?? `The studio answered with error ${res.status}. Try again in a moment.`);
  return body;
}

export const aiApi = {
  status: (fresh = false) => call(`/api/studio/ai${fresh ? "?fresh=1" : ""}`),
  saveKey: (key: string) => call("/api/studio/ai/key", { method: "POST", body: JSON.stringify({ key }) }),
  removeKey: () => call("/api/studio/ai/key", { method: "DELETE" }),
};

// The AI last picked for a film, kept in this browser.
const pickKey = (filmId: string) => `studio:ai:${filmId}`;

export function loadPick(filmId: string): ProviderId {
  try {
    const saved = window.localStorage.getItem(pickKey(filmId));
    return isProviderId(saved) ? saved : DEFAULT_PROVIDER;
  } catch {
    return DEFAULT_PROVIDER;
  }
}

export function savePick(filmId: string, provider: ProviderId) {
  try {
    if (provider === DEFAULT_PROVIDER) window.localStorage.removeItem(pickKey(filmId));
    else window.localStorage.setItem(pickKey(filmId), provider);
  } catch {}
}
