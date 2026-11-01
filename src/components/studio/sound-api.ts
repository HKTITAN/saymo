import { type Film, STUDIO_HEADERS } from "@/lib/studio/contract";
import type { FilmSound, SoundStatus } from "@/lib/studio/sound";
import { StudioError } from "./api";

// The studio's calls for a film's sound design (sound.ts): its status, a
// new render of the score, its files, and turning it on or off.

const base = (id: string) => `/api/studio/films/${id}/sound`;

async function json<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { ...STUDIO_HEADERS, ...init.headers } });
  } catch {
    throw new StudioError("Unable to reach the studio. Check that it's still running, then try again.");
  }
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

export const soundApi = {
  status: async (id: string): Promise<SoundStatus> => {
    // A film made before sound design existed has no sound routes' answer
    // yet; treat anything missing as "no score".
    try {
      return (await json<SoundStatus>(base(id))) ?? { state: "none" };
    } catch {
      return { state: "none" };
    }
  },
  render: (id: string) => json<SoundStatus>(base(id), { method: "POST" }),
  peaks: (id: string, version: string) => json<number[]>(`${base(id)}/peaks.json?v=${version}`),
  set: (id: string, sound: FilmSound) =>
    json<Film>(`/api/studio/films/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sound }),
    }),
};

export const soundUrl = (id: string, version: string) => `${base(id)}/sound.wav?v=${version}`;

// A film with a score but no settings yet plays at full volume.
export const soundOf = (film: Pick<Film, "sound"> | null): FilmSound => film?.sound ?? { on: true, volume: 1 };
