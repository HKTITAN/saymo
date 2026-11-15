import type { ChatEvent } from "@/lib/studio/films/contract";
import type { Media } from "@/lib/studio/films/edit";
import { reelPrompt, SCRIPT_FILE, type Script, type ScriptEvent, type ScriptRequest } from "@/lib/studio/input/script";
import { api, StudioError, streamEvents } from "./studio";
import { appendMedia } from "../video/edit-ops";
import { upload, videoApi } from "./video";

// The calls behind "Write a script" and "Record a reel": writing the script
// with Claude, keeping the storyboard while you work, and turning a take
// (or footage you already have) into a new 9:16 video film that opens with
// its first prompt to Claude.

export function writeScript(request: ScriptRequest, onEvent: (event: ScriptEvent) => void, signal: AbortSignal) {
  return streamEvents("/api/studio/script", request, onEvent as unknown as (event: ChatEvent) => void, signal);
}

// The storyboard you're working on, kept in this browser so closing the
// card doesn't lose it. Reading or writing it may fail (a private window);
// the studio works without it.
const DRAFT_KEY = "studio:script-draft";

export function readDraft(): Script | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Script;
    return Array.isArray(s?.beats) && s.beats.length ? s : null;
  } catch {
    return null;
  }
}

export function keepDraft(script: Script | null) {
  try {
    if (script) window.localStorage.setItem(DRAFT_KEY, JSON.stringify(script));
    else window.localStorage.removeItem(DRAFT_KEY);
  } catch {}
}

export type Progress = { label: string; share: number | null };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Makes the reel's film: brings the files in, waits for them to be ready
// and transcribed (the reel is timed to what's said), lays them on the
// timeline, and returns what the film's first message sends.
export async function makeReel({
  files,
  script,
  folder,
  onProgress,
  cancelled,
}: {
  files: File[];
  script: Script | null;
  folder: string | null;
  onProgress: (p: Progress) => void;
  cancelled: () => boolean;
}): Promise<{ id: string; prompt: string; attach: File[] }> {
  onProgress({ label: "Making the film", share: null });
  const film = await api.create({ title: script?.title || "Reel", kind: "video", width: 1080, height: 1920 });
  if (folder) await api.edit(film.id, { folder }).catch(() => undefined);

  // 1. Bring every file in, showing how much has gone.
  const sizes = files.map((f) => f.size || 1);
  const total = sizes.reduce((a, b) => a + b, 0);
  const sent = files.map(() => 0);
  const show = () => onProgress({ label: files.length > 1 ? "Bringing in your videos" : "Bringing in your take", share: sent.reduce((a, b) => a + b, 0) / total });
  const made: Media[] = await Promise.all(
    files.map((file, n) =>
      upload(film.id, file, (p) => {
        sent[n] = p * sizes[n];
        show();
      }),
    ),
  );
  const ids = made.map((m) => m.id);

  // 2. Wait until they're ready, then listen to what's said.
  let media: Media[] = [];
  const mine = () => media.filter((m) => ids.includes(m.id));
  for (;;) {
    if (cancelled()) throw new StudioError("Stopped.");
    media = await videoApi.media(film.id);
    const busy = mine().find((m) => m.status === "importing");
    if (!busy) break;
    onProgress({ label: busy.step ?? "Getting it ready", share: null });
    await wait(1000);
  }
  const failed = mine().find((m) => m.status === "failed");
  if (failed) throw new StudioError(failed.error ?? `Unable to bring in ${failed.name}. Try again.`);

  const speech = mine().filter((m) => m.kind !== "image" && m.hasAudio && !m.transcript);
  await Promise.all(speech.map((m) => videoApi.transcribe(film.id, m.id).catch(() => undefined)));
  const until = Date.now() + 6 * 60 * 1000; // after that, Claude starts without the words
  while (speech.length && Date.now() < until) {
    if (cancelled()) throw new StudioError("Stopped.");
    media = await videoApi.media(film.id);
    const listening = mine().find((m) => m.transcribing);
    if (!listening) break;
    onProgress({ label: listening.step && listening.step !== "Waiting to listen" ? listening.step : "Listening to what you said", share: null });
    await wait(1000);
  }

  // 3. On the timeline end to end, so the film shows the take straight away.
  onProgress({ label: "Opening the film", share: null });
  const edit = await videoApi.edit(film.id);
  const ready = ids.map((mid) => media.find((m) => m.id === mid)).filter((m): m is Media => !!m && m.status === "ready");
  if (ready.length) await videoApi.saveEdit(film.id, appendMedia(edit, ready));

  const attach = script ? [new File([JSON.stringify(script, null, 2)], SCRIPT_FILE, { type: "application/json" })] : [];
  return { id: film.id, prompt: reelPrompt(script, files.length), attach };
}

// The best recording the browser offers: MP4 where it can (Safari, newer
// Chrome), else WebM.
const TYPES = [
  "video/mp4;codecs=avc1.640028,mp4a.40.2",
  "video/mp4;codecs=avc1,mp4a",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];
export const recordingType = () =>
  typeof MediaRecorder === "undefined" ? "" : (TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? "");
