"use client";

import { Popover } from "@base-ui/react/popover";
import { type PointerEvent, useState } from "react";
import { LABEL, ROW_BUTTON, SURFACE, VALUE } from "@/components/tool/dial";
import { cn } from "@/lib/utils";

// A colour as a DialKit row: the swatch and its hex on the right. It opens
// our own picker: a square for strength and lightness, a strip for hue, a
// hex field and the Aerchain colours. No browser colour picker.

const BRAND = [
  ["Orange", "#F55A00"],
  ["Black", "#1E1E1E"],
  ["Ink", "#141414"],
  ["Stone", "#E9E5DD"],
  ["Deep stone", "#D3CCBF"],
  ["Grey", "#6B665E"],
  ["White", "#FFFFFF"],
] as const;

type Hsv = { h: number; s: number; v: number };

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

export function normalHex(input: string): string | null {
  const m = input.trim().replace(/^#/, "").match(/^([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return `#${hex.toUpperCase()}`;
}

function toHsv(hex: string): Hsv {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

function toHex({ h, s, v }: Hsv) {
  const f = (k: number) => {
    const x = (k + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(x, 4 - x, 1));
  };
  return `#${[f(5), f(3), f(1)]
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
}

export function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  const hex = normalHex(value) ?? "#000000";
  const [hsv, setHsv] = useState<Hsv>(() => toHsv(hex));
  const [text, setText] = useState(hex);

  // Follow changes from outside (undo, another row), keeping our hue when
  // the colour is grey and has none.
  const [seen, setSeen] = useState(hex);
  if (seen !== hex) {
    setSeen(hex);
    setText(hex);
    if (toHex(hsv) !== hex) {
      const next = toHsv(hex);
      setHsv(next.s === 0 ? { ...next, h: hsv.h } : next);
    }
  }

  const set = (next: Hsv) => {
    setHsv(next);
    const out = toHex(next);
    setText(out);
    onChange(out);
  };

  const drag = (el: HTMLElement, e: PointerEvent, apply: (x: number, y: number) => void) => {
    const r = el.getBoundingClientRect();
    apply(clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height));
  };

  return (
    <Popover.Root>
      <Popover.Trigger className={ROW_BUTTON}>
        <span className={LABEL}>{label}</span>
        <span className="ms-auto flex items-center gap-2">
          <span className={VALUE}>{hex}</span>
          <span className="size-4 rounded-[5px] shadow-[inset_0_0_0_1px_rgb(var(--hi)_/_0.15)]" style={{ background: hex }} />
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="left" align="start" sideOffset={12} collisionPadding={12} className="z-50">
          <Popover.Popup
            className={cn(
              SURFACE,
              "flex w-[232px] origin-(--transform-origin) flex-col gap-2 p-2 outline-none transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0",
            )}
          >
            {/* Strength left to right, lightness bottom to top. */}
            <div
              role="slider"
              tabIndex={0}
              aria-label="Strength and lightness"
              aria-valuetext={hex}
              aria-valuenow={Math.round(hsv.s * 100)}
              className="relative h-36 cursor-crosshair touch-none rounded-[10px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{
                background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))`,
              }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                drag(e.currentTarget, e, (x, y) => set({ ...hsv, s: x, v: 1 - y }));
              }}
              onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId))
                  drag(e.currentTarget, e, (x, y) => set({ ...hsv, s: x, v: 1 - y }));
              }}
              onKeyDown={(e) => {
                const d = e.shiftKey ? 0.1 : 0.02;
                const moves: Record<string, Partial<Hsv>> = {
                  ArrowLeft: { s: clamp(hsv.s - d) },
                  ArrowRight: { s: clamp(hsv.s + d) },
                  ArrowUp: { v: clamp(hsv.v + d) },
                  ArrowDown: { v: clamp(hsv.v - d) },
                };
                if (moves[e.key]) {
                  e.preventDefault();
                  set({ ...hsv, ...moves[e.key] });
                }
              }}
            >
              <span
                className="pointer-events-none absolute size-3.5 -translate-x-1/2 translate-y-1/2 rounded-full shadow-[0_0_0_2px_#fff,0_0_0_3px_rgb(0_0_0_/_calc(0.3*var(--shade)))]"
                style={{ left: `${hsv.s * 100}%`, bottom: `${hsv.v * 100}%`, background: hex }}
              />
            </div>
            <div
              role="slider"
              tabIndex={0}
              aria-label="Hue"
              aria-valuemin={0}
              aria-valuemax={360}
              aria-valuenow={Math.round(hsv.h)}
              className="relative h-3.5 cursor-ew-resize touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                drag(e.currentTarget, e, (x) => set({ ...hsv, h: x * 360 }));
              }}
              onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) drag(e.currentTarget, e, (x) => set({ ...hsv, h: x * 360 }));
              }}
              onKeyDown={(e) => {
                const d = e.shiftKey ? 15 : 2;
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  set({ ...hsv, h: (hsv.h + (e.key === "ArrowRight" ? d : -d) + 360) % 360 });
                }
              }}
            >
              <span
                className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_0_0_2px_#fff,0_0_0_3px_rgb(0_0_0_/_calc(0.3*var(--shade)))]"
                style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }}
              />
            </div>
            <label className="flex h-8 items-center gap-2 rounded-[8px] bg-white/[0.05] px-2.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
              <span className={LABEL}>Hex</span>
              <input
                value={text}
                spellCheck={false}
                onChange={(e) => {
                  setText(e.target.value);
                  const next = normalHex(e.target.value);
                  if (next) {
                    setHsv(toHsv(next));
                    onChange(next);
                  }
                }}
                onBlur={() => setText(hex)}
                className="h-full min-w-0 flex-1 bg-transparent text-right tabular-nums text-[12px] text-white/90 uppercase outline-none"
              />
            </label>
            <div className="flex gap-1.5 px-0.5 pb-0.5">
              {BRAND.map(([name, color]) => (
                <button
                  key={color}
                  type="button"
                  aria-label={name}
                  onClick={() => {
                    setHsv(toHsv(color));
                    setText(color);
                    onChange(color);
                  }}
                  className={cn(
                    "size-6 cursor-pointer rounded-[7px] shadow-[inset_0_0_0_1px_rgb(var(--hi)_/_0.14)] outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring",
                    color === hex && "ring-2 ring-white/70 ring-offset-1 ring-offset-raised",
                  )}
                  style={{ background: color }}
                />
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
