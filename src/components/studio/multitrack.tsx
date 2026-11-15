"use client";

import {
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  EyeOffIcon,
  EyeOnIcon,
  LayerThreeIcon,
  MinusIcon,
  MicOnIcon,
  MusicBeamNoteIcon,
  NotificationBellOnIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  PlusIcon,
  RefreshIcon,
  SpeakerOnIcon,
  VideoCallIcon,
} from "@/components/icons";
import type { Mark } from "@/lib/studio/contract";
import type { Clip, Edit, Graphic, GraphicInfo, Media, Track } from "@/lib/studio/edit";
import { cn } from "@/lib/utils";
import { type Clock, formatTime, useClock } from "./clock";
import {
  addGraphic,
  addMedia,
  captionLines,
  duplicate,
  endOf,
  type Item,
  lengthOf,
  MIN_LENGTH,
  remove,
  split,
  updateTrack,
} from "./edit-ops";
import { CARD, Hint, ICON_BUTTON, PANEL_MOTION, PILL_BUTTON } from "./panel";
import { type SoundLaneData, SoundLine, SoundWave, showLane, showStems, stemLanes } from "./sound-lane";
import { StemLane, stemLabel } from "./sound-stems";
import type { EditState } from "./use-edit";
import { mediaUrl } from "./video-api";

// The timeline of a video film: tracks drawn bottom to top as the film
// stacks them (footage underneath, graphics over it, captions on top),
// clips showing their frames and sound. Drag to move, pull an edge to trim,
// S splits at the playhead. Every change can be undone with ⌘Z.

export const CAPTIONS = "captions"; // the captions lane's id in the selection

const HEADER_W = 152;
const RULER_H = 22;
const LANE_H: Record<Track["kind"] | "captions", number> = { video: 56, graphics: 32, audio: 40, captions: 26 };
const SOUND_H = 32;
const STEM_H = 28; // each sound lane: Score, Effects
const SNAP_PX = 8;
const EDGE_PX = 7;
const MIN_PPS = 2;
const MAX_PPS = 600;

const ICONS = { video: VideoCallIcon, graphics: LayerThreeIcon, audio: MusicBeamNoteIcon } as const;

// Ruler steps, in seconds; the first that gives labels room wins.
const STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

const short = (t: number, step: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return step < 1 ? `${m}:${s.toFixed(2).padStart(5, "0")}` : `${m}:${String(Math.round(s)).padStart(2, "0")}`;
};

// What a drag is doing, from where it started.
type Drag = {
  mode: "move" | "start" | "end";
  id: string;
  x: number;
  y: number;
  began: boolean;
  // Every dragged item as it was when the drag began, with its track.
  from: Map<string, { item: Item; track: string }>;
};

// Loads a strip of frames once to learn how many frames it holds.
const strips = new Map<string, Promise<{ frames: number; ratio: number }>>();
function useStrip(url: string | null) {
  const [info, setInfo] = useState<{ url: string; frames: number; ratio: number } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    let job = strips.get(url);
    if (!job) {
      job = new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ frames: 0, ratio: img.naturalWidth / Math.max(1, img.naturalHeight) });
        img.onerror = reject;
        img.src = url;
      });
      strips.set(url, job);
    }
    job.then((r) => live && setInfo({ url, ...r })).catch(() => strips.delete(url));
    return () => {
      live = false;
    };
  }, [url]);
  return info?.url === url ? info : null;
}

export function Multitrack({
  id,
  clock,
  ed,
  marks,
  hidden,
  height,
  onHeight,
  onUndo,
  onRedo,
  sound,
  className,
  style,
}: {
  id: string;
  clock: Clock;
  ed: EditState;
  marks: Mark[];
  hidden: boolean;
  height: number;
  onHeight: (height: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  sound?: SoundLaneData; // the sound design, under the tracks once the film has one
  className?: string;
  style?: React.CSSProperties;
}) {
  const t = useClock(clock, (s) => s.t);
  const duration = useClock(clock, (s) => s.duration);
  const playing = useClock(clock, (s) => s.playing);
  const loop = useClock(clock, (s) => s.loop);
  const { edit, selected, setSelected, change, begin, mediaById, peaks, graphics } = ed;

  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState(800);
  const [pps, setPps] = useState(40);
  const [fitted, setFitted] = useState(true);
  const [guide, setGuide] = useState<number | null>(null);
  const drag = useRef<Drag | null>(null);

  // Lanes shown top to bottom: captions, then the tracks in reverse (the
  // edit lists them bottom first).
  const tracks = useMemo(() => (edit ? [...edit.tracks].reverse() : []), [edit]);
  const graphicInfo = useMemo(() => new Map(graphics.map((g) => [g.name, g])), [graphics]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setView(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fits the whole film until you zoom yourself; zoomed in, there's a little
  // room after the end to drop things into.
  const fitPps = Math.min(MAX_PPS, Math.max(MIN_PPS, (view - 32) / Math.max(1, duration)));
  const scale = fitted ? fitPps : pps;
  const width = fitted ? view : Math.max(view, (duration + 4) * scale);

  const fit = () => {
    setFitted(true);
    if (scroller.current) scroller.current.scrollLeft = 0;
  };

  const zoomTo = useCallback(
    (next: number, anchorX?: number) => {
      const el = scroller.current;
      const clamped = Math.min(MAX_PPS, Math.max(MIN_PPS, next));
      if (!el) return;
      const ax = anchorX ?? el.clientWidth / 2;
      const time = (el.scrollLeft + ax) / scale;
      setFitted(false);
      setPps(clamped);
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, time * clamped - ax);
      });
    },
    [scale],
  );

  // ⌘ scroll or a trackpad pinch zooms around the pointer.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomTo(scale * Math.exp(-e.deltaY * 0.01), e.clientX - r.left);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [scale, zoomTo]);

  // While playing, keep the playhead in view.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing) return;
    const x = t * scale;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(0, x - 40);
  }, [t, playing, scale]);

  const timeAt = (clientX: number) => {
    const el = scroller.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.max(0, (clientX - r.left + el.scrollLeft) / scale);
  };

  // ─── Snapping ──────────────────────────────────────────────────────────

  const snapTargets = useCallback(
    (skip: Set<string>) => {
      const out = [0, clock.get().t, ...marks.map((m) => m.t)];
      for (const track of edit?.tracks ?? []) {
        for (const item of track.items) {
          if (skip.has(item.id)) continue;
          out.push(item.start, endOf(item));
        }
      }
      return out;
    },
    [edit, marks, clock],
  );

  // The nearest target to any of these times, within a few pixels.
  const snap = (times: number[], targets: number[]) => {
    let best: { shift: number; at: number } | null = null;
    for (const time of times) {
      for (const target of targets) {
        const d = target - time;
        if (Math.abs(d) * scale <= SNAP_PX && (!best || Math.abs(d) < Math.abs(best.shift))) best = { shift: d, at: target };
      }
    }
    return best;
  };

  // ─── Dragging items ────────────────────────────────────────────────────

  const down = (e: ReactPointerEvent, item: Item, track: Track, mode: Drag["mode"]) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (!edit) return;
    // One thing picked at a time: a clip lets go of a stretch of sound.
    sound?.editor?.setPick(null);
    let ids = new Set(selected);
    if (e.shiftKey) {
      if (ids.has(item.id)) ids.delete(item.id);
      else ids.add(item.id);
      ids.delete(CAPTIONS);
      setSelected(ids);
      return;
    }
    if (!ids.has(item.id) || mode !== "move") ids = new Set([item.id]);
    setSelected(ids);
    const from = new Map<string, { item: Item; track: string }>();
    for (const tr of edit.tracks) for (const it of tr.items) if (ids.has(it.id)) from.set(it.id, { item: it, track: tr.id });
    drag.current = { mode, id: item.id, x: e.clientX, y: e.clientY, began: false, from };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    void track;
  };

  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || !edit) return;
    if (!d.began) {
      if (Math.abs(e.clientX - d.x) < 3 && Math.abs(e.clientY - d.y) < 3) return;
      d.began = true;
      clock.pause();
      const many = d.from.size > 1;
      begin(d.mode === "move" ? (many ? `Moved ${d.from.size} items` : "Moved a clip") : "Trimmed a clip");
    }
    const ds = (e.clientX - d.x) / scale;
    const lead = d.from.get(d.id);
    if (!lead) return;
    const targets = snapTargets(new Set(d.from.keys()));
    const item = lead.item;

    if (d.mode === "move") {
      let shift = ds;
      const s = snap([item.start + ds, endOf(item) + ds], targets);
      if (s) shift += s.shift;
      setGuide(s ? s.at : null);
      // One item can change track (to another of the same kind).
      let toTrack = lead.track;
      if (d.from.size === 1) {
        const lane = document
          .elementsFromPoint(e.clientX, e.clientY)
          .map((el) => (el as HTMLElement).dataset?.lane)
          .find(Boolean);
        const from = edit.tracks.find((tr) => tr.id === lead.track);
        const to = edit.tracks.find((tr) => tr.id === lane);
        if (from && to && to.kind === from.kind) toTrack = to.id;
      }
      // Never earlier than the start.
      const earliest = Math.min(...[...d.from.values()].map((v) => v.item.start));
      shift = Math.max(shift, -earliest);
      // Lift every dragged item off its lane, then set each down at its new
      // time: the lead on the lane under the pointer, the rest where they were.
      change(
        (cur) => ({
          ...cur,
          tracks: cur.tracks.map((tr) => {
            const kept = tr.items.filter((i) => !d.from.has(i.id));
            const landing = [...d.from.values()]
              .filter((v) => (v.item.id === item.id ? toTrack : v.track) === tr.id)
              .map((v) => {
                const live = cur.tracks.flatMap((x) => x.items).find((i) => i.id === v.item.id) ?? v.item;
                return { ...live, start: Math.max(0, v.item.start + shift) };
              });
            return { ...tr, items: [...kept, ...landing].sort((a, b) => a.start - b.start) };
          }),
        }),
        { record: false },
      );
      return;
    }

    // Trimming one edge.
    const media = item.type === "clip" ? mediaById.get(item.media) : undefined;
    const speed = item.type === "clip" ? (item.speed ?? 1) : 1;
    const sourceLength = media && media.kind !== "image" ? (media.duration ?? Infinity) : Infinity;
    if (d.mode === "start") {
      let start = item.start + ds;
      const s = snap([start], targets);
      if (s) start = s.at;
      setGuide(s ? s.at : null);
      const end = endOf(item);
      start = Math.min(start, end - MIN_LENGTH);
      if (item.type === "clip") {
        // The in point can't go before the start of the source.
        start = Math.max(start, item.start - item.from / speed);
        const from = item.from + (start - item.start) * speed;
        change((cur) => mapOne(cur, item.id, { start, from }), { record: false });
      } else {
        start = Math.max(0, start);
        change((cur) => mapOne(cur, item.id, { start, duration: end - start }), { record: false });
      }
    } else {
      let end = endOf(item) + ds;
      const s = snap([end], targets);
      if (s) end = s.at;
      setGuide(s ? s.at : null);
      end = Math.max(end, item.start + MIN_LENGTH);
      if (item.type === "clip") {
        // The out point can't go past the end of the source.
        const to = Math.min(sourceLength, item.from + (end - item.start) * speed);
        change((cur) => mapOne(cur, item.id, { to }), { record: false });
      } else {
        change((cur) => mapOne(cur, item.id, { duration: end - item.start }), { record: false });
      }
    }
  };

  const up = () => {
    drag.current = null;
    setGuide(null);
  };

  // ─── The playhead and empty space ──────────────────────────────────────

  const scrubbing = useRef(false);
  const scrubDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubbing.current = true;
    clock.pause();
    const time = timeAt(e.clientX);
    const s = snap([time], snapTargets(new Set()).filter((x) => x !== clock.get().t));
    clock.seek(s ? s.at : time);
  };
  const scrubMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!scrubbing.current) return;
    const time = timeAt(e.clientX);
    const s = snap([time], snapTargets(new Set()).filter((x) => x !== clock.get().t));
    clock.seek(s ? s.at : time);
  };
  const scrubUp = () => {
    scrubbing.current = false;
  };

  // A click on empty lane: let go of the selection and move the playhead.
  const laneDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    setSelected(new Set());
    sound?.editor?.setPick(null);
    scrubDown(e);
  };

  // ─── Dropping from the bin ─────────────────────────────────────────────

  const [dropLane, setDropLane] = useState<string | null>(null);
  const over = (e: DragEvent<HTMLDivElement>, lane: string) => {
    const types = e.dataTransfer.types;
    if (!types.includes("application/x-studio-media") && !types.includes("application/x-studio-graphic")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropLane(lane);
  };
  const drop = (e: DragEvent<HTMLDivElement>, lane: string) => {
    setDropLane(null);
    const at = timeAt(e.clientX);
    const mid = e.dataTransfer.getData("application/x-studio-media");
    const gname = e.dataTransfer.getData("application/x-studio-graphic");
    if (!mid && !gname) return;
    e.preventDefault();
    if (mid) {
      const m = mediaById.get(mid);
      if (!m || m.status !== "ready") return;
      let made = "";
      change(
        (cur) => {
          const r = addMedia(cur, m, at, lane);
          made = r.id;
          return r.edit;
        },
        { label: `Added ${m.name}` },
      );
      if (made) setSelected(new Set([made]));
    } else {
      const g = graphicInfo.get(gname);
      if (!g) return;
      let made = "";
      change(
        (cur) => {
          const r = addGraphic(cur, { name: g.name, duration: g.duration, values: defaults(g) }, at, lane);
          made = r.id;
          return r.edit;
        },
        { label: `Added ${g.label.toLowerCase()}` },
      );
      if (made) setSelected(new Set([made]));
    }
  };

  // ─── Keys ──────────────────────────────────────────────────────────────

  const doSplit = useCallback(() => {
    if (!edit) return;
    const now = clock.get().t;
    const spanning = edit.tracks.flatMap((tr) => tr.items).filter((i) => now > i.start && now < endOf(i));
    const chosen = spanning.filter((i) => selected.has(i.id));
    const ids = new Set((chosen.length ? chosen : spanning).map((i) => i.id));
    if (!ids.size) return;
    let made: string[] = [];
    change(
      (cur) => {
        const r = split(cur, ids, now);
        made = r.made;
        return r.edit;
      },
      { label: "Split" },
    );
    if (chosen.length) setSelected(new Set(made));
  }, [edit, clock, selected, change, setSelected]);

  useEffect(() => {
    if (hidden) return;
    const keys = (e: KeyboardEvent) => {
      const el = e.target;
      if (el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const items = [...selected].filter((s) => s !== CAPTIONS);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
        if (!items.length) return;
        e.preventDefault();
        let made: string[] = [];
        change(
          (cur) => {
            const r = duplicate(cur, new Set(items));
            made = r.made;
            return r.edit;
          },
          { label: items.length > 1 ? `Duplicated ${items.length} items` : "Duplicated an item" },
        );
        setSelected(new Set(made));
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        doSplit();
      } else if (e.key === "Backspace" || e.key === "Delete") {
        if (!items.length) return;
        e.preventDefault();
        const ripple = e.shiftKey;
        change((cur) => remove(cur, new Set(items), ripple), {
          label: ripple ? "Deleted and closed the gap" : items.length > 1 ? `Deleted ${items.length} items` : "Deleted an item",
        });
        setSelected(new Set());
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [hidden, selected, change, setSelected, doSplit]);

  // ─── Resizing the panel ────────────────────────────────────────────────

  const resize = useRef<{ y: number; h: number } | null>(null);

  // ─── Drawing ───────────────────────────────────────────────────────────

  const step = STEPS.find((s) => s * scale >= 72) ?? 600;
  const ticks: number[] = [];
  for (let x = 0; x <= width / scale; x += step) ticks.push(x);

  const captionWords = edit?.captions.words;
  const lines = useMemo(() => captionLines(captionWords ?? []), [captionWords]);
  const captionsOn = edit?.captions.on ?? false;

  return (
    <section
      aria-label="Timeline"
      inert={hidden}
      className={cn(
        CARD,
        PANEL_MOTION,
        "pointer-events-auto absolute flex flex-col overflow-hidden",
        hidden && "pointer-events-none translate-y-2 opacity-0",
        className,
      )}
      style={{ ...style, height }}
    >
      {/* Pull the top edge to make the timeline taller or shorter. */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Timeline height"
        aria-valuenow={height}
        tabIndex={0}
        className="absolute inset-x-0 top-0 z-20 h-1.5 cursor-ns-resize outline-none hover:bg-white/10 focus-visible:bg-white/20"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          resize.current = { y: e.clientY, h: height };
        }}
        onPointerMove={(e) => {
          if (resize.current) onHeight(resize.current.h + resize.current.y - e.clientY);
        }}
        onPointerUp={() => {
          resize.current = null;
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") onHeight(height + 24);
          if (e.key === "ArrowDown") onHeight(height - 24);
        }}
      />

      <header className="flex h-12 shrink-0 items-center gap-1.5 px-2">
        <Hint label={playing ? "Pause" : "Play"} keys={["Space"]}>
          <button
            type="button"
            className={cn(ICON_BUTTON, "size-9 rounded-[10px] text-white/85 [&_svg]:size-5")}
            onClick={() => clock.toggle()}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <PauseCircleIcon aria-hidden="true" /> : <PlayCircleIcon aria-hidden="true" />}
          </button>
        </Hint>
        <p className="w-[124px] shrink-0 text-[11.5px] tabular-nums">
          <span className="text-white/90">{formatTime(t)}</span>
          <span className="text-white/35"> / {formatTime(duration)}</span>
        </p>
        <Hint label="Split at the playhead" keys={["S"]}>
          <button type="button" onClick={doSplit} className={cn(PILL_BUTTON, "h-7 text-white/70 hover:bg-white/[0.08] hover:text-white")}>
            Split
          </button>
        </Hint>
        <Hint label="Undo" keys={["⌘", "Z"]}>
          <button
            type="button"
            onClick={onUndo}
            className={cn(PILL_BUTTON, "h-7 text-white/70 hover:bg-white/[0.08] hover:text-white")}
          >
            Undo
          </button>
        </Hint>
        <Hint label="Redo" keys={["⇧", "⌘", "Z"]}>
          <button
            type="button"
            onClick={onRedo}
            className={cn(PILL_BUTTON, "h-7 text-white/70 hover:bg-white/[0.08] hover:text-white")}
          >
            Redo
          </button>
        </Hint>
        <SaveNote state={ed.save} />
        <div className="ms-auto flex items-center gap-0.5">
          <Hint label="Zoom out" keys={["⌘", "scroll"]}>
            <button type="button" className={ICON_BUTTON} onClick={() => zoomTo(scale / 1.6)} aria-label="Zoom out">
              <MinusIcon aria-hidden="true" />
            </button>
          </Hint>
          <button
            type="button"
            onClick={fit}
            aria-pressed={fitted}
            className={cn(PILL_BUTTON, "h-7 px-2.5", fitted ? "text-white/90" : "text-white/55 hover:bg-white/[0.08] hover:text-white")}
          >
            Fit
          </button>
          <Hint label="Zoom in" keys={["⌘", "scroll"]}>
            <button type="button" className={ICON_BUTTON} onClick={() => zoomTo(scale * 1.6)} aria-label="Zoom in">
              <PlusIcon aria-hidden="true" />
            </button>
          </Hint>
          <Hint label={loop ? "Play once" : "Play on repeat"} keys={["L"]}>
            <button
              type="button"
              className={cn(ICON_BUTTON, "ms-1", loop && "text-white")}
              onClick={() => clock.setLoop(!loop)}
              aria-pressed={loop}
              aria-label="Play on repeat"
            >
              <RefreshIcon aria-hidden="true" className={cn(!loop && "opacity-40")} />
            </button>
          </Hint>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* Track names, beside their lanes. */}
        <div className="sticky left-0 z-10 shrink-0" style={{ width: HEADER_W }}>
          <div style={{ height: RULER_H }} />
          <LaneHead
            name="Captions"
            height={LANE_H.captions}
            selected={selected.has(CAPTIONS)}
            onSelect={() => setSelected(new Set([CAPTIONS]))}
            dim={!captionsOn}
          />
          {tracks.map((track) => {
            const Icon = ICONS[track.kind];
            return (
              <div
                key={track.id}
                className={cn("flex items-center gap-1 border-white/[0.05] border-t ps-3 pe-1", track.hidden && "opacity-50")}
                style={{ height: LANE_H[track.kind] }}
              >
                <Icon aria-hidden="true" className="size-3.5 shrink-0 text-white/40" />
                <span className="me-auto truncate text-[11.5px] text-white/70">{track.name}</span>
                {track.kind !== "graphics" ? (
                  <Hint label={track.muted ? "Unmute" : "Mute"}>
                    <button
                      type="button"
                      className={cn(ICON_BUTTON, "size-6 [&_svg]:size-3.5", track.muted && "text-white/25")}
                      aria-pressed={!track.muted}
                      aria-label={`Sound on ${track.name}`}
                      onClick={() =>
                        change((cur) => updateTrack(cur, track.id, { muted: !track.muted }), {
                          label: track.muted ? `Sound on for ${track.name}` : `Sound off for ${track.name}`,
                        })
                      }
                    >
                      <SpeakerOnIcon aria-hidden="true" />
                    </button>
                  </Hint>
                ) : null}
                {track.kind !== "audio" ? (
                  <Hint label={track.hidden ? "Show track" : "Hide track"}>
                    <button
                      type="button"
                      className={cn(ICON_BUTTON, "size-6 [&_svg]:size-3.5", track.hidden && "text-white/25")}
                      aria-pressed={!track.hidden}
                      aria-label={`Show ${track.name}`}
                      onClick={() =>
                        change((cur) => updateTrack(cur, track.id, { hidden: !track.hidden }), {
                          label: track.hidden ? `Showed ${track.name}` : `Hid ${track.name}`,
                        })
                      }
                    >
                      {track.hidden ? <EyeOffIcon aria-hidden="true" /> : <EyeOnIcon aria-hidden="true" />}
                    </button>
                  </Hint>
                ) : null}
              </div>
            );
          })}
          {showStems(sound) ? (
            stemLanes(sound).map((stem) => {
              const Icon = stem === "music" ? MusicBeamNoteIcon : stem === "voice" ? MicOnIcon : NotificationBellOnIcon;
              return (
                <div
                  key={stem}
                  className={cn("flex items-center gap-1.5 border-white/[0.05] border-t ps-3 pe-1", !sound.on && "opacity-50")}
                  style={{ height: STEM_H }}
                >
                  <Icon aria-hidden="true" className="size-3.5 shrink-0 text-white/40" />
                  <span className="me-auto truncate text-[11.5px] text-white/70">{stemLabel(stem, true)}</span>
                  {!sound.on ? <span className="pe-2 text-[11px] text-white/30">Off</span> : null}
                </div>
              );
            })
          ) : showLane(sound) ? (
            <div
              className={cn("flex items-center gap-1.5 border-white/[0.05] border-t ps-3 pe-1", !sound?.on && "opacity-50")}
              style={{ height: SOUND_H }}
            >
              <MusicBeamNoteIcon aria-hidden="true" className="size-3.5 shrink-0 text-white/40" />
              <span className="me-auto truncate text-[11.5px] text-white/70">Sound design</span>
              {!sound?.on ? <span className="pe-2 text-[11px] text-white/30">Off</span> : null}
            </div>
          ) : null}
        </div>

        {/* The lanes, scrolling sideways. As tall as their tracks, so when
            the timeline is short they scroll up with the track names
            instead of being cut off at the bottom. */}
        <div
          ref={scroller}
          className="relative h-max min-h-full min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        >
          <div className="relative" style={{ width }}>
            {/* Ruler */}
            <div
              className="sticky top-0 z-10 cursor-ew-resize select-none bg-float"
              style={{ height: RULER_H }}
              onPointerDown={scrubDown}
              onPointerMove={scrubMove}
              onPointerUp={scrubUp}
            >
              {ticks.map((x) => (
                <span
                  key={x}
                  className="pointer-events-none absolute top-0 h-full border-white/10 border-l ps-1 pt-1 text-[9.5px] text-white/35 tabular-nums"
                  style={{ left: x * scale }}
                >
                  {short(x, step)}
                </span>
              ))}
              {marks.map((m) => (
                <span
                  key={`${m.t}-${m.label}`}
                  className="pointer-events-none absolute bottom-0 size-1.5 -translate-x-1/2 rotate-45 bg-white/40"
                  style={{ left: m.t * scale }}
                  title={m.label}
                />
              ))}
            </div>

            {/* Captions lane */}
            <div
              className={cn("relative border-white/[0.05] border-t", !captionsOn && "opacity-45")}
              style={{ height: LANE_H.captions }}
              onPointerDown={(e) => {
                if (e.target !== e.currentTarget) return;
                setSelected(new Set([CAPTIONS]));
              }}
            >
              {lines.map((line) => (
                <button
                  key={`${line.first}-${line.start}`}
                  type="button"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSelected(new Set([CAPTIONS]));
                  }}
                  className={cn(
                    "absolute top-1 bottom-1 cursor-pointer truncate rounded-[5px] px-1.5 text-left text-[10.5px] outline-none",
                    selected.has(CAPTIONS) ? "bg-white/[0.18] text-white" : "bg-white/[0.08] text-white/65 hover:bg-white/[0.12]",
                  )}
                  style={{ left: line.start * scale, width: Math.max(4, (line.end - line.start) * scale - 1) }}
                  aria-label={`Caption: ${line.text}`}
                >
                  {line.text}
                </button>
              ))}
            </div>

            {/* Tracks */}
            {tracks.map((track) => (
              // biome-ignore lint/a11y/noStaticElementInteractions: a lane takes clicks and drops; its clips are buttons
              <div
                key={track.id}
                data-lane={track.id}
                className={cn(
                  "relative border-white/[0.05] border-t transition-colors",
                  dropLane === track.id && "bg-white/[0.04]",
                  track.hidden && "opacity-45",
                )}
                style={{ height: LANE_H[track.kind] }}
                onPointerDown={laneDown}
                onDragOver={(e) => over(e, track.id)}
                onDragLeave={() => setDropLane((l) => (l === track.id ? null : l))}
                onDrop={(e) => drop(e, track.id)}
              >
                {track.items.map((item) => (
                  <ItemBlock
                    key={item.id}
                    filmId={id}
                    item={item}
                    track={track}
                    index={clipNumber(edit, item)}
                    scale={scale}
                    selected={selected.has(item.id)}
                    media={item.type === "clip" ? mediaById.get(item.media) : undefined}
                    peaks={item.type === "clip" ? peaks[item.media] : undefined}
                    info={item.type === "graphic" ? graphicInfo.get(item.graphic) : undefined}
                    onDown={(e, mode) => down(e, item, track, mode)}
                  />
                ))}
              </div>
            ))}

            {/* Sound design: the score's waveform; Claude writes it, so it
                isn't cut or moved here. */}
            {showStems(sound) ? (
              stemLanes(sound).map((stem) => (
                <div
                  key={stem}
                  className="border-white/[0.05] border-t"
                  // Picking sound lets go of any clips, so Delete or S can't
                  // change the cut while the sound panel is open.
                  onPointerDownCapture={(e) => e.button === 0 && setSelected(new Set())}
                >
                  <StemLane
                    stem={stem}
                    peaks={sound.stems[stem]}
                    empty={Boolean(sound.present && !sound.present.includes(stem))}
                    duration={duration}
                    width={duration * scale}
                    height={STEM_H - 1}
                    editor={sound.editor}
                    dim={!sound.on || sound.muted}
                    snaps={() => [clock.get().t, ...marks.map((m) => m.t)]}
                    video
                  />
                </div>
              ))
            ) : sound && showLane(sound) ? (
              <div
                className={cn(
                  "relative flex items-center border-white/[0.05] border-t",
                  sound.status.state !== "ready" || !sound.peaks || sound.error ? "px-2" : null,
                )}
                style={{ height: SOUND_H }}
                onPointerDown={scrubDown}
                onPointerMove={scrubMove}
                onPointerUp={scrubUp}
              >
                {sound.status.state === "ready" && sound.peaks && !sound.error ? (
                  <SoundWave
                    peaks={sound.peaks}
                    duration={duration}
                    width={duration * scale}
                    height={SOUND_H}
                    dim={!sound.on || sound.muted}
                  />
                ) : (
                  <div className="sticky left-2 min-w-0" style={{ maxWidth: view - 16 }}>
                    <SoundLine data={sound} />
                  </div>
                )}
              </div>
            ) : null}

            {edit && !edit.tracks.some((tr) => tr.items.length) ? (
              <p className="pointer-events-none absolute start-4 top-[84px] text-[12px] text-white/40">
                Drag footage here from Media.
              </p>
            ) : null}

            {/* Snap guide and playhead */}
            {guide !== null ? (
              <div className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-studio" style={{ left: guide * scale }} />
            ) : null}
            <div
              className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_2px_rgb(0_0_0_/_calc(0.3*var(--shade)))]"
              style={{ left: t * scale }}
            >
              <span className="absolute -top-px left-1/2 size-2.5 -translate-x-1/2 rotate-45 rounded-[2px] bg-white" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const mapOne = (edit: Edit, id: string, patch: Partial<Clip> | Partial<Graphic>): Edit => ({
  ...edit,
  tracks: edit.tracks.map((tr) => ({
    ...tr,
    items: tr.items.map((i) => (i.id === id ? ({ ...i, ...patch } as Item) : i)),
  })),
});

export const defaults = (g: GraphicInfo) => Object.fromEntries(g.params.map((p) => [p.key, p.value]));

// Clips are numbered 1, 2, 3 in the order they play, across footage tracks.
export function clipNumber(edit: Edit | null, item: Item) {
  if (!edit || item.type !== "clip") return 0;
  const clips = edit.tracks
    .filter((tr) => tr.kind === "video")
    .flatMap((tr) => tr.items)
    .filter((i) => i.type === "clip")
    .sort((a, b) => a.start - b.start);
  return clips.findIndex((c) => c.id === item.id) + 1;
}

function SaveNote({ state }: { state: EditState["save"] }) {
  const words = { saved: "Saved", saving: "Saving…", failed: "Not saved yet. Trying again" }[state];
  return (
    <span
      className={cn("ms-1 text-[11px] transition-colors", state === "failed" ? "text-danger" : "text-white/35")}
      aria-live="polite"
    >
      {words}
    </span>
  );
}

function LaneHead({
  name,
  height,
  selected,
  dim,
  onSelect,
}: {
  name: string;
  height: number;
  selected: boolean;
  dim: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full cursor-pointer items-center gap-1.5 border-white/[0.05] border-t ps-3 text-left text-[11.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        selected ? "text-white" : dim ? "text-white/40 hover:text-white/70" : "text-white/70 hover:text-white",
      )}
      style={{ height }}
    >
      <span className={cn("size-1.5 rounded-full", dim ? "bg-white/20" : "bg-white/60")} aria-hidden="true" />
      {name}
      {dim ? <span className="text-white/30">Off</span> : null}
    </button>
  );
}

// ─── One block on a lane ────────────────────────────────────────────────────

function ItemBlock({
  filmId,
  item,
  track,
  index,
  scale,
  selected,
  media,
  peaks,
  info,
  onDown,
}: {
  filmId: string;
  item: Item;
  track: Track;
  index: number;
  scale: number;
  selected: boolean;
  media?: Media;
  peaks?: number[];
  info?: GraphicInfo;
  onDown: (e: ReactPointerEvent, mode: Drag["mode"]) => void;
}) {
  const left = item.start * scale;
  const w = Math.max(3, lengthOf(item) * scale);
  const h = LANE_H[track.kind];
  const name =
    item.type === "graphic" ? (info?.label ?? item.graphic) : media ? `${index ? `${index}. ` : ""}${media.name}` : "Missing footage";

  return (
    <div
      className={cn(
        "group absolute top-0.5 bottom-0.5 overflow-hidden rounded-[7px] outline-none",
        item.type === "graphic" ? "bg-knob-hi" : track.kind === "audio" ? "bg-[#23302a]" : "bg-knob",
        selected ? "ring-2 ring-white ring-inset" : "ring-1 ring-white/10 ring-inset",
      )}
      style={{ left, width: w }}
    >
      {/* The body moves; the edges trim. */}
      <button
        type="button"
        aria-label={item.type === "graphic" ? name : `Clip ${index || ""} ${media?.name ?? ""}`.trim()}
        aria-pressed={selected}
        className="absolute inset-0 cursor-grab touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:cursor-grabbing"
        onPointerDown={(e) => onDown(e, "move")}
      >
        {item.type === "clip" && media && track.kind === "video" ? (
          <Frames filmId={filmId} clip={item} media={media} width={w} height={h - 4} scale={scale} />
        ) : null}
        {item.type === "clip" && peaks && media?.hasAudio ? (
          <Wave
            peaks={peaks}
            clip={item}
            width={w}
            height={track.kind === "audio" ? h - 8 : 14}
            className={track.kind === "audio" ? "top-1" : "bottom-0"}
          />
        ) : null}
        <span
          className={cn(
            "pointer-events-none absolute start-1.5 top-1 max-w-[calc(100%-12px)] truncate rounded-[4px] px-1 text-[10.5px] leading-4",
            track.kind === "video" ? "bg-black/55 text-white/85" : "text-white/80",
          )}
        >
          {name}
        </span>
        {item.type === "clip" && (item.speed ?? 1) !== 1 ? (
          <span className="pointer-events-none absolute end-1.5 top-1 rounded-[4px] bg-black/55 px-1 tabular-nums text-[10px] text-white/80">
            {(item.speed ?? 1).toFixed(2)}×
          </span>
        ) : null}
        {item.type === "clip" && item.fadeIn ? <Fade side="start" width={item.fadeIn * scale} /> : null}
        {item.type === "clip" && item.fadeOut ? <Fade side="end" width={item.fadeOut * scale} /> : null}
      </button>
      {w > 14 ? (
        <>
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 z-10 cursor-ew-resize touch-none rounded-s-[7px] bg-white/0 transition-colors group-hover:bg-white/25"
            style={{ width: EDGE_PX }}
            onPointerDown={(e) => onDown(e, "start")}
          />
          <span
            aria-hidden="true"
            className="absolute inset-y-0 right-0 z-10 cursor-ew-resize touch-none rounded-e-[7px] bg-white/0 transition-colors group-hover:bg-white/25"
            style={{ width: EDGE_PX }}
            onPointerDown={(e) => onDown(e, "end")}
          />
        </>
      ) : null}
    </div>
  );
}

// The clip's own frames, side by side, from the media's strip of frames.
function Frames({
  filmId,
  clip,
  media,
  width,
  height,
  scale,
}: {
  filmId: string;
  clip: Clip;
  media: Media;
  width: number;
  height: number;
  scale: number;
}) {
  const url = media.thumbs ? mediaUrl(filmId, media.id, media.thumbs) : null;
  const strip = useStrip(url);
  if (!url || !strip) return null;
  const aspect = media.width && media.height ? media.width / media.height : 16 / 9;
  const frames = Math.max(1, Math.round(strip.ratio / aspect));
  const every = media.thumbEvery ?? Math.max(0.001, (media.duration ?? 1) / frames);
  const tile = height * aspect;
  const count = Math.min(200, Math.ceil(width / tile));
  const speed = clip.speed ?? 1;
  return (
    <span className="pointer-events-none absolute inset-0 flex opacity-80">
      {Array.from({ length: count }, (_, k) => {
        const at = media.kind === "image" ? 0 : clip.from + ((k * tile) / scale) * speed;
        const frame = Math.min(frames - 1, Math.max(0, Math.round(at / every)));
        return (
          <span
            key={k}
            className="h-full shrink-0 bg-no-repeat"
            style={{
              width: tile,
              backgroundImage: `url(${url})`,
              backgroundSize: `${frames * 100}% 100%`,
              backgroundPosition: frames > 1 ? `${(frame / (frames - 1)) * 100}% 0` : "0 0",
            }}
          />
        );
      })}
    </span>
  );
}

// How loud the clip is, drawn as a filled wave.
function Wave({
  peaks,
  clip,
  width,
  height,
  className,
}: {
  peaks: number[];
  clip: Clip;
  width: number;
  height: number;
  className?: string;
}) {
  const per = 100; // peaks per second of source
  const columns = Math.max(1, Math.min(1200, Math.floor(width / 2)));
  const points: string[] = [];
  for (let c = 0; c < columns; c++) {
    // Each column covers its share of the source the clip plays.
    const a = clip.from + (c / columns) * (clip.to - clip.from);
    const b = clip.from + ((c + 1) / columns) * (clip.to - clip.from);
    let v = 0;
    for (let i = Math.floor(a * per); i < Math.ceil(b * per) && i < peaks.length; i++) v = Math.max(v, peaks[i] ?? 0);
    points.push(`${(c / columns) * width},${height - v * height}`);
  }
  return (
    <svg
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-x-0", className)}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      <polygon points={`0,${height} ${points.join(" ")} ${width},${height}`} style={{ fill: "rgb(var(--hi) / 0.28)" }} />
    </svg>
  );
}

function Fade({ side, width }: { side: "start" | "end"; width: number }) {
  return (
    <svg
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-y-0", side === "start" ? "left-0" : "right-0")}
      width={width}
      height="100%"
      viewBox="0 0 10 10"
      preserveAspectRatio="none"
    >
      <polygon points={side === "start" ? "0,0 10,0 0,10" : "0,0 10,0 10,10"} fill="rgba(0,0,0,0.45)" />
    </svg>
  );
}
