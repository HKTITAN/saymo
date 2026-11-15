import { STUDIO_HEADERS } from "@/lib/studio/films/contract";
import type { SlideImport, SlidesEvent, SlidesWay } from "@/lib/studio/input/slides-shared";
import { StudioError } from "./studio";

// The calls behind "Turn slides into a video": bringing files in as slides
// (each answer streams its steps), the slides' pictures, and making the
// film from the ones she kept.

const BASE = "/api/studio/slides";

// Reads a stream of `data: {json}` events until it ends.
async function readEvents(res: Response, onEvent: (event: SlidesEvent) => void) {
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    let said = text;
    try {
      said = JSON.parse(text).error ?? text;
    } catch {}
    throw new StudioError(said || `The studio answered with error ${res.status}. Try again.`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let end = buffer.indexOf("\n\n");
    while (end !== -1) {
      const data = buffer
        .slice(0, end)
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      buffer = buffer.slice(end + 2);
      if (data) {
        try {
          onEvent(JSON.parse(data) as SlidesEvent);
        } catch {}
      }
      end = buffer.indexOf("\n\n");
    }
  }
}

const reach = async (url: string, init: RequestInit) => {
  try {
    return await fetch(url, { ...init, headers: { ...STUDIO_HEADERS, ...init.headers } });
  } catch {
    throw new StudioError("Unable to reach the studio. Check that it's still running, then try again.");
  }
};

// Turns one file into slides, added to `importId` (or a new import).
export async function addSlides(file: File, importId: string | null, onStep: (label: string) => void): Promise<SlideImport> {
  const res = await reach(BASE, {
    method: "POST",
    headers: {
      "x-file-name": encodeURIComponent(file.name),
      "Content-Type": file.type || "application/octet-stream",
      ...(importId ? { "x-import": importId } : {}),
    },
    body: file,
  });
  let result = null as SlideImport | null;
  let problem = null as string | null;
  await readEvents(res, (e) => {
    if (e.kind === "step") onStep(e.label);
    else if (e.kind === "done") result = e.import;
    else if (e.kind === "error") problem = e.message;
  });
  if (problem) throw new StudioError(problem);
  if (!result) throw new StudioError(`${file.name} stopped part way. Try again.`);
  return result;
}

export const slideImage = (importId: string, file: string) => `${BASE}/${importId}/${file}`;

export function dropSlides(importId: string) {
  void reach(`${BASE}/${importId}`, { method: "DELETE" }).catch(() => undefined);
}

export type SlidesFilmRequest = {
  keys: string[];
  way: SlidesWay;
  width: number;
  height: number;
  seconds: number | "voice";
  voice: string | null;
  music: boolean;
  brand: string;
  folder: string | null;
  title: string;
};

export async function makeSlidesFilm(importId: string, request: SlidesFilmRequest, onStep: (label: string) => void) {
  const res = await reach(`${BASE}/${importId}/film`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  let made = null as { id: string; prompt: string } | null;
  let problem = null as string | null;
  await readEvents(res, (e) => {
    if (e.kind === "step") onStep(e.label);
    else if (e.kind === "made") made = { id: e.id, prompt: e.prompt };
    else if (e.kind === "error") problem = e.message;
  });
  if (problem) throw new StudioError(problem);
  if (!made) throw new StudioError("The film stopped part way. Try again.");
  return made;
}

export type VoiceChoice = { id: string; label: string; accent: string; installed: boolean };

export async function listVoices(): Promise<{ voices: VoiceChoice[]; defaultVoice: string }> {
  const res = await reach("/api/studio/voices", {});
  if (!res.ok) return { voices: [], defaultVoice: "Rishi" };
  return (await res.json()) as { voices: VoiceChoice[]; defaultVoice: string };
}
