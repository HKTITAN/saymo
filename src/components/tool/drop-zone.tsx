"use client";

import { type Ref, useRef, useState } from "react";
import { PhotoImagePlusIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { DialButton } from "./dial";

export const ACCEPT = "image/png,image/jpeg,image/webp,image/heic,image/heif,image/avif";

// A place to drop a picture, or to choose one.
export function DropZone({
  title,
  hint,
  busy,
  onFile,
}: {
  title: string;
  hint: string;
  busy: string | null;
  onFile: (file: File) => void;
}) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-[10px] border border-white/15 border-dashed bg-white/[0.02] px-4 py-6 text-center transition-colors",
        over && "border-white/40 bg-white/[0.06]",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files[0];
        if (file && !busy) onFile(file);
      }}
    >
      <PhotoImagePlusIcon className="size-5 text-white/40" aria-hidden="true" />
      <p className="font-medium text-[12px] text-white/85">{busy ?? title}</p>
      <p className="max-w-64 text-[11.5px] text-white/45 leading-relaxed">{hint}</p>
      <DialButton className="mt-1 h-8 w-auto px-4" loading={Boolean(busy)} onClick={() => input.current?.click()}>
        Choose a file
      </DialButton>
      <FileInput ref={input} onFile={onFile} />
    </div>
  );
}

// The hidden file picker behind a "Choose" or "Replace" button.
export function FileInput({
  ref,
  onFile,
}: {
  ref: Ref<HTMLInputElement>;
  onFile: (file: File) => void;
}) {
  return (
    <input
      ref={ref}
      type="file"
      accept={ACCEPT}
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0];
        // Cleared, so choosing the same file again still counts.
        e.target.value = "";
        if (file) onFile(file);
      }}
    />
  );
}
