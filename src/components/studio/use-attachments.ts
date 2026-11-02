"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type Attachment, type AttachmentKind, STUDIO_HEADERS } from "@/lib/studio/contract";

// Files attached to a prompt: picked, dropped or pasted, uploaded at once to
// the film's refs/ (or the kit's guide/), and sent with the message once
// they're all in. Where there's nowhere to upload yet (a film that's about
// to be made), they wait until `flush` is given an address.

export const MAX_FILES = 10;
export const MAX_BYTES = 25 * 1024 * 1024;

const KINDS: Record<string, AttachmentKind> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  heic: "image",
  heif: "image",
  pdf: "pdf",
  txt: "text",
  md: "text",
  csv: "text",
  json: "text",
  docx: "doc",
};
// A film's prompts also take sounds, as references Claude listens to, and
// slide decks, which become slides Claude can build from.
const AUDIO_EXTS = ["mp3", "wav", "m4a", "aif", "aiff", "aac", "ogg", "flac"];
const DECK_EXTS = ["pptx", "ppt", "key", "odp"];
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const MAX_DECK_BYTES = 200 * 1024 * 1024;
const kindsFor = (audio: boolean): Record<string, AttachmentKind> =>
  audio
    ? {
        ...KINDS,
        ...Object.fromEntries(AUDIO_EXTS.map((e) => [e, "audio" as const])),
        ...Object.fromEntries(DECK_EXTS.map((e) => [e, "slides" as const])),
      }
    : KINDS;
export const acceptFor = (audio: boolean) =>
  Object.keys(kindsFor(audio))
    .map((e) => `.${e}`)
    .join(",");
export const KIND_LABEL: Record<AttachmentKind, string> = { image: "Image", pdf: "PDF", text: "Text", doc: "Doc", audio: "Sound", slides: "Slides" };

const extOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
export const isAudioFile = (file: File) => AUDIO_EXTS.includes(extOf(file.name)) || (file.type.startsWith("audio/") && extOf(file.name) !== "");

// A length as m:ss, for sound chips.
export const clockText = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// A sound's length, read by the browser (null if it can't play the format;
// the server measures it again either way).
function lengthOf(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (v: number | null) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
    audio.onerror = () => done(null);
    audio.src = url;
  });
}

export type PendingFile = {
  key: string;
  name: string;
  kind: AttachmentKind;
  preview: string | null; // object URL for images the browser can show
  seconds: number | null; // sounds: their length, once known
  progress: number; // 0..1
  sending: boolean;
  done: Attachment | null;
  error: string | null;
  file: File;
};

export type Attachments = ReturnType<typeof useAttachments>;

let counter = 0;

// One upload with progress (fetch can't report it).
function send(url: string, file: File, onProgress: (share: number) => void): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    for (const [k, v] of Object.entries(STUDIO_HEADERS)) xhr.setRequestHeader(k, v);
    xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: { error?: string } & Partial<Attachment> = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && body.path) resolve(body as Attachment);
      else reject(new Error(body.error ?? `Unable to attach ${file.name}. Try again.`));
    };
    xhr.onerror = () => reject(new Error(`Unable to attach ${file.name}. Check that the studio is running.`));
    xhr.send(file);
  });
}

// Uploads files straight away, one after another, keeping the ones that
// made it (for a film that didn't exist when they were picked).
export async function attachFiles(url: string, files: File[]): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const file of files.slice(0, MAX_FILES)) {
    try {
      out.push(await send(url, file, () => {}));
    } catch {}
  }
  return out;
}

// Files handed to a prompt box that isn't on screen yet: a library item
// dropped on a film card waits here for that film's chat, and one dropped
// on "Make motion graphics" for the new film card. Taken by the first box
// with that address to appear.
const waiting = new Map<string, File[]>();
const NEW = "new";
export function handOff(url: string | null, files: File[]) {
  if (!files.length) return;
  const key = url ?? NEW;
  waiting.set(key, [...(waiting.get(key) ?? []), ...files]);
}

// `audio`: sounds can come along too (a film's prompts, not a kit's).
export function useAttachments(url: string | null, { audio = false }: { audio?: boolean } = {}) {
  const [items, setItems] = useState<PendingFile[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  });
  const uploads = useRef(new Map<string, Promise<void>>());

  const patch = useCallback((key: string, change: Partial<PendingFile>) => {
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...change } : i)));
  }, []);

  const upload = useCallback(
    (item: PendingFile, to: string) => {
      patch(item.key, { sending: true });
      const job = send(to, item.file, (p) => patch(item.key, { progress: p }))
        .then((done) => patch(item.key, { done, progress: 1, error: null, sending: false }))
        .catch((e: Error) => patch(item.key, { error: e.message, sending: false }))
        .finally(() => uploads.current.delete(item.key));
      uploads.current.set(item.key, job);
      return job;
    },
    [patch],
  );

  const add = useCallback(
    (files: File[]) => {
      if (!files.length) return;
      setNotice(null);
      const room = MAX_FILES - itemsRef.current.length;
      if (room <= 0) {
        setNotice(`Attach up to ${MAX_FILES} files to one message.`);
        return;
      }
      if (files.length > room) setNotice(`Attach up to ${MAX_FILES} files to one message. The rest were left out.`);
      const fresh: PendingFile[] = [];
      const kinds = kindsFor(audio);
      for (const file of files.slice(0, room)) {
        const kind = kinds[extOf(file.name)] ?? (file.type.startsWith("image/") ? "image" : null);
        if (!kind) {
          setNotice(
            `Claude can't open ${file.name}. Attach ${audio ? "a sound, slides, an image, a PDF, a Word file or plain text" : "an image, a PDF, a Word file or plain text"}.`,
          );
          continue;
        }
        const limit = kind === "audio" ? MAX_AUDIO_BYTES : kind === "slides" ? MAX_DECK_BYTES : MAX_BYTES;
        if (file.size > limit) {
          setNotice(`${file.name} is over ${limit / 1024 / 1024} MB. Attach a smaller file${kind === "audio" ? " or a shorter clip" : ""}.`);
          continue;
        }
        // A pasted screenshot arrives as "image.png"; give it a clearer name.
        const named = file.name === "image.png" ? new File([file], `Pasted image ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }).replace(":", ".")}.png`, { type: file.type }) : file;
        const showable = kind === "image" && !/^hei[cf]$/.test(extOf(named.name));
        fresh.push({
          key: `a${++counter}`,
          name: named.name,
          kind,
          preview: showable ? URL.createObjectURL(named) : null,
          seconds: null,
          progress: 0,
          sending: false,
          done: null,
          error: null,
          file: named,
        });
      }
      if (!fresh.length) return;
      setItems((list) => [...list, ...fresh]);
      for (const item of fresh) {
        if (item.kind === "audio") void lengthOf(item.file).then((s) => s && patch(item.key, { seconds: s }));
      }
      if (url) for (const item of fresh) void upload(item, url);
    },
    [url, upload, audio, patch],
  );

  const remove = useCallback((key: string) => {
    setItems((list) => {
      const gone = list.find((i) => i.key === key);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return list.filter((i) => i.key !== key);
    });
    setNotice(null);
  }, []);

  const clear = useCallback(() => {
    for (const i of itemsRef.current) if (i.preview) URL.revokeObjectURL(i.preview);
    setItems([]);
    setNotice(null);
  }, []);

  // Uploads anything not yet sent (to `to`, or this hook's own address) and
  // resolves with every attachment that made it.
  const flush = useCallback(
    async (to?: string) => {
      const target = to ?? url;
      if (target) {
        for (const item of itemsRef.current) {
          if (!item.done && !item.error && !uploads.current.has(item.key)) void upload(item, target);
        }
      }
      await Promise.all([...uploads.current.values()]);
      // Read the settled list after the last state update has landed.
      await new Promise((r) => setTimeout(r, 0));
      return itemsRef.current.map((i) => i.done).filter((d): d is Attachment => d !== null);
    },
    [url, upload],
  );

  useEffect(
    () => () => {
      for (const i of itemsRef.current) if (i.preview) URL.revokeObjectURL(i.preview);
    },
    [],
  );

  // Anything handed to this box before it appeared.
  useEffect(() => {
    const key = url ?? NEW;
    const files = waiting.get(key);
    if (!files) return;
    waiting.delete(key);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- takes files handed over from outside React, once
    add(files);
  }, [url, add]);

  const uploading = items.some((i) => i.sending);
  const ready = items.map((i) => i.done).filter((d): d is Attachment => d !== null);
  return { items, add, remove, clear, flush, notice, uploading, ready, hasFiles: items.some((i) => !i.error), audio };
}
