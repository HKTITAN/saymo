"use client";

import { type KeyboardEvent, type PointerEvent, useRef } from "react";
import { PauseCircleIcon, PlayCircleIcon, RefreshIcon } from "@/components/icons";
import type { Mark } from "@/lib/studio/contract";
import { cn } from "@/lib/utils";
import { type Clock, formatTime, useClock } from "./clock";
import { CARD, Hint, ICON_BUTTON, PANEL_MOTION } from "./panel";

// The timeline along the bottom: play and pause, the film's named moments,
// and a track to scrub. Dragging pauses; Space plays.

export function Timeline({
  clock,
  fps,
  marks,
  hidden,
  className,
  style,
}: {
  clock: Clock;
  fps: number;
  marks: Mark[];
  hidden: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const t = useClock(clock, (s) => s.t);
  const duration = useClock(clock, (s) => s.duration);
  const playing = useClock(clock, (s) => s.playing);
  const loop = useClock(clock, (s) => s.loop);
  const track = useRef<HTMLDivElement>(null);
  const share = duration > 0 ? Math.min(1, t / duration) : 0;

  const at = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r) return 0;
    const raw = ((clientX - r.left) / r.width) * duration;
    // Snap to a named moment within 6px.
    const near = marks.find((m) => Math.abs(((m.t - raw) / duration) * r.width) < 6);
    return near ? near.t : raw;
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    clock.pause();
    clock.seek(at(e.clientX));
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) clock.seek(at(e.clientX));
  };

  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    const frame = 1 / (fps || 60);
    const step = e.shiftKey ? 1 : frame;
    const sorted = [...marks].sort((a, b) => a.t - b.t);
    let next: number | null = null;
    if (e.key === "ArrowRight") next = t + step;
    else if (e.key === "ArrowLeft") next = t - step;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = duration;
    else if (e.key === "PageDown") next = sorted.find((m) => m.t > t + 1e-3)?.t ?? duration;
    else if (e.key === "PageUp") next = sorted.findLast((m) => m.t < t - 1e-3)?.t ?? 0;
    if (next === null) return;
    e.preventDefault();
    clock.pause();
    clock.seek(next);
  };

  return (
    <section
      aria-label="Timeline"
      inert={hidden}
      className={cn(
        CARD,
        PANEL_MOTION,
        "pointer-events-auto absolute flex h-14 items-center gap-2 px-2",
        hidden && "pointer-events-none translate-y-2 opacity-0",
        className,
      )}
      style={style}
    >
      <Hint label={playing ? "Pause" : "Play"} keys={["Space"]}>
        <button
          type="button"
          className={cn(ICON_BUTTON, "size-10 rounded-[11px] text-white/85 [&_svg]:size-5")}
          onClick={() => clock.toggle()}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <PauseCircleIcon aria-hidden="true" /> : <PlayCircleIcon aria-hidden="true" />}
        </button>
      </Hint>
      <p className="w-[124px] shrink-0 font-mono text-[11.5px] tabular-nums">
        <span className="text-white/90">{formatTime(t)}</span>
        <span className="text-white/35"> / {formatTime(duration)}</span>
      </p>
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Playhead"
        aria-valuemin={0}
        aria-valuemax={Number(duration.toFixed(2))}
        aria-valuenow={Number(t.toFixed(2))}
        aria-valuetext={formatTime(t)}
        onPointerDown={down}
        onPointerMove={move}
        onKeyDown={keys}
        className="relative h-10 min-w-0 flex-1 cursor-ew-resize touch-none select-none overflow-hidden rounded-[10px] bg-white/[0.05] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="absolute inset-y-0 left-0 bg-white/[0.07]" style={{ width: `${share * 100}%` }} />
        {marks.map((m) => {
          const x = duration > 0 ? (m.t / duration) * 100 : 0;
          return (
            <div key={`${m.t}-${m.label}`} className="pointer-events-none absolute inset-y-0" style={{ left: `${x}%` }}>
              <div className="absolute inset-y-0 w-px bg-white/15" />
              <span className="absolute bottom-1.5 left-1.5 whitespace-nowrap text-[10.5px] text-white/40">{m.label}</span>
            </div>
          );
        })}
        <div
          className="pointer-events-none absolute inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-white shadow-[0_0_0_3px_rgba(0,0,0,0.25)]"
          style={{ left: `${share * 100}%` }}
        />
      </div>
      <Hint label={loop ? "Play once" : "Play on repeat"} keys={["L"]}>
        <button
          type="button"
          className={cn(ICON_BUTTON, "size-9", loop && "text-white")}
          onClick={() => clock.setLoop(!loop)}
          aria-pressed={loop}
          aria-label="Play on repeat"
        >
          <RefreshIcon aria-hidden="true" className={cn(!loop && "opacity-40")} />
        </button>
      </Hint>
    </section>
  );
}
