"use client";

import { ExternalLinkIcon, SparklesIcon } from "lucide-react";
import { useRef, useState } from "react";
import { PALETTE } from "@/components/post/palette";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import type { Placement, PostDoc, Take } from "@/lib/tool/doc";
import { cn } from "@/lib/utils";
import type { Problem } from "./api";
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
    <div className="flex flex-col gap-5">
      {image ? (
        <div className="flex gap-3">
          <Swatch src={image.x1} className="size-20 rounded-lg p-1.5" />
          <div className="flex min-w-0 flex-col justify-between gap-2">
            <p className="text-muted-foreground text-xs">{busy ?? image.note}</p>
            <div className="flex gap-2">
              <Button size="xs" variant="outline" disabled={Boolean(busy)} onClick={() => replace.current?.click()}>
                Upload instead
              </Button>
              <Button size="xs" variant="ghost" disabled={Boolean(busy)} onClick={onRemove}>
                Remove
              </Button>
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
        <div className="flex flex-col gap-2">
          <p className="font-medium text-sm">Earlier tries</p>
          <div className="flex flex-wrap gap-2">
            {takes.map((take) => {
              const current = image?.take === take.file;
              return (
                <button
                  key={take.file}
                  type="button"
                  className={cn(
                    "cursor-pointer rounded-md outline-none ring-1 ring-border transition-shadow hover:ring-ring/60 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-64",
                    current && "ring-2 ring-ring",
                  )}
                  aria-label={`Use ${take.name}`}
                  aria-pressed={current}
                  title={take.name}
                  disabled={Boolean(busy)}
                  onClick={() => onUseTake(take.file)}
                >
                  <Swatch src={take.url} className="size-14 rounded-md p-1" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {image && (
        <>
          <Field>
            <FieldLabel>Name</FieldLabel>
            <Input value={image.name} onChange={(e) => onName(e.target.value)} />
            <FieldDescription>Read out by screen readers in place of the image.</FieldDescription>
          </Field>

          <PlaceSlider
            label="Size"
            value={image.place.scale * 100}
            min={25}
            max={250}
            unit="%"
            onChange={(v) => onPlace({ ...image.place, scale: Math.round(v) / 100 })}
          />
          <PlaceSlider
            label="Left and right"
            value={image.place.x}
            min={-460}
            max={460}
            unit=" px"
            onChange={(v) => onPlace({ ...image.place, x: Math.round(v) })}
          />
          <PlaceSlider
            label="Up and down"
            value={image.place.y}
            min={-540}
            max={540}
            unit=" px"
            onChange={(v) => onPlace({ ...image.place, y: Math.round(v) })}
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-muted-foreground text-xs">
              You can also drag it in the preview, and pinch to resize it.
            </p>
            <Button
              size="xs"
              variant="ghost"
              className="shrink-0"
              onClick={() => onPlace({ x: 0, y: 0, scale: 1 })}
            >
              Reset
            </Button>
          </div>
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

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const words = place.trim();
        if (!words || busy) return;
        setMaking(true);
        setProblem(await onGenerate(words));
        setMaking(false);
      }}
    >
      <Field>
        <FieldLabel>Make one with AI</FieldLabel>
        <div className="flex w-full gap-2">
          <Input
            value={place}
            placeholder="Dubai, or Burj Khalifa"
            onChange={(e) => {
              setPlace(e.target.value);
              setProblem(null);
            }}
          />
          <Button type="submit" loading={making} disabled={!place.trim() || (Boolean(busy) && !making)}>
            <SparklesIcon aria-hidden="true" />
            Generate
          </Button>
        </div>
        <FieldDescription>
          Type a city or a landmark. It comes back in the same black and white style as the towers, cut out
          and ready. About 20 seconds and 4 cents of Vercel credit each.
        </FieldDescription>
      </Field>
      {problem && (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2.5" role="alert">
          <p className="text-destructive-foreground text-xs">{problem.message}</p>
          {problem.action && (
            <a
              href={problem.action.url}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ size: "xs", variant: "outline" })}
            >
              {problem.action.label}
              <ExternalLinkIcon aria-hidden="true" />
            </a>
          )}
        </div>
      )}
    </form>
  );
}

function PlaceSlider({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {Math.round(value)}
          {unit}
        </span>
      </div>
      <Slider
        aria-label={label}
        min={min}
        max={max}
        step={1}
        value={Math.min(max, Math.max(min, value))}
        onValueChange={(v) => onChange((Array.isArray(v) ? v[0] : v) as number)}
      />
    </div>
  );
}
