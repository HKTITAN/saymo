"use client";

import { STUDIO_HEADERS } from "@/lib/studio/contract";
import type { LibraryList, RefEntry, RefFolder } from "@/lib/studio/references-shared";
import { StudioError } from "./api";

// The studio page's calls to the reference library (references-shared.ts
// lists the routes), and the one place that turns a library item into
// files a prompt can attach.

const BASE = "/api/studio/library";

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
    const said = body && typeof body === "object" && "error" in body ? String(body.error) : "";
    throw new StudioError(said || `The studio answered with error ${res.status}. Try again in a moment.`);
  }
  return body as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

// The last list fetched, so the picker opens with something to show while
// it checks for anything newer.
let cached: LibraryList | null = null;
const listeners = new Set<() => void>();
export const cachedLibrary = () => cached;
export const onLibraryChange = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};
const changed = () => {
  for (const cb of listeners) cb();
};

export const libraryApi = {
  list: async () => {
    cached = await call<LibraryList>(BASE);
    return cached;
  },
  upload: async (file: File, folder: string | null) => {
    const made = await call<RefEntry>(BASE, {
      method: "POST",
      headers: {
        "x-file-name": encodeURIComponent(file.name),
        "Content-Type": file.type || "application/octet-stream",
        ...(folder ? { "x-library-folder": folder } : {}),
      },
      body: file,
    });
    changed();
    return made;
  },
  link: async (link: string, folder: string | null) => {
    const made = await call<RefEntry>(BASE, json("POST", { link, folder }));
    changed();
    return made;
  },
  note: async (text: string, folder: string | null) => {
    const made = await call<RefEntry>(BASE, json("POST", { text, folder }));
    changed();
    return made;
  },
  // A file attached to one of a film's prompts (path in refs/), or a piece of its footage.
  fromFilm: async (body: { film: string; path?: string; media?: string; name?: string }) => {
    const made = await call<RefEntry>(BASE, json("POST", body));
    changed();
    return made;
  },
  update: (id: string, change: { name?: string; note?: string; tags?: string[]; folder?: string | null }) =>
    call<RefEntry>(`${BASE}/${id}`, json("PATCH", change)),
  remove: (id: string) => call<void>(`${BASE}/${id}`, { method: "DELETE" }),
  restore: (id: string) => call<RefEntry>(`${BASE}/${id}/restore`, json("POST")),
  folders: () => call<RefFolder[]>(`${BASE}/folders`),
  newFolder: (name: string) => call<RefFolder>(`${BASE}/folders`, json("POST", { name })),
  renameFolder: (id: string, name: string) => call<RefFolder>(`${BASE}/folders/${id}`, json("PATCH", { name })),
  removeFolder: (id: string) => call<void>(`${BASE}/folders/${id}`, { method: "DELETE" }),
};

// The files an item becomes in a prompt: a picture, a PDF or a sound as it
// is, a clip as four stills, a note or link as a short text file. Fetched
// here and handed to the prompt's attachments like files from Finder, so
// they reach the film's refs/ the same way.
export async function filesFor(entry: RefEntry): Promise<File[]> {
  const out: File[] = [];
  for (const part of entry.attach) {
    let res: Response;
    try {
      res = await fetch(part.url, { headers: STUDIO_HEADERS });
    } catch {
      throw new StudioError("Unable to reach the studio. Check that it's still running, then try again.");
    }
    if (!res.ok) throw new StudioError(`Unable to fetch ${entry.name} from the library. Try again.`);
    const blob = await res.blob();
    out.push(new File([blob], part.name, { type: blob.type }));
  }
  return out;
}

// Saves a file the page can already load (an attachment shown in the chat,
// a kit's guideline) into the library, by fetching it and adding it.
export async function saveUrl(url: string, name: string) {
  const res = await fetch(url, { headers: STUDIO_HEADERS }).catch(() => null);
  if (!res?.ok) throw new StudioError(`Unable to read ${name}. Try again.`);
  const blob = await res.blob();
  return libraryApi.upload(new File([blob], name, { type: blob.type }), null);
}

// Opens the library on the studio's home page.
export function openLibrary() {
  window.history.pushState(null, "", "/studio?library");
  window.dispatchEvent(new Event("studio:navigate"));
}
