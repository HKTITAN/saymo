"use client";

import { ImageUpIcon } from "lucide-react";
import { type Ref, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
        "flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors",
        over && "border-ring bg-accent",
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
      <ImageUpIcon className="size-5 text-muted-foreground" aria-hidden="true" />
      <p className="font-medium text-sm">{busy ?? title}</p>
      <p className="max-w-64 text-muted-foreground text-xs">{hint}</p>
      <Button
        className="mt-1"
        size="sm"
        variant="outline"
        loading={Boolean(busy)}
        onClick={() => input.current?.click()}
      >
        Choose a file
      </Button>
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
