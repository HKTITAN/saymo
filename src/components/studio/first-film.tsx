"use client";

import { useRef, useState } from "react";
import { UploadUpIcon } from "@/components/icons";
import { SIZES } from "@/lib/studio/contract";
import { cn } from "@/lib/utils";
import { CARD, PILL_BUTTON } from "./panel";
import { PromptBox } from "./prompt-box";
import { useAttachments } from "./use-attachments";
import { ACCEPTS, isMediaFile } from "./video-api";

// What the studio shows before there are any films: two ways to start.
// Edit a video: drop footage and it's laid on the timeline end to end.
// Make motion graphics: describe a film and Claude makes it.

type Kind = "video" | "motion";

export function FirstFilm({
  busy,
  error,
  onStart,
  onStartVideo,
  initialKind = "video",
  title = "Make your first film",
}: {
  initialKind?: Kind;
  title?: string;
  busy: boolean;
  error: string | null;
  onStart: (prompt: string | null, width: number, height: number, files?: File[]) => void;
  onStartVideo: (files: File[], width: number, height: number) => void;
}) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const [draft, setDraft] = useState("");
  // Files picked before the film exists; they go in once it does.
  const attached = useAttachments(null);
  const [size, setSize] = useState<(typeof SIZES)[number]>(SIZES[0]);
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const take = (list: FileList | null) => {
    const files = [...(list ?? [])].filter(isMediaFile);
    if (files.length) onStartVideo(files, size.width, size.height);
  };

  return (
    <div data-backdrop="" className="absolute inset-0 flex items-center justify-center p-6">
      <section aria-labelledby="first-film" className={cn(CARD, "flex w-full max-w-[540px] flex-col gap-4 p-5")}>
        <div className="flex flex-col gap-1.5">
          <h1 id="first-film" className="font-medium text-[15px] text-white/95">
            {title}
          </h1>
          <p className="text-[12.5px] text-white/55 leading-relaxed">
            Cut your own footage, or have Claude make motion graphics. Either way, change anything afterwards by asking
            Claude or pointing at the film.
          </p>
        </div>

        <div className="flex gap-1 rounded-[12px] bg-white/[0.04] p-1" role="tablist" aria-label="How to start">
          {(
            [
              ["video", "Edit a video", "Footage, photos and music"],
              ["motion", "Make motion graphics", "Described in words"],
            ] as const
          ).map(([k, label, note]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => setKind(k)}
              className={cn(
                "flex flex-1 cursor-pointer flex-col items-start gap-0.5 rounded-[9px] px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                kind === k ? "bg-white/[0.11]" : "hover:bg-white/[0.05]",
              )}
            >
              <span className={cn("font-medium text-[12.5px]", kind === k ? "text-white" : "text-white/65")}>{label}</span>
              <span className="text-[11.5px] text-white/40">{note}</span>
            </button>
          ))}
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

        {kind === "video" ? (
          <>
            <input
              ref={picker}
              type="file"
              multiple
              accept={ACCEPTS}
              className="hidden"
              tabIndex={-1}
              onChange={(e) => {
                take(e.target.files);
                e.target.value = "";
              }}
            />
            {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target; the button inside it is the keyboard way in */}
            <div
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes("Files")) return;
                e.preventDefault();
                e.stopPropagation();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOver(false);
                take(e.dataTransfer.files);
              }}
              className={cn(
                "flex h-40 flex-col items-center justify-center gap-2.5 rounded-[12px] border border-dashed text-center transition-colors",
                over ? "border-white/50 bg-white/[0.07]" : "border-white/15 bg-white/[0.02]",
              )}
            >
              <p className="text-[12.5px] text-white/70">Drop footage, photos or music here</p>
              <p className="text-[11.5px] text-white/40">They go on the timeline end to end, in the order you drop them.</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => picker.current?.click()}
                className={cn(PILL_BUTTON, "mt-1 bg-white text-[#141414] hover:bg-white/90")}
              >
                <UploadUpIcon aria-hidden="true" />
                Choose files
              </button>
            </div>
          </>
        ) : (
          <>
            <PromptBox
              value={draft}
              onChange={setDraft}
              onSend={() => {
                const picked = attached.items.filter((a) => !a.error).map((a) => a.file);
                onStart(draft.trim() || (picked.length ? "Have a look at what I attached." : draft), size.width, size.height, picked);
              }}
              attachments={attached}
              running={busy}
              autoFocus
              maxRows={5}
              placeholder="A 6 second loop: orange lines rise like a staircase, then the Aerchain wordmark appears"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => onStart(null, size.width, size.height)}
              className="self-start rounded-[6px] text-[12px] text-white/45 underline decoration-white/20 underline-offset-4 outline-none transition-colors hover:text-white/75 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              Start from a blank film
            </button>
          </>
        )}
        {error ? <p className="text-[12px] text-[#ff9592] leading-relaxed">{error}</p> : null}
      </section>
    </div>
  );
}
