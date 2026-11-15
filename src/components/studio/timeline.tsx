"use client";

import { type KeyboardEvent, type PointerEvent, useLayoutEffect, useRef, useState } from "react";
import { PauseCircleIcon, PlayCircleIcon, RefreshIcon, SpeakerOnIcon } from "@/components/icons";
import type { Mark } from "@/lib/studio/contract";
import { cn } from "@/lib/utils";
import { type Clock, formatTime, useClock } from "./clock";
import { CARD, Hint, ICON_BUTTON, PANEL_MOTION } from "./panel";
import { MotionSoundLane, type SoundLaneData, showLane, showStems, stemLanes } from "./sound-lane";
import { StemLane, stemLabel } from "./sound-stems";

// The timeline along the bottom: play and pause, the film's named moments,
// and a track to scrub, with the sound design's waveforms under it once the
// film has one (Music and Effects, and Voiceover on a film made from slides
// with a voice, where parts can be picked and changed). Dragging pauses; Space plays; M mutes the sound here.

export function Timeline({
  clock,
  fps,
  marks,
  hidden,
  sound,
  onMute,
  className,
  style,
}: {
  clock: Clock;
  fps: number;
  marks: Mark[];
  hidden: boolean;
  sound?: SoundLaneData;
  onMute?: (muted: boolean) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const t = useClock(clock, (s) => s.t);
  const duration = useClock(clock, (s) => s.duration);
  const playing = useClock(clock, (s) => s.playing);
  const loop = useClock(clock, (s) => s.loop);
  const track = useRef<HTMLDivElement>(null);
  const share = duration > 0 ? Math.min(1, t / duration) : 0;
  const lane = showLane(sound);
  const [trackW, setTrackW] = useState(0);
  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const measure = () => setTrackW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
        "pointer-events-auto absolute flex min-h-14 items-center gap-2 px-2",
        lane && "py-2",
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
      {/* The time, with the sound lanes' names under it, each beside its
          lane, so the names never cover the start of a waveform. */}
      <div className={cn("flex w-[124px] shrink-0 flex-col gap-1", lane && "self-start")}>
        <p className="h-10 text-[11.5px] leading-10 tabular-nums">
          <span className="text-white/90">{formatTime(t)}</span>
          <span className="text-white/35"> / {formatTime(duration)}</span>
        </p>
        {showStems(sound)
          ? stemLanes(sound).map((stem) => (
              <p
                key={stem}
                aria-hidden="true"
                className={cn("flex h-5 items-center truncate text-[10.5px] text-white/50", (!sound.on || sound.muted) && "opacity-60")}
              >
                {stemLabel(stem)}
                {sound.present && !sound.present.includes(stem) ? <span className="text-white/25">, none</span> : null}
              </p>
            ))
          : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
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
        className="relative h-10 min-w-0 cursor-ew-resize touch-none select-none overflow-hidden rounded-[10px] bg-white/[0.05] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="absolute inset-y-0 left-0 bg-white/[0.07]" style={{ width: `${share * 100}%` }} />
        {[...marks]
          .sort((a, b) => a.t - b.t)
          .map((m, i, sorted) => {
            const at = (t: number) => (duration > 0 ? (Math.min(t, duration) / duration) * 100 : 0);
            // Each name gets the room up to the next mark, so close moments
            // shorten their names instead of running into each other.
            const room = at(sorted[i + 1]?.t ?? duration) - at(m.t);
            return (
              <div
                key={`${m.t}-${m.label}`}
                className="pointer-events-none absolute inset-y-0"
                style={{ left: `${at(m.t)}%`, width: `${room}%` }}
              >
                <div className="absolute inset-y-0 w-px bg-white/15" />
                <span className="absolute right-1 bottom-1.5 left-1.5 truncate text-[10.5px] text-white/40">{m.label}</span>
              </div>
            );
          })}
        <div
          className="pointer-events-none absolute inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-white shadow-[0_0_0_3px_rgb(0_0_0_/_calc(0.25*var(--shade)))]"
          style={{ left: `${share * 100}%` }}
        />
      </div>
      {showStems(sound) ? (
        // Music, Effects and any Voiceover: drag across one to pick part of it.
        <div className={cn("flex flex-col gap-1", (!sound.on || sound.muted) && "opacity-60")}>
          {stemLanes(sound).map((stem) => (
            <StemLane
              key={stem}
              stem={stem}
              peaks={sound.stems[stem]}
              empty={Boolean(sound.present && !sound.present.includes(stem))}
              duration={duration}
              width={trackW}
              height={20}
              editor={sound.editor}
              dim={!sound.on || sound.muted}
              snaps={() => [clock.get().t, ...marks.map((m) => m.t)]}
              playhead={share}
              above="card"
              className="rounded-[7px] bg-white/[0.03]"
            />
          ))}
        </div>
      ) : lane && sound ? (
        // Scrubbing works here too, as on the track above.
        <div onPointerDown={down} onPointerMove={move} className="cursor-ew-resize touch-none select-none">
          <MotionSoundLane data={sound} duration={duration} width={trackW} share={share} />
        </div>
      ) : null}
      </div>
      {lane && sound && onMute ? (
        <Hint label={sound.muted ? "Hear the sound" : "Mute while I work"} keys={["M"]}>
          <button
            type="button"
            className={cn(ICON_BUTTON, "size-9", !sound.muted && "text-white")}
            onClick={() => onMute(!sound.muted)}
            aria-pressed={sound.muted}
            aria-label="Mute while I work"
          >
            <SpeakerOnIcon aria-hidden="true" className={cn(sound.muted && "opacity-40")} />
          </button>
        </Hint>
      ) : null}
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
