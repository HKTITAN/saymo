"use client";

import { useState } from "react";
import { BookmarkIcon, CheckTickCircleIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { StudioError } from "../api/studio";
import { libraryApi, saveUrl } from "../api/library";
import { Hint } from "../ui/panel";

// A small "Save to library" button for things already in a film: a file
// attached to a prompt, a piece of footage. It shows a tick once saved and
// says what went wrong if it couldn't be.
export function SaveToLibrary({ save, label = "Save to library", className }: { save: () => Promise<unknown>; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <Hint label={problem ?? (state === "saved" ? "Saved to library" : state === "saving" ? "Saving to library" : label)}>
      <button
        type="button"
        aria-label={state === "saved" ? "Saved to library" : label}
        disabled={state !== "idle"}
        onClick={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          setProblem(null);
          setState("saving");
          try {
            await save();
            setState("saved");
          } catch (err) {
            setProblem(err instanceof StudioError ? err.message : "Unable to save it to the library. Try again.");
            setState("idle");
          }
        }}
        className={cn(
          "inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-white/50 outline-none transition-colors hover:bg-white/[0.1] hover:text-white focus-visible:ring-1 focus-visible:ring-white/40 disabled:cursor-default [&_svg]:size-3",
          state === "saving" && "animate-pulse",
          problem && "text-danger",
          className,
        )}
      >
        {state === "saved" ? <CheckTickCircleIcon aria-hidden="true" /> : <BookmarkIcon aria-hidden="true" />}
      </button>
    </Hint>
  );
}

// Saves a file the page can load: a film's attachment is copied on the
// server (so the library remembers which film it came from); anything else
// is fetched and added.
export function saveAttachment(url: string, name: string, path: string) {
  // The file as kept may differ from the name it was attached as (a Word
  // file is kept as text, a phone photo as JPEG): keep the kept kind.
  const kept = path.split(".").pop() ?? "";
  const base = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  const named = kept ? `${base}.${kept}` : name;
  const film = url.match(/^\/studio\/stage\/([a-z0-9]{8})\/(refs\/[A-Za-z0-9._-]+)$/);
  if (film) return libraryApi.fromFilm({ film: film[1], path: film[2], name: named });
  return saveUrl(url, named);
}
