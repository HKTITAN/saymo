"use client";

import { useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import type { Crop, PostDoc } from "@/lib/tool/doc";
import { DialButton, DialSlider, DialToggle } from "./dial";
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
        title="Drop a photo here"
        hint="The face is framed for you, and the background can be made plain grey."
        busy={busy}
        onFile={onUpload}
      />
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
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
      <DialToggle
        label="Plain grey background"
        checked={photo.plain}
        disabled={Boolean(busy) || !photo.source}
        onChange={(plain) => onChange({ plain })}
      />
      <DialButton disabled={Boolean(busy)} onClick={() => replace.current?.click()}>
        Replace photo
      </DialButton>
      <FileInput ref={replace} onFile={onUpload} />
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
  // Zoom is centred on the middle of the square as it was when the zoom
  // started, so zooming in and back out puts the square back in place even
  // after an edge has nudged it.
  const centre = useRef<{ x: number; y: number } | null>(null);
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
  const zoomed = (zoom: number) => {
    const c = (centre.current ??= { x: crop.x + crop.size / 2, y: crop.y + crop.size / 2 });
    const size = largest / zoom;
    return clamp({ x: c.x - size / 2, y: c.y - size / 2, size });
  };
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const ratio = source.width / source.height;

  return (
    <div className="flex flex-col gap-1.5">
      <div
        ref={box}
        className="relative mx-auto mb-1 touch-none select-none overflow-hidden rounded-[4px] bg-white/[0.05]"
        style={{ width: `min(100%, ${Math.round(280 * ratio)}px)`, aspectRatio: `${source.width} / ${source.height}` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={source.preview} alt="" className="absolute inset-0 size-full" draggable={false} />
        {/* The frame is drawn inside the square, so it stays on the photo
            even when the square sits against an edge. */}
        <div
          className="absolute cursor-move rounded-[2px] shadow-[inset_0_0_0_2px_rgb(255_255_255/0.9),0_0_0_9999px_rgb(0_0_0/0.55)] outline-none focus-visible:shadow-[inset_0_0_0_3px_rgb(255_255_255),0_0_0_9999px_rgb(0_0_0/0.55)]"
          style={{
            left: pct(crop.x, source.width),
            top: pct(crop.y, source.height),
            width: pct(crop.size, source.width),
            height: pct(crop.size, source.height),
          }}
          role="group"
          aria-label="Photo crop. Drag it, or use the arrow keys, to move it."
          tabIndex={0}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, crop };
            centre.current = null;
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
            centre.current = null;
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
      <DialSlider
        label="Zoom"
        value={largest / crop.size}
        min={1}
        max={largest / smallest}
        step={0.01}
        format={(v) => `${v.toFixed(1)}×`}
        onChange={(v) => setCrop(zoomed(v))}
        onCommit={(v) => {
          onCommit(zoomed(v));
          centre.current = null;
        }}
      />
    </div>
  );
}
