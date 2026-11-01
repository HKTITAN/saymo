"use client";

import { ExternalLinkIcon, SparklesIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { PALETTE } from "@/components/post/palette";
import type { Placement, PostDoc, Take } from "@/lib/tool/doc";
import { cn } from "@/lib/utils";
import type { Problem } from "./api";
import { DialButton, DialNote, DialSlider, DialText } from "./dial";
import { DropZone, FileInput } from "./drop-zone";

// The landmark on the right: make one with AI, upload one, name it and
// place it.
export function ImageField({
  image,
  takes,
  busy,
  onUpload,
  onGenerate,
  onUseTake,
  onRemove,
  onName,
  onPlace,
}: {
  image: PostDoc["image"];
  takes: Take[];
  busy: string | null;
  onUpload: (file: File) => void;
  onGenerate: (place: string) => Promise<Problem | null>;
  onUseTake: (file: string) => void;
  onRemove: () => void;
  onName: (name: string) => void;
  onPlace: (place: Placement) => void;
}) {
  const replace = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-1.5">
      {image ? (
        <div className="flex gap-3 rounded-[10px] bg-white/[0.05] p-1.5">
          <Swatch src={image.x1} className="size-20 rounded-[7px] p-1.5" />
          <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 py-0.5 pe-1">
            <p className="text-[11.5px] text-white/50 leading-relaxed">{busy ?? image.note}</p>
            <div className="grid grid-cols-2 gap-1.5">
              <DialButton className="h-7" disabled={Boolean(busy)} onClick={() => replace.current?.click()}>
                Upload instead
              </DialButton>
              <DialButton className="h-7" disabled={Boolean(busy)} onClick={onRemove}>
                Remove
              </DialButton>
            </div>
            <FileInput ref={replace} onFile={onUpload} />
          </div>
        </div>
      ) : (
        <DropZone
          title="Landmark"
          hint="Drop a photo of the place here, or make one with AI below. A photo's background is removed for you; a PNG that is already cut out keeps its own edges."
          busy={busy}
          onFile={onUpload}
        />
      )}

      <Generate busy={busy} onGenerate={onGenerate} />

      {takes.length > 0 && (
        <div className="flex flex-col gap-1.5 pt-1">
          <p className="px-1 text-[12px] text-white/65">Earlier tries</p>
          <div className="flex flex-wrap gap-1.5">
            {takes.map((take) => {
              const current = image?.take === take.file;
              return (
                <button
                  key={take.file}
                  type="button"
                  className={cn(
                    "cursor-pointer rounded-[8px] outline-none ring-1 ring-white/10 transition-shadow hover:ring-white/30 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50",
                    current && "ring-2 ring-white/70 hover:ring-white/70",
                  )}
                  aria-label={`Use ${take.name}`}
                  aria-pressed={current}
                  title={take.name}
                  disabled={Boolean(busy)}
                  onClick={() => onUseTake(take.file)}
                >
                  <Swatch src={take.url} className="size-14 rounded-[8px] p-1" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {image && (
        <>
          <div className="h-1.5" />
          <DialText label="Name" value={image.name} onChange={onName} />
          <DialNote>Read out by screen readers in place of the image.</DialNote>
          <DialSlider
            label="Size"
            value={image.place.scale * 100}
            min={25}
            max={250}
            format={(v) => `${Math.round(v)}%`}
            onChange={(v) => onPlace({ ...image.place, scale: Math.round(v) / 100 })}
          />
          <DialSlider
            label="Left and right"
            value={image.place.x}
            min={-460}
            max={460}
            format={(v) => `${Math.round(v)} px`}
            onChange={(v) => onPlace({ ...image.place, x: Math.round(v) })}
          />
          <DialSlider
            label="Up and down"
            value={image.place.y}
            min={-540}
            max={540}
            format={(v) => `${Math.round(v)} px`}
            onChange={(v) => onPlace({ ...image.place, y: Math.round(v) })}
          />
          <DialButton onClick={() => onPlace({ x: 0, y: 0, scale: 1 })}>Reset position</DialButton>
          <DialNote>You can also drag it in the preview, and pinch to resize it.</DialNote>
        </>
      )}
    </div>
  );
}

// A landmark on the panel's black, as it will sit on the post.
function Swatch({ src, className }: { src: string; className?: string }) {
  return (
    <span
      className={cn("flex shrink-0 items-end justify-center overflow-hidden", className)}
      style={{ background: PALETTE.sky }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="max-h-full max-w-full object-contain" />
    </span>
  );
}

// Type a city or a landmark and get it in the post's style.
function Generate({
  busy,
  onGenerate,
}: {
  busy: string | null;
  onGenerate: (place: string) => Promise<Problem | null>;
}) {
  const [place, setPlace] = useState("");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [making, setMaking] = useState(false);
  const id = useId();

  return (
    <form
      className="flex flex-col gap-1.5 pt-1"
      onSubmit={async (e) => {
        e.preventDefault();
        const words = place.trim();
        if (!words || busy) return;
        setMaking(true);
        setProblem(await onGenerate(words));
        setMaking(false);
      }}
    >
      <label
        htmlFor={id}
        className="flex h-9 w-full cursor-text items-center gap-3 rounded-[10px] bg-white/[0.05] px-3 text-[12px] transition-colors hover:bg-white/[0.07] has-[:focus-visible]:bg-white/[0.08] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
      >
        <span className="shrink-0 text-white/65">Make one with AI</span>
        <input
          id={id}
          value={place}
          placeholder="Dubai, or Burj Khalifa"
          onChange={(e) => {
            setPlace(e.target.value);
            setProblem(null);
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-right text-white/90 outline-none placeholder:text-white/30"
        />
      </label>
      <DialButton type="submit" loading={making} disabled={!place.trim() || (Boolean(busy) && !making)}>
        <SparklesIcon aria-hidden="true" />
        Generate
      </DialButton>
      <DialNote>
        Type a city or a landmark. It comes back in the same black and white style as the towers, cut out and
        ready. About 20 seconds and 4 cents of Vercel credit each.
      </DialNote>
      {problem && (
        <div
          className="flex flex-col items-start gap-2 rounded-[10px] bg-destructive/12 px-3 py-2.5"
          role="alert"
        >
          <p className="text-[12px] text-destructive-foreground">{problem.message}</p>
          {problem.action && (
            <a
              href={problem.action.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 items-center gap-1.5 rounded-[7px] bg-white/[0.08] px-2.5 text-[12px] text-white/85 outline-none hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-ring"
            >
              {problem.action.label}
              <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
            </a>
          )}
        </div>
      )}
    </form>
  );
}
