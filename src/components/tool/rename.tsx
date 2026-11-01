"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

// A name changed in place: the words become a box with all of them
// selected. Enter or clicking away keeps the new name, Escape keeps the old.
export function RenameField({
  value,
  placeholder,
  className,
  onDone,
}: {
  value: string;
  placeholder?: string;
  className?: string;
  onDone: (name: string | null) => void; // null = nothing changed
}) {
  const [text, setText] = useState(value);
  const finish = (keep: boolean) => onDone(keep && text.trim() !== value.trim() ? text.trim() : null);
  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: opened on purpose by Rename
      autoFocus
      aria-label="Name"
      value={text}
      placeholder={placeholder}
      maxLength={80}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.preventDefault();
          onDone(null);
        }
      }}
      className={cn(
        "min-w-0 rounded-[6px] bg-white/[0.08] px-1.5 text-white outline-none ring-1 ring-white/20 placeholder:text-white/30 focus:ring-white/35",
        className,
      )}
    />
  );
}
