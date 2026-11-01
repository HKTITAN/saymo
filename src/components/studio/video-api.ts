import { STUDIO_HEADERS } from "@/lib/studio/contract";
import type { Edit, GraphicInfo, Media, Word } from "@/lib/studio/edit";
import { StudioError } from "./api";

// The studio's calls for video films: the edit, the footage in the bin and
// the graphics library (routes in edit.ts). Like api.ts, every request
// carries STUDIO_HEADERS.

const film = (id: string) => `/api/studio/films/${id}`;

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { ...STUDIO_HEADERS, ...init.headers } });
  } catch {
    throw new StudioError("Unable to reach the studio. Check that it's still running, then try again.");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) {
    let said = text.slice(0, 200);
    try {
      said = JSON.parse(text).error ?? said;
    } catch {}
    throw new StudioError(said || `The studio answered with error ${res.status}. Try again in a moment.`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

export const mediaUrl = (id: string, mediaId: string, file: string) =>
  `${film(id)}/media/${mediaId}/${encodeURIComponent(file)}`;

export const videoApi = {
  edit: (id: string) => call<Edit>(`${film(id)}/edit`),
  saveEdit: (id: string, edit: Edit) =>
    call<Edit>(`${film(id)}/edit`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(edit) }),
  media: (id: string) => call<Media[]>(`${film(id)}/media`),
  removeMedia: (id: string, mediaId: string) => call<void>(`${film(id)}/media/${mediaId}`, { method: "DELETE" }),
  transcribe: (id: string, mediaId: string) => call<Media>(`${film(id)}/media/${mediaId}/transcribe`, { method: "POST" }),
  transcript: (id: string, media: Media) => call<Word[]>(mediaUrl(id, media.id, media.transcript ?? "transcript.json")),
  peaks: (id: string, media: Media) => call<number[]>(mediaUrl(id, media.id, media.peaks ?? "peaks.json")),
  graphics: () => call<GraphicInfo[]>("/api/studio/graphics"),
};

// Sends one file as the request body, reporting how much has gone (0..1).
// XHR rather than fetch, because fetch can't tell how an upload is going.
export function upload(id: string, file: File, onProgress: (share: number) => void): Promise<Media> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${film(id)}/media`);
    for (const [k, v] of Object.entries(STUDIO_HEADERS)) xhr.setRequestHeader(k, v);
    xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as Media);
        } catch {
          reject(new StudioError(`Unable to add ${file.name}. Try again.`));
        }
        return;
      }
      let said = "";
      try {
        said = JSON.parse(xhr.responseText).error ?? "";
      } catch {
        said = xhr.responseText.slice(0, 200);
      }
      reject(new StudioError(said || `Unable to add ${file.name} (error ${xhr.status}). Try again.`));
    };
    xhr.onerror = () => reject(new StudioError(`Unable to add ${file.name}. Check that the studio is still running.`));
    xhr.send(file);
  });
}

// What the studio can bring in.
export const ACCEPTS = "video/*,audio/*,image/*,.mov,.mp4,.m4v,.webm,.mkv,.mp3,.wav,.m4a,.aac,.png,.jpg,.jpeg,.heic,.webp";
export const isMediaFile = (file: File) =>
  /^(video|audio|image)\//.test(file.type) || /\.(mov|mp4|m4v|webm|mkv|mp3|wav|m4a|aac|png|jpe?g|heic|webp)$/i.test(file.name);
