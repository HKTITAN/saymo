"use client";

import { type DragEvent, type PointerEvent, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MultipleCrossCancelIcon, RefreshIcon } from "@/components/icons";
import type { SoundStem } from "@/lib/studio/sound";
import { GAIN_MAX, GAIN_MIN } from "@/lib/studio/sound-mix";
import { DialButton, DialSlider, DialToggle } from "@/components/tool/dial";
import { PromptBox } from "./prompt-box";
import { cn } from "@/lib/utils";
import { CARD, DiscardAsk, ICON_BUTTON } from "./panel";
import { SoundWave } from "./sound-lane";
import { isAudioFile, useAttachments } from "./use-attachments";
import type { SoundEditor } from "./use-sound-edit";
import { useOutsideClose } from "./use-outside";

// The sound design as lanes, Music and Effects (and Voiceover on a film
// made from slides with a voice), each its own stem's waveform. On a video
// film the Music lane is called Score, as the person's own Music track is
// something else. Drag across a lane to pick a stretch of it (it snaps to the
// playhead and the film's moments); click to pick the whole lane, or the
// edit under the click. A small panel over the pick sets its volume or
// mutes it, puts it back, or hands just that stretch to Claude, with sound
// files attached as references ("make it feel like this"); dropping a
// sound on the panel does that straight away. Escape lets go.

export const STEM_LABEL: Record<SoundStem, string> = { music: "Music", effects: "Effects", voice: "Voiceover" };
export const stemLabel = (stem: SoundStem, video = false) => (video && stem === "music" ? "Score" : STEM_LABEL[stem]);

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
  snaps,
  playhead,
  above,
  video = false,
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
  snaps: () => number[]; // film times a pick snaps to
  playhead?: number; // 0..1, drawn on the lane
  above?: "lane" | "card"; // the panel sits over the lane, or over the card it's in
  video?: boolean; // a video film's: Music reads "Score"
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
      data-stem-lane=""
      role="group"
      aria-label={empty ? `${stemLabel(stem, video)}, none in this sound` : `${stemLabel(stem, video)}. Drag to pick part of it`}
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
                <span className="absolute top-0 right-1 text-[9.5px] text-white/60 tabular-nums leading-[14px]">
                  {s.mute ? "Muted" : dbText(s.gain)}
                </span>
              ) : null}
            </div>
          );
        })}
      {pick ? (
        <div
          ref={picked}
          className="pointer-events-none absolute inset-y-0 rounded-[3px] bg-studio/15 ring-1 ring-studio ring-inset"
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
const ASK_W = 320; // the panel widens as it turns into a prompt box

// The panel over the pick: a DialKit group, in a floating card.
function SpanPanel({ anchor, card, editor }: { anchor: RefObject<HTMLDivElement | null>; card: boolean; editor: SoundEditor }) {
  const [box, setBox] = useState<{ left: number; bottom: number } | null>(null);
  const [draft, setDraft] = useState<number | null>(null);
  // "Change with Claude" turns the panel into a prompt box, right here.
  const [asking, setAsking] = useState(false);
  const [words, setWords] = useState("");
  // Reference sounds (or pictures, notes) for Claude, kept while the panel
  // flips back and forth.
  const files = useAttachments(`/api/studio/films/${editor.filmId}/attachments`, { audio: true });
  const [over, setOver] = useState(false);
  const { pick } = editor;
  const width = asking ? ASK_W : W;

  // Over the pick, kept inside the window; follows it as the timeline
  // scrolls or the window resizes.
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const mid = Math.min(Math.max(r.left + r.width / 2, r.left), r.right);
      const left = Math.min(Math.max(16, mid - width / 2), window.innerWidth - width - 16);
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
  }, [anchor, card, pick?.from, pick?.to, pick?.stem, width]);

  // A press outside lets go of the pick too, except on the sound lanes,
  // which pick again. A typed prompt asks once before it's lost.
  const panel = useRef<HTMLElement>(null);
  const [discard, setDiscard] = useState(false);
  const typed = asking && (Boolean(words.trim()) || files.items.length > 0);
  if (discard && !asking) setDiscard(false);
  const outside = useOutsideClose(panel, () => (typed && !discard ? setDiscard(true) : editor.setPick(null)), {
    ignore: (target) => Boolean(target.closest("[data-stem-lane]")),
  });

  // Escape lets go of the pick before anything else in the studio.
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (asking && !discard)) return; // the prompt box handles its own Esc
      e.preventDefault();
      e.stopPropagation();
      if (discard) setDiscard(false);
      else editor.setPick(null);
    };
    window.addEventListener("keydown", keys, true);
    return () => window.removeEventListener("keydown", keys, true);
  }, [editor, asking, discard]);

  if (!box || typeof document === "undefined") return null;
  const gain = draft ?? editor.level.gain;
  const hasSound = files.items.some((f) => f.kind === "audio" && !f.error);

  const send = async () => {
    const attached = await files.flush();
    const fallback = attached.some((a) => a.kind === "audio")
      ? "Make this part sound more like the sound I attached."
      : attached.length
        ? "Have a look at what I attached."
        : "";
    const text = words.trim() || fallback;
    if (!text) return;
    editor.send(text, attached);
    files.clear();
    setWords("");
    setAsking(false);
    editor.setPick(null);
  };

  // A sound dropped on the panel: ask Claude with it attached. (Over the
  // prompt box, the box takes the drop itself.)
  const hasFiles = (e: DragEvent<HTMLElement>) => e.dataTransfer.types.includes("Files");
  const onDragOver = (e: DragEvent<HTMLElement>) => {
    if (!hasFiles(e) || asking) return;
    e.preventDefault();
    setOver(true);
  };
  const onDrop = (e: DragEvent<HTMLElement>) => {
    setOver(false);
    if (!hasFiles(e) || e.defaultPrevented) return;
    const dropped = [...e.dataTransfer.files];
    if (!dropped.some(isAudioFile)) return; // not a sound: the studio handles it as before
    e.preventDefault(); // claimed, so it isn't brought in as footage
    files.add(dropped);
    setAsking(true);
  };
  return createPortal(
    <section
      ref={panel}
      {...outside}
      aria-label={`Sound, ${editor.label}`}
      onPointerDown={(e) => e.stopPropagation()}
      onDragOver={onDragOver}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(false)}
      onDrop={onDrop}
      className={cn(
        CARD,
        "fixed z-50 flex animate-in flex-col gap-1.5 p-2 fade-in-0 zoom-in-95 duration-150 transition-[width,left] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
        over && "ring-1 ring-studio",
      )}
      style={{ left: box.left, bottom: box.bottom, width }}
    >
      {asking ? (
        <div key="ask" className="flex animate-in flex-col gap-1 fade-in-0 slide-in-from-bottom-1 duration-200">
          <header className="flex h-7 items-center gap-1 ps-1.5">
            <h2 className="me-auto truncate font-medium text-[12px] text-white/85">Ask Claude about this sound</h2>
            <button type="button" className={cn(ICON_BUTTON, "size-6 [&_svg]:size-3.5")} onClick={() => setAsking(false)} aria-label="Back to the sound controls">
              <MultipleCrossCancelIcon aria-hidden="true" />
            </button>
          </header>
          <PromptBox
            value={words}
            onChange={setWords}
            onSend={() => void send()}
            attachments={files}
            running={editor.running}
            queueing
            autoFocus
            onEscape={() => setAsking(false)}
            maxRows={4}
            placeholder={
              hasSound
                ? "What should it take from this sound?"
                : pick?.stem === "voice"
                  ? "Start this line half a second later"
                  : "Make the hit softer and a little later"
            }
            chip={editor.label}
            className="bg-white/[0.04]"
          />
        </div>
      ) : (
      <>
      <header className="flex h-7 items-center gap-1 ps-1.5">
        <h2 className="me-auto truncate font-medium text-[12px] text-white/85">{over ? "Drop a sound for Claude to follow" : editor.label}</h2>
        <button type="button" className={cn(ICON_BUTTON, "size-6 [&_svg]:size-3.5")} onClick={() => editor.setPick(null)} aria-label="Close this part of the sound">
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
      <DialButton onClick={() => setAsking(true)}>Change with Claude</DialButton>
      {/* A voiceover is recorded from the slides' notes, not written, so it
          has no other takes. */}
      {pick?.stem !== "voice" ? (
        <DialButton
          onClick={() => {
            editor.tryAnother();
            editor.setPick(null);
          }}
        >
          <RefreshIcon aria-hidden="true" />
          Try another take
        </DialButton>
      ) : null}
      {editor.error ? (
        <p className="px-1 text-[11.5px] text-danger leading-relaxed" aria-live="polite">
          {editor.error}
        </p>
      ) : editor.mixing ? (
        <p className="px-1 text-[11.5px]" aria-live="polite">
          <span className="studio-shimmer">Mixing the sound</span>
        </p>
      ) : null}
      </>
      )}
      {asking && discard ? <DiscardAsk what="this prompt" onKeep={() => setDiscard(false)} onDiscard={() => editor.setPick(null)} /> : null}
    </section>,
    document.body,
  );
}
