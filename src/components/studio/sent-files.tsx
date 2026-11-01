"use client";

import type { Attachment } from "@/lib/studio/contract";
import { KIND_LABEL } from "./use-attachments";

// The files a sent message carried, under it in the chat: a small picture
// for images, the kind and name for the rest. Each opens in a new tab.
export function SentFiles({ files, urlOf }: { files: Attachment[]; urlOf: (path: string) => string }) {
  if (!files.length) return null;
  return (
    <ul className="flex max-w-full flex-wrap justify-end gap-1">
      {files.map((f) => (
        <li key={f.path}>
          <a
            href={urlOf(f.path)}
            target="_blank"
            rel="noreferrer noopener"
            title={f.name}
            className="flex h-7 max-w-52 items-center gap-1.5 rounded-[8px] bg-white/[0.06] ps-1 pe-2 text-[11.5px] text-white/65 outline-none transition-colors hover:bg-white/[0.1] hover:text-white focus-visible:ring-2 focus-visible:ring-ring"
          >
            {f.kind === "image" ? (
              // biome-ignore lint/performance/noImgElement: the film's own attached file
              // eslint-disable-next-line @next/next/no-img-element
              <img src={urlOf(f.path)} alt="" className="size-5 shrink-0 rounded-[4px] object-cover" />
            ) : (
              <span className="flex h-5 shrink-0 items-center rounded-[4px] bg-white/[0.08] px-1 font-medium text-[10px] text-white/60 uppercase tracking-[0.04em]">
                {KIND_LABEL[f.kind]}
              </span>
            )}
            <span className="truncate">{f.name}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
