"use client";

import { type PointerEvent, useEffect, useRef, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { classify, type MarkHits, type MarkKind, type Pt, type SketchContext, simplify, smoothPath } from "@/lib/studio/films/sketch";
import { formatTime } from "./clock";
import type { Fit } from "./stage";

// Sketch on the frame (docs/plans/sketch-on-the-frame.md): marks drawn over
// the paused film in the studio's accent. A loop lights the parts it
// circles; a line gets a soft arrowhead at its end. Held E erases the marks
// it touches. The marks are kept in film pixels, so they stay put when the
// window changes size, and go with the next message.

export type DraftMark = {
  raw: Pt[]; // as drawn, lightly thinned, for drawing
  kind: MarkKind;
  points: Pt[]; // simplified, for Claude
  hits: MarkHits;
};

const NO_HITS: MarkHits = { inside: [], start: null, end: null, crosses: [] };
const ERASE_REACH = 24; // film pixels

export function sketchContext(t: number, marks: DraftMark[]): SketchContext {
  return { t, marks: marks.map(({ kind, points, hits }) => ({ kind, points, hits })) };
}

export const sketchChip = (t: number, count: number) => `Sketch at ${formatTime(t)}, ${count} mark${count === 1 ? "" : "s"}`;

export function SketchLayer({
  fit,
  film,
  marks,
  drawing,
  onMarks,
}: {
  fit: Fit;
  film: { width: number; height: number };
  marks: DraftMark[];
  drawing: boolean; // sketch mode is on: the pen draws
  onMarks: (marks: DraftMark[]) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [stroke, setStroke] = useState<Pt[] | null>(null);
  const [erasing, setErasing] = useState(false);

  // Held E rubs marks out.
  useEffect(() => {
    if (!drawing) return;
    const down = (e: KeyboardEvent) => {
      if (e.key === "e" || e.key === "E") setErasing(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "e" || e.key === "E") setErasing(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [drawing]);

  const at = (e: PointerEvent): Pt => {
    const r = svg.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: ((e.clientX - r.left) * film.width) / r.width, y: ((e.clientY - r.top) * film.height) / r.height };
  };
  const erase = (p: Pt) => {
    const kept = marks.filter((m) => !m.raw.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < ERASE_REACH));
    if (kept.length !== marks.length) onMarks(kept);
  };

  const down = (e: PointerEvent<SVGSVGElement>) => {
    if (!drawing || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = at(e);
    if (erasing) erase(p);
    else setStroke([p]);
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    if (!drawing || !(e.buttons & 1)) return;
    const p = at(e);
    if (erasing) return erase(p);
    setStroke((s) => {
      if (!s) return s;
      const last = s[s.length - 1];
      return Math.hypot(p.x - last.x, p.y - last.y) < 2 ? s : [...s, p];
    });
  };
  const up = () => {
    if (!stroke) return;
    setStroke(null);
    if (stroke.length < 2) return;
    const kind = classify(stroke, film);
    onMarks([...marks, { raw: simplify(stroke, 240), kind, points: simplify(stroke), hits: NO_HITS }]);
  };

  // Screen pixels to film pixels, for line widths that look the same at any size.
  const k = film.width / Math.max(1, fit.width);
  const ink = "var(--color-studio)";
  const pathOf = (m: { raw: Pt[]; kind: MarkKind }) => smoothPath(m.kind === "loop" ? [...m.raw, m.raw[0]] : m.raw);

  return (
    <svg
      ref={svg}
      role="img"
      aria-label={drawing ? "Draw on the film" : "Your sketch on the film"}
      viewBox={`0 0 ${film.width} ${film.height}`}
      className="absolute touch-none"
      style={{
        left: fit.x,
        top: fit.y,
        width: fit.width,
        height: fit.height,
        pointerEvents: drawing ? "auto" : "none",
        cursor: drawing ? (erasing ? "cell" : "crosshair") : undefined,
      }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      {/* What each loop circles, outlined softly. */}
      {marks.flatMap((m, i) =>
        m.kind === "loop"
          ? m.hits.inside.map((h) =>
              h.rect ? (
                <rect
                  key={`${i}-${h.id ?? h.x}-${h.y}`}
                  x={h.rect.x - 4 * k}
                  y={h.rect.y - 4 * k}
                  width={h.rect.width + 8 * k}
                  height={h.rect.height + 8 * k}
                  rx={6 * k}
                  fill="none"
                  stroke={ink}
                  strokeOpacity={0.55}
                  strokeWidth={1.5 * k}
                  strokeDasharray={`${5 * k} ${4 * k}`}
                />
              ) : null,
            )
          : [],
      )}
      {marks.map((m, i) => (
        <g key={i}>
          <path d={pathOf(m)} fill="none" stroke={ink} strokeWidth={3.5 * k} strokeLinecap="round" strokeLinejoin="round" />
          {m.kind === "line" ? <Arrowhead points={m.raw} size={11 * k} width={3.5 * k} /> : null}
        </g>
      ))}
      {stroke ? (
        <path d={smoothPath(stroke)} fill="none" stroke={ink} strokeWidth={3.5 * k} strokeLinecap="round" strokeLinejoin="round" />
      ) : null}
    </svg>
  );
}

function Arrowhead({ points, size, width }: { points: Pt[]; size: number; width: number }) {
  const b = points[points.length - 1];
  // Aim along the last stretch of the line, not its last wobble.
  const a = points[Math.max(0, points.length - 6)];
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const p1 = { x: b.x - size * Math.cos(angle - 0.5), y: b.y - size * Math.sin(angle - 0.5) };
  const p2 = { x: b.x - size * Math.cos(angle + 0.5), y: b.y - size * Math.sin(angle + 0.5) };
  return (
    <path
      d={`M${p1.x} ${p1.y} L${b.x} ${b.y} L${p2.x} ${p2.y}`}
      fill="none"
      stroke="var(--color-studio)"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

// The note over the film while sketching.
export function SketchHint({ fit }: { fit: Fit }) {
  return (
    <div className="pointer-events-none absolute rounded-[4px] ring-2 ring-studio" style={{ left: fit.x, top: fit.y, width: fit.width, height: fit.height }}>
      <span className="absolute -top-8 left-1/2 flex h-6 -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-[7px] bg-studio px-2 font-medium text-[11.5px] text-white">
        Circle parts or draw a path. Hold <Kbd className="bg-white/20 text-white">E</Kbd> to erase <Kbd className="bg-white/20 text-white">Esc</Kbd>
      </span>
    </div>
  );
}
