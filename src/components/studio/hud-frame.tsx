"use client";

import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// A panel cut like a piece of hardware: 45° corners (one cut bigger than
// the rest), an optional tab on top that holds a label, notches in an edge
// and small tick marks in a corner. The outline is an SVG path redrawn at
// the panel's measured size, so the cuts and the 1 px edge stay crisp at any
// size; nothing is stretched. Colours go in through style, so CSS
// variables such as var(--color-studio) work.

export type HudShape = {
  cut: { tl: number; tr: number; br: number; bl: number };
  tab?: { width: number; height: number }; // a tab on the top left, for a label
  notches?: { edge: "top" | "bottom"; at: number; width: number; depth: number }[]; // `at`: 0 to 1 along the edge
  ticks?: "tr" | "bl"; // three short slanted marks in that corner
};

type Point = [number, number];

function outline({ cut, tab, notches = [] }: HudShape, w: number, h: number) {
  const o = 0.5; // half a pixel, so a 1 px stroke lands on whole pixels
  const left = o;
  const right = w - o;
  const bottom = h - o;
  const top = tab ? tab.height + o : o;
  const along = (edge: "top" | "bottom") =>
    notches
      .filter((n) => n.edge === edge)
      .map((n) => ({ ...n, x: n.at * w }))
      .sort((a, b) => a.x - b.x);

  const p: Point[] = [];
  if (tab) p.push([left, o + cut.tl], [left + cut.tl, o], [tab.width - tab.height, o], [tab.width, top]);
  else p.push([left, top + cut.tl], [left + cut.tl, top]);
  for (const n of along("top")) {
    const half = n.width / 2;
    p.push([n.x - half - n.depth, top], [n.x - half, top + n.depth], [n.x + half, top + n.depth], [n.x + half + n.depth, top]);
  }
  p.push([right - cut.tr, top], [right, top + cut.tr], [right, bottom - cut.br], [right - cut.br, bottom]);
  for (const n of along("bottom").reverse()) {
    const half = n.width / 2;
    p.push([n.x + half + n.depth, bottom], [n.x + half, bottom - n.depth], [n.x - half, bottom - n.depth], [n.x - half - n.depth, bottom]);
  }
  p.push([left + cut.bl, bottom], [left, bottom - cut.bl]);
  return `M${p.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join("L")}Z`;
}

function ticks(shape: HudShape, w: number, h: number) {
  if (!shape.ticks) return "";
  const top = shape.tab ? shape.tab.height : 0;
  const lines: string[] = [];
  for (let i = 0; i < 3; i++) {
    const step = i * 5;
    if (shape.ticks === "tr") {
      const x = w - shape.cut.tr - 22 + step;
      lines.push(`M${x},${top + 5}L${x + 4},${top + 9}`);
    } else {
      const x = shape.cut.bl + 10 + step;
      lines.push(`M${x},${h - 9}L${x + 4},${h - 5}`);
    }
  }
  return lines.join("");
}

export function HudFrame({
  shape,
  fill = "#191919",
  stroke = "rgba(255,255,255,0.12)",
  mark = "rgba(255,255,255,0.22)",
  label,
  className,
  children,
}: {
  shape: HudShape;
  fill?: string;
  stroke?: string;
  mark?: string; // the tick marks' colour
  label?: ReactNode; // shown in the tab
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return (
    <div ref={ref} className={cn("relative", className)} style={{ paddingTop: shape.tab?.height }}>
      {size.w ? (
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-visible" width={size.w} height={size.h}>
          <path d={outline(shape, size.w, size.h)} style={{ fill, stroke }} strokeWidth={1} className="transition-[stroke] duration-200" />
          <path d={ticks(shape, size.w, size.h)} style={{ stroke: mark }} strokeWidth={1.5} strokeLinecap="square" fill="none" />
        </svg>
      ) : null}
      {shape.tab && label ? (
        <div className="absolute top-0 left-0 flex items-center ps-3" style={{ height: shape.tab.height, width: shape.tab.width - shape.tab.height }}>
          {label}
        </div>
      ) : null}
      <div className="relative">{children}</div>
    </div>
  );
}
