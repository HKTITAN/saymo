import { useSyncExternalStore } from "react";
import { type AiChoice, type AiStatus, DEFAULT_CHOICE, DEFAULT_PROVIDER, isProviderId, type ProviderId } from "@/lib/studio/ai-types";
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

// The model and effort chosen in Settings, shared by every picker on the
// page: fetched once, and updated everywhere when Settings changes it.
let choice: AiChoice | null = null;
let asked = false;
const listeners = new Set<() => void>();
const setChoice = (c: AiChoice) => {
  choice = { model: c.model, effort: c.effort };
  for (const l of listeners) l();
};
async function choiceCall(init?: RequestInit): Promise<AiChoice> {
  const res = await fetch("/api/studio/ai/model", {
    ...init,
    cache: "no-store",
    headers: { ...STUDIO_HEADERS, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
  }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as (AiChoice & { error?: string }) | null;
  if (!res?.ok || !body) throw new StudioError(body?.error ?? "Unable to reach the studio. Check that it's still running, then try again.");
  setChoice(body);
  return body;
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (!asked) {
    asked = true;
    void choiceCall().catch(() => {
      asked = false;
    });
  }
  return () => {
    listeners.delete(listener);
  };
};
export const useAiChoice = (): AiChoice =>
  useSyncExternalStore(
    subscribe,
    () => choice ?? DEFAULT_CHOICE,
    () => DEFAULT_CHOICE,
  );

export const aiApi = {
  saveChoice: (c: AiChoice) => choiceCall({ method: "PUT", body: JSON.stringify(c) }),
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
