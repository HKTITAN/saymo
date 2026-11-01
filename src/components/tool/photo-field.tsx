"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import type { Crop, PostDoc } from "@/lib/tool/doc";
import { DropZone, FileInput } from "./drop-zone";

type Source = NonNullable<NonNullable<PostDoc["photo"]>["source"]>;

// The speaker photo: upload, then move and zoom the square crop over it.
export function PhotoField({
  photo,
  busy,
  onUpload,
  onChange,
}: {
  photo: PostDoc["photo"];
  busy: string | null;
  onUpload: (file: File) => void;
  onChange: (change: { crop?: Crop; plain?: boolean }) => void;
}) {
  const replace = useRef<HTMLInputElement>(null);

  if (!photo) {
    return (
      <DropZone
        title="Speaker photo"
        hint="Drop a photo here. The face is framed and the background made plain grey for you."
        busy={busy}
        onFile={onUpload}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {photo.source && photo.crop ? (
        <Cropper
          key={photo.source.preview}
          source={photo.source}
          crop={photo.crop}
          busy={busy}
          onCommit={(crop) => onChange({ crop })}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo.x2} alt="" className="size-40 rounded-lg" />
      )}
      <div className="flex items-center justify-between gap-3">
        <Label>
          <Switch
            checked={photo.plain}
            disabled={Boolean(busy) || !photo.source}
            onCheckedChange={(plain) => onChange({ plain })}
          />
          Plain grey background
        </Label>
        <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => replace.current?.click()}>
          Replace photo
        </Button>
        <FileInput ref={replace} onFile={onUpload} />
      </div>
    </div>
  );
}

function Cropper({
  source,
  crop: saved,
  busy,
  onCommit,
}: {
  source: Source;
  crop: Crop;
  busy: string | null;
  onCommit: (crop: Crop) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; crop: Crop } | null>(null);
  // The crop follows the pointer here, and is made on the server on release.
  const [crop, setCrop] = useState(saved);
  const [lastSaved, setLastSaved] = useState(saved);
  if (saved !== lastSaved) {
    setLastSaved(saved);
    setCrop(saved);
  }

  const largest = Math.min(source.width, source.height);
  const smallest = Math.round(largest * 0.15);
  const clamp = (c: Crop): Crop => {
    const size = Math.round(Math.min(Math.max(c.size, smallest), largest));
    return {
      x: Math.round(Math.min(Math.max(c.x, 0), source.width - size)),
      y: Math.round(Math.min(Math.max(c.y, 0), source.height - size)),
      size,
    };
  };
  // Zoom keeps the crop's centre where it is.
  const zoomed = (zoom: number) => {
    const size = largest / zoom;
    return clamp({ x: crop.x + (crop.size - size) / 2, y: crop.y + (crop.size - size) / 2, size });
  };
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const ratio = source.width / source.height;
  const zoomOf = (v: number | readonly number[]) => (Array.isArray(v) ? v[0] : v) as number;

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={box}
        className="relative mx-auto touch-none select-none overflow-hidden rounded-lg bg-muted"
        style={{ width: `min(100%, ${Math.round(280 * ratio)}px)`, aspectRatio: `${source.width} / ${source.height}` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={source.preview} alt="" className="absolute inset-0 size-full" draggable={false} />
        <div
          className="absolute cursor-move outline-2 outline-white/90 focus-visible:outline-ring"
          style={{
            left: pct(crop.x, source.width),
            top: pct(crop.y, source.height),
            width: pct(crop.size, source.width),
            height: pct(crop.size, source.height),
            boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.55)",
          }}
          role="group"
          aria-label="Photo crop. Drag to move it, or use the arrow keys."
          tabIndex={0}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, crop };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            const el = box.current;
            if (!d || !el) return;
            // Screen pixels to the photo's own pixels.
            const k = source.width / el.clientWidth;
            setCrop(clamp({ ...d.crop, x: d.crop.x + (e.clientX - d.x) * k, y: d.crop.y + (e.clientY - d.y) * k }));
          }}
          onPointerUp={() => {
            if (!drag.current) return;
            drag.current = null;
            onCommit(crop);
          }}
          onKeyDown={(e) => {
            const step = Math.max(1, Math.round(crop.size * 0.02));
            const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
            if (!move) return;
            e.preventDefault();
            setCrop(clamp({ ...crop, x: crop.x + move[0], y: crop.y + move[1] }));
          }}
          onKeyUp={(e) => {
            if (e.key.startsWith("Arrow")) onCommit(crop);
          }}
        />
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Spinner className="text-white" />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex justify-between text-sm">
          <span className="font-medium">Zoom</span>
          <span className="text-muted-foreground tabular-nums">{(largest / crop.size).toFixed(1)}×</span>
        </div>
        <Slider
          aria-label="Zoom"
          min={1}
          max={largest / smallest}
          step={0.01}
          value={largest / crop.size}
          onValueChange={(v) => setCrop(zoomed(zoomOf(v)))}
          onValueCommitted={(v) => onCommit(zoomed(zoomOf(v)))}
        />
      </div>
    </div>
  );
}
