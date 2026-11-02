"use client";

import { type PointerEvent, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MultipleCrossCancelIcon, RefreshIcon } from "@/components/icons";
import type { SoundStem } from "@/lib/studio/sound";
import { GAIN_MAX, GAIN_MIN } from "@/lib/studio/sound-mix";
import { DialButton, DialSlider, DialToggle } from "@/components/tool/dial";
import { cn } from "@/lib/utils";
import { CARD, ICON_BUTTON } from "./panel";
import { SoundWave } from "./sound-lane";
import type { SoundEditor } from "./use-sound-edit";

// The sound design as two lanes, Music and Effects, each its own stem's
// waveform. Drag across a lane to pick a stretch of it (it snaps to the
// playhead and the film's moments); click to pick the whole lane, or the
// edit under the click. A small panel over the pick sets its volume or
// mutes it, puts it back, or hands just that stretch to Claude. Escape
// lets go.

export const STEM_LABEL: Record<SoundStem, string> = { music: "Music", effects: "Effects" };

const SNAP_PX = 6;
const DRAG_PX = 3;

export const dbText = (v: number) => (Math.abs(v) < 0.05 ? "0 dB" : `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)} dB`);

export function StemLane({
  stem,
  peaks,
  empty,
  duration,
  width,
  height,
  editor,
  dim,
  label,
  snaps,
  playhead,
  above,
  className,
}: {
  stem: SoundStem;
  peaks: number[] | null;
  empty: boolean; // the score has none of this
  duration: number;
  width: number; // px for the whole film
  height: number;
  editor: SoundEditor;
  dim?: boolean;
  label?: boolean; // its name, inside the lane
  snaps: () => number[]; // film times a pick snaps to
  playhead?: number; // 0..1, drawn on the lane
  above?: "lane" | "card"; // the panel sits over the lane, or over the card it's in
  className?: string;
}) {
  const lane = useRef<HTMLDivElement>(null);
  const picked = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; t: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const pick = editor.pick?.stem === stem ? editor.pick : null;
  const share = (t: number) => (duration > 0 ? `${(Math.min(Math.max(t, 0), duration) / duration) * 100}%` : "0%");

  const timeAt = (clientX: number, snap: boolean) => {
    const r = lane.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return 0;
    const t = Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration));
    if (!snap) return t;
    const near = snaps().find((s) => Math.abs(((s - t) / duration) * r.width) < SNAP_PX);
    return near ?? t;
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    // The lane's own; scrubbing is on the track above.
    e.stopPropagation();
    if (empty || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, t: timeAt(e.clientX, true), moved: false };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.x) < DRAG_PX) return;
    if (!d.moved) setDragging(true);
    d.moved = true;
    const t = timeAt(e.clientX, true);
    const from = Math.min(d.t, t);
    const to = Math.max(d.t, t);
    if (to - from >= 0.02) editor.setPick({ stem, from, to });
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (d && !d.moved) editor.pickAt(stem, timeAt(e.clientX, false));
  };

  return (
    <div
      ref={lane}
      role="group"
      aria-label={empty ? `${STEM_LABEL[stem]}, none in this sound` : `${STEM_LABEL[stem]}. Drag to pick part of it`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      className={cn(
        "relative shrink-0 touch-none select-none overflow-hidden",
        empty ? "cursor-default" : "cursor-text",
        className,
      )}
      style={{ height, width }}
    >
      {peaks && !empty ? <SoundWave peaks={peaks} duration={duration} width={width} height={height} dim={dim} /> : null}
      {editor.spans
        .filter((s) => s.stem === stem)
        .map((s) => {
          const wide = ((s.to - s.from) / Math.max(duration, 0.001)) * width > 52;
          return (
            <div
              key={`${s.from}-${s.to}`}
              className="pointer-events-none absolute inset-y-0 border-white/20 border-x bg-white/[0.07]"
              style={{ left: share(s.from), width: `calc(${share(s.to)} - ${share(s.from)})` }}
            >
              {wide ? (
                <span className="absolute top-0 right-1 font-mono text-[9.5px] text-white/60 tabular-nums leading-[14px]">
                  {s.mute ? "Muted" : dbText(s.gain)}
                </span>
              ) : null}
            </div>
          );
        })}
      {label ? (
        <span className="pointer-events-none absolute top-1/2 left-1 -translate-y-1/2 rounded-[4px] bg-[#1b1b1b]/90 px-1 text-[10.5px] text-white/50 leading-[15px]">
          {STEM_LABEL[stem]}
          {empty ? <span className="text-white/25">, none</span> : null}
        </span>
      ) : null}
      {pick ? (
        <div
          ref={picked}
          className="pointer-events-none absolute inset-y-0 rounded-[3px] bg-[#F55A00]/15 ring-1 ring-[#F55A00] ring-inset"
          style={{ left: share(pick.from), width: `calc(${share(pick.to)} - ${share(pick.from)})` }}
        />
      ) : null}
      {playhead !== undefined ? (
        <div className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white/80" style={{ left: `${playhead * 100}%` }} />
      ) : null}
      {pick && !dragging ? <SpanPanel anchor={picked} card={above === "card"} editor={editor} /> : null}
    </div>
  );
}

const W = 264;

// The panel over the pick: a DialKit group, in a floating card.
function SpanPanel({ anchor, card, editor }: { anchor: RefObject<HTMLDivElement | null>; card: boolean; editor: SoundEditor }) {
  const [box, setBox] = useState<{ left: number; bottom: number } | null>(null);
  const [draft, setDraft] = useState<number | null>(null);
  const { pick } = editor;

  // Over the pick, kept inside the window; follows it as the timeline
  // scrolls or the window resizes.
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const mid = Math.min(Math.max(r.left + r.width / 2, r.left), r.right);
      const left = Math.min(Math.max(16, mid - W / 2), window.innerWidth - W - 16);
      // Over the whole card (the motion timeline is short), so the track
      // and the other lane stay in view.
      const top = card ? Math.min(r.top, anchor.current?.closest("section")?.getBoundingClientRect().top ?? r.top) : r.top;
      setBox({ left, bottom: window.innerHeight - top + 8 });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, card, pick?.from, pick?.to, pick?.stem]);

  // Escape lets go of the pick before anything else in the studio.
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      editor.setPick(null);
    };
    window.addEventListener("keydown", keys, true);
    return () => window.removeEventListener("keydown", keys, true);
  }, [editor]);

  if (!box || typeof document === "undefined") return null;
  const gain = draft ?? editor.level.gain;
  return createPortal(
    <section
      aria-label={`Sound, ${editor.label}`}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(CARD, "fixed z-50 flex animate-in flex-col gap-1.5 p-2 fade-in-0 zoom-in-95 duration-150")}
      style={{ left: box.left, bottom: box.bottom, width: W }}
    >
      <header className="flex h-7 items-center gap-1 ps-1.5">
        <h2 className="me-auto truncate font-medium text-[12px] text-white/85">{editor.label}</h2>
        <button type="button" className={cn(ICON_BUTTON, "size-6 [&_svg]:size-3.5")} onClick={() => editor.setPick(null)} aria-label="Close">
          <MultipleCrossCancelIcon aria-hidden="true" />
        </button>
      </header>
      <DialSlider
        label="Volume"
        value={gain}
        min={GAIN_MIN}
        max={GAIN_MAX}
        step={0.5}
        disabled={editor.level.mute}
        format={dbText}
        onChange={setDraft}
        onCommit={(v) => {
          setDraft(null);
          if (Math.abs(v - editor.level.gain) >= 0.05) editor.setVolume(v);
        }}
      />
      <DialToggle label="Mute" checked={editor.level.mute} onChange={editor.setMute} />
      <DialButton disabled={!editor.edited} onClick={editor.reset}>
        Reset
      </DialButton>
      <div className="my-0.5 h-px bg-white/[0.06]" />
      <DialButton
        onClick={() => {
          editor.ask();
          editor.setPick(null);
        }}
      >
        Change with Claude
      </DialButton>
      <DialButton
        onClick={() => {
          editor.tryAnother();
          editor.setPick(null);
        }}
      >
        <RefreshIcon aria-hidden="true" />
        Try another
      </DialButton>
      {editor.error ? (
        <p className="px-1 text-[11.5px] text-[#ff9592] leading-relaxed" aria-live="polite">
          {editor.error}
        </p>
      ) : editor.mixing ? (
        <p className="px-1 text-[11.5px]" aria-live="polite">
          <span className="studio-shimmer">Mixing the sound</span>
        </p>
      ) : null}
    </section>,
    document.body,
  );
}
