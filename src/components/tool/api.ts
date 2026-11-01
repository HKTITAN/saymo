import type { Crop, DocEdit, ExportStatus, PostDoc, PostSummary, Take } from "@/lib/tool/doc";

// The tool's calls to its own routes under /api/posts.

// An error that comes with the page that fixes it, like adding a card.
export type Problem = { message: string; action?: { label: string; url: string } };
export class ProblemError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.message);
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    // No answer at all: the tool's server is not running.
    throw new ProblemError({ message: "Unable to reach the tool. Check that it is still running, then try again." });
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ProblemError({
      message: body.error ?? `The tool answered with error ${res.status}. Try again in a moment.`,
      action: body.action,
    });
  }
  return body as T;
}

const send = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const upload = (file: File): RequestInit => {
  const form = new FormData();
  form.set("file", file);
  return { method: "POST", body: form };
};

type Saved = { updatedAt: string };
type PhotoResult = Saved & { photo: PostDoc["photo"]; note?: string };

export const api = {
  list: () => call<PostSummary[]>("/api/posts"),
  create: (from: string | null, mode: "copy" | "next") =>
    call<PostDoc>("/api/posts", send("POST", { from, mode })),
  get: (id: string) => call<PostDoc>(`/api/posts/${id}`),
  save: (id: string, edit: DocEdit, keepalive = false) =>
    call<Saved>(`/api/posts/${id}`, { ...send("PUT", edit), keepalive }),
  remove: (id: string) => call<unknown>(`/api/posts/${id}`, { method: "DELETE" }),
  uploadPhoto: (id: string, file: File) => call<PhotoResult>(`/api/posts/${id}/photo`, upload(file)),
  changePhoto: (id: string, change: { crop?: Crop; plain?: boolean }) =>
    call<PhotoResult>(`/api/posts/${id}/photo`, send("PATCH", change)),
  uploadImage: (id: string, file: File) =>
    call<Saved & { image: PostDoc["image"] }>(`/api/posts/${id}/image`, upload(file)),
  removeImage: (id: string) => call<Saved>(`/api/posts/${id}/image`, { method: "DELETE" }),
  generateImage: (id: string, place: string) =>
    call<Saved & { image: PostDoc["image"]; takes: Take[] }>(
      `/api/posts/${id}/image/generate`,
      send("POST", { place }),
    ),
  useTake: (id: string, file: string) =>
    call<Saved & { image: PostDoc["image"] }>(`/api/posts/${id}/image/take`, send("POST", { file })),
  exportStatus: (id: string) => call<ExportStatus>(`/api/posts/${id}/export`),
  startExport: (id: string) => call<ExportStatus>(`/api/posts/${id}/export`, { method: "POST" }),
};

export const downloadUrl = (id: string, name: string) => `/api/posts/${id}/export/${name}`;
