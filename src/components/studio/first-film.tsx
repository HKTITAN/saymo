"use client";

import { useState } from "react";
import { SIZES } from "@/lib/studio/contract";
import { cn } from "@/lib/utils";
import { CARD } from "./panel";
import { PromptBox } from "./prompt-box";

// What the studio shows before there are any films: describe one and
// Claude makes it, or start from a blank film.

export function FirstFilm({
  busy,
  error,
  onStart,
}: {
  busy: boolean;
  error: string | null;
  onStart: (prompt: string | null, width: number, height: number) => void;
}) {
  const [draft, setDraft] = useState("");
  const [size, setSize] = useState<(typeof SIZES)[number]>(SIZES[0]);

  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <section aria-labelledby="first-film" className={cn(CARD, "flex w-full max-w-[520px] flex-col gap-4 p-5")}>
        <div className="flex flex-col gap-1.5">
          <h1 id="first-film" className="font-medium text-[15px] text-white/95">
            Make your first film
          </h1>
          <p className="text-[12.5px] text-white/55 leading-relaxed">
            Describe it and Claude makes it. Afterwards, change anything by asking, or point at a part of the film to
            change just that.
          </p>
        </div>
        <div className="flex gap-1" role="radiogroup" aria-label="Size">
          {SIZES.map((s) => (
            <button
              key={s.label}
              type="button"
              role="radio"
              aria-checked={size.label === s.label}
              onClick={() => setSize(s)}
              className={cn(
                "flex h-14 flex-1 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[10px] text-[11.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                size.label === s.label ? "bg-white/[0.12] text-white" : "bg-white/[0.04] text-white/50 hover:bg-white/[0.07] hover:text-white/80",
              )}
            >
              <span
                aria-hidden="true"
                className="rounded-[2px] shadow-[inset_0_0_0_1.5px_currentColor]"
                style={{
                  width: (s.width / Math.max(s.width, s.height)) * 20,
                  height: (s.height / Math.max(s.width, s.height)) * 20,
                }}
              />
              {s.label}
            </button>
          ))}
        </div>
        <PromptBox
          value={draft}
          onChange={setDraft}
          onSend={() => onStart(draft, size.width, size.height)}
          running={busy}
          autoFocus
          maxRows={5}
          placeholder="A 6 second loop: orange lines rise like a staircase, then the Aerchain wordmark appears"
        />
        {error ? <p className="text-[12px] text-[#ff9592] leading-relaxed">{error}</p> : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => onStart(null, size.width, size.height)}
          className="self-start rounded-[6px] text-[12px] text-white/45 underline decoration-white/20 underline-offset-4 outline-none transition-colors hover:text-white/75 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          Start from a blank film
        </button>
      </section>
    </div>
  );
}
