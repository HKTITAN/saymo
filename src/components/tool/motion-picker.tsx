"use client";

import { useEffect, useRef, useState } from "react";
import { drawPanel, MOTION_BY_ID, MOTIONS, type MotionId, PANEL_H, PANEL_W } from "@/components/post/lines";
import { cn } from "@/lib/utils";

// The four animations side by side, each a small live line panel. They rest
// on their still frame and play while the pointer is over them; the post's
// own preview plays the one picked.
export function MotionPicker({ value, onChange }: { value: MotionId; onChange: (motion: MotionId) => void }) {
  const [shown, setShown] = useState<MotionId | null>(null);
  const described = MOTION_BY_ID[shown ?? value];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Animation">
        {MOTIONS.map((m, i) => {
          const picked = m.id === value;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={picked}
              className="group flex cursor-pointer flex-col gap-1.5 rounded-lg text-left outline-none"
              onClick={() => onChange(m.id)}
              onPointerEnter={() => setShown(m.id)}
              onPointerLeave={() => setShown(null)}
              onFocus={() => setShown(m.id)}
              onBlur={() => setShown(null)}
            >
              <span
                className={cn(
                  "block overflow-hidden rounded-md ring-1 ring-border transition-shadow group-hover:ring-ring/60 group-focus-visible:ring-2 group-focus-visible:ring-ring",
                  picked && "ring-2 ring-ring group-hover:ring-ring",
                )}
              >
                <Tile motion={m.id} playing={shown === m.id} />
              </span>
              <span className={cn("text-xs", picked ? "font-medium text-foreground" : "text-muted-foreground")}>
                {i + 1} {m.label}
              </span>
            </button>
          );
        })}
      </div>
      <p className="min-h-8 text-muted-foreground text-xs">{described.hint}</p>
    </div>
  );
}

// One motion, drawn small. Resting, it shows the motion's still frame.
function Tile({ motion, playing }: { motion: MotionId; playing: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const scale = (el.clientWidth / PANEL_W) * (window.devicePixelRatio || 1);
    el.width = Math.round(PANEL_W * scale);
    el.height = Math.round(PANEL_H * scale);
    const { still } = MOTION_BY_ID[motion];
    const draw = (seconds: number) => {
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      drawPanel(ctx, motion, seconds, "refined");
    };
    draw(still);
    if (!playing) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      draw(still + (now - start) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [motion, playing]);

  return <canvas ref={canvas} className="block aspect-920/1080 w-full" aria-hidden="true" />;
}
