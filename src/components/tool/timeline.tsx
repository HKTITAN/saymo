"use client";

import { type KeyboardEvent, type PointerEvent, type RefObject, useEffect, useRef, useState } from "react";
import { PauseCircleIcon, PlayCircleIcon } from "@/components/icons";
import { MOTION_BY_ID, type MotionId } from "@/components/post/lines";
import { PALETTE } from "@/components/post/palette";
import type { PostHandle } from "@/components/post/post";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";

// The loop under the preview: play and pause, the moments each motion is
// built on, and the cover, the frame the image and the video open on.
// Dragging the playhead, or the arrow keys, finds any moment; finding one
// pauses the loop there.

// Each motion's beats, as its storyboard in post/lines.ts sets them out.
const BEATS: Record<MotionId, { at: number; label: string }[]> = {
  scenes: [
    { at: 0, label: "Orange rises" },
    { at: 1.5, label: "Stone sweeps" },
    { at: 3, label: "Orange bursts" },
    { at: 4.5, label: "Black returns" },
  ],
  burst: [
    { at: 0, label: "Orange bursts" },
    { at: 2, label: "Stone bursts" },
    { at: 4, label: "Black bursts" },
  ],
  tide: [
    { at: 0, label: "Rolls in" },
    { at: 2.2, label: "Breathes" },
    { at: 5.8, label: "Rolls out" },
  ],
  signal: [
    { at: 0, label: "Searches" },
    { at: 1.5, label: "Settles" },
    { at: 3, label: "Fires" },
    { at: 4.5, label: "Black returns" },
  ],
};

// "0:01.25"
const clock = (seconds: number) => `0:${seconds.toFixed(2).padStart(5, "0")}`;
const SNAP = 6; // screen pixels within which the playhead lands on a mark

export function Timeline({
  motion,
  playing,
  onPlaying,
  post,
}: {
  motion: MotionId;
  playing: boolean;
  onPlaying: (playing: boolean) => void;
  post: RefObject<PostHandle | null>;
}) {
  const { duration, still } = MOTION_BY_ID[motion];
  const beats = BEATS[motion];
  const marks = [...new Set([still, ...beats.map((b) => b.at)])].sort((a, b) => a - b);
  const now = useRef(still);
  const seeking = useRef(false);
  const [time, setTime] = useState(still);

  // A new motion opens on its cover, as the post does.
  const [shownMotion, setShownMotion] = useState(motion);
  if (motion !== shownMotion) {
    setShownMotion(motion);
    setTime(still);
  }
  useEffect(() => {
    now.current = MOTION_BY_ID[motion].still;
  }, [motion]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (at: number) => {
      now.current = (now.current + (at - last) / 1000) % duration;
      last = at;
      post.current?.renderAt(now.current);
      setTime(now.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration, post]);

  const seek = (seconds: number) => {
    const t = Math.min(duration, Math.max(0, seconds));
    now.current = t;
    post.current?.renderAt(t);
    setTime(t);
    onPlaying(false);
  };

  const timeAt = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - box.left;
    const near = marks.find((m) => Math.abs((m / duration) * box.width - x) <= SNAP);
    return near ?? (x / box.width) * duration;
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 1 : 0.1;
    let to: number | undefined;
    switch (e.key) {
      case " ":
        e.preventDefault();
        onPlaying(!playing);
        return;
      case "ArrowLeft":
      case "ArrowDown":
        to = time - step;
        break;
      case "ArrowRight":
      case "ArrowUp":
        to = time + step;
        break;
      case "Home":
        to = 0;
        break;
      case "End":
        to = duration;
        break;
      // Page Up and Page Down jump between the marks.
      case "PageUp":
        to = [...marks].reverse().find((m) => m < time - 0.001) ?? 0;
        break;
      case "PageDown":
        to = marks.find((m) => m > time + 0.001) ?? duration;
        break;
    }
    if (to === undefined) return;
    e.preventDefault();
    seek(to);
  };

  const at = (seconds: number) => `${(seconds / duration) * 100}%`;

  return (
    <div className="flex items-center gap-3">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={playing ? "Pause" : "Play"}
              onClick={() => onPlaying(!playing)}
              className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[10px] bg-white/[0.05] text-white/85 outline-none transition-colors hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-5"
            />
          }
        >
          {playing ? <PauseCircleIcon aria-hidden="true" /> : <PlayCircleIcon aria-hidden="true" />}
        </TooltipTrigger>
        <TooltipPopup>
          <span className="flex items-center gap-2">
            {playing ? "Pause" : "Play"}
            <Kbd>Space</Kbd>
          </span>
        </TooltipPopup>
      </Tooltip>

      <p className="shrink-0 font-mono text-[12px] text-white/85 tabular-nums">
        {clock(time)}
        <span className="text-white/35"> / {clock(duration)}</span>
      </p>

      <div
        role="slider"
        tabIndex={0}
        aria-label="Moment in the loop"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={Math.round(time * 100) / 100}
        aria-valuetext={`${time.toFixed(2)} of ${duration} seconds`}
        className="relative h-11 min-w-0 flex-1 cursor-ew-resize touch-none select-none overflow-hidden rounded-[10px] bg-white/[0.05] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seeking.current = true;
          seek(timeAt(e));
        }}
        onPointerMove={(e) => {
          if (seeking.current) seek(timeAt(e));
        }}
        onPointerUp={() => {
          seeking.current = false;
        }}
        onPointerCancel={() => {
          seeking.current = false;
        }}
        onKeyDown={onKey}
      >
        {/* The part already played, filled as DialKit fills a slider. */}
        <div className="absolute inset-y-0 left-0 bg-white/[0.06]" style={{ width: at(time) }} />
        {beats.map((b) => (
          <div key={b.at} className="pointer-events-none absolute inset-y-0" style={{ left: at(b.at) }}>
            <div className="absolute inset-y-0 w-px bg-white/15" />
            <span className="absolute bottom-1.5 left-1.5 whitespace-nowrap text-[10.5px] text-white/45">
              {b.label}
            </span>
          </div>
        ))}
        <div className="pointer-events-none absolute inset-y-0" style={{ left: at(still) }}>
          <div className="absolute inset-y-0 w-px" style={{ background: PALETTE.orange }} />
          <span
            className="absolute top-1.5 left-1.5 rounded-[4px] px-1 font-medium text-[10px] leading-4"
            style={{ background: PALETTE.orange, color: PALETTE.ink }}
          >
            Cover
          </span>
        </div>
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-white"
          style={{ left: at(time) }}
        />
      </div>
    </div>
  );
}
