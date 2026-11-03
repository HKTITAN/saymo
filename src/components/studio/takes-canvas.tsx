"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { TextMorph } from "torph/react";
import { ArrowLeftIcon, MinusIcon, PlusIcon } from "@/components/icons";
import { Kbd } from "@/components/ui/kbd";
import type { Film } from "@/lib/studio/contract";
import { TAKE_COUNT, TAKE_WAYS, type Take } from "@/lib/studio/takes-shared";
import { cn } from "@/lib/utils";
import { stageUrl } from "./api";
import { MORE_LABEL, takeFilm } from "./takes";
import { CARD, DiscardAsk, Hint, ICON_BUTTON, PILL_BUTTON } from "./panel";
import { SlotMachine } from "./slot-machine";
import type { TakesState } from "./takes";
import { useOutsideClose } from "./use-outside";

// Three versions, full screen. The studio's panels step aside, a slot
// machine spins while the versions start, then a free canvas holds one card
// per version as it's made: drag to move around, pinch or ⌘ and scroll to
// zoom, Fit to see them all. A dashed card after the last one asks for one
// more version. Clicking a finished card keeps that version
// (the takes' own pick, so the film becomes it in one undoable step) and
// the studio comes back. Esc, or Back to the editor, returns without
// picking; the versions carry on and the canvas is one click away.

export type Away = "slots" | "canvas" | "leaving" | null;

const subscribeReduced = (cb: () => void) => {
  const m = window.matchMedia("(prefers-reduced-motion: reduce)");
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const useReducedMotion = () =>
  useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );

export function TakesAway({
  away,
  prompt,
  state,
  film,
  onCanvas,
  onBack,
}: {
  away: Exclude<Away, null>;
  prompt: string;
  state: TakesState;
  film: Film;
  onCanvas: () => void;
  onBack: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [asking, setAsking] = useState(false);
  const askingRef = useRef(asking);
  useEffect(() => {
    askingRef.current = asking;
  });

  // Keys belong to this view while it's open; the studio's own shortcuts
  // wait. Esc backs out of a question first, then out to the editor.
  useEffect(() => {
    if (away === "leaving") return;
    root.current?.focus({ preventScroll: true });
    const keys = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (askingRef.current) setAsking(false);
      else onBack();
    };
    window.addEventListener("keydown", keys, true);
    return () => window.removeEventListener("keydown", keys, true);
  }, [away, onBack]);

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label="Three versions"
      tabIndex={-1}
      className={cn(
        "fixed inset-0 z-40 overflow-hidden bg-[#0b0b0b] font-sans text-white outline-none transition-opacity duration-300 ease-out starting:opacity-0",
        away === "leaving" && "pointer-events-none opacity-0",
      )}
    >
      {away === "slots" ? (
        <SlotMachine prompt={prompt} ready={Boolean(state.takes)} reduced={reduced} onDone={onCanvas} onBack={onBack} />
      ) : (
        <TakesCanvas state={state} film={film} asking={asking} setAsking={setAsking} onBack={onBack} />
      )}
    </div>
  );
}

// ─── The canvas ─────────────────────────────────────────────────────────────

type View = { x: number; y: number; k: number };

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;
const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

// Each card: its name above, the preview, and a line under it.
const LONG_SIDE = 440;
const GAP = 56;
const HEAD = 34;
const FOOT = 58;
// Room the toolbar and the hint take at the top and bottom of the window.
const ROOM = { top: 88, bottom: 72, side: 56 };

function TakesCanvas({
  state,
  film,
  asking,
  setAsking,
  onBack,
}: {
  state: TakesState;
  film: Film;
  asking: boolean;
  setAsking: (a: boolean) => void;
  onBack: () => void;
}) {
  const { takes, busy, error } = state;
  const list = takes?.takes ?? [];
  const count = Math.max(TAKE_COUNT, list.length);
  // Room for the dashed "one more" card after the last version.
  const slots = count + (state.canMore ? 1 : 0);
  const wide = film.width >= film.height;
  const pw = wide ? LONG_SIDE : Math.round((LONG_SIDE * film.width) / film.height);
  const ph = wide ? Math.round((LONG_SIDE * film.height) / film.width) : LONG_SIDE;
  const bw = pw * slots + GAP * (slots - 1);
  const bh = HEAD + ph + FOOT;

  const fitTo = useCallback(
    (w: number, h: number): View => {
      const aw = Math.max(1, w - ROOM.side * 2);
      const ah = Math.max(1, h - ROOM.top - ROOM.bottom);
      const k = clampZoom(Math.min(aw / bw, ah / bh, 1.6));
      return { k, x: (w - bw * k) / 2, y: ROOM.top + (ah - bh * k) / 2 };
    },
    [bw, bh],
  );

  const vp = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(() => fitTo(window.innerWidth, window.innerHeight));
  // Fit and the zoom buttons glide; dragging and scrolling follow the hand.
  const [glide, setGlide] = useState(false);
  const [panning, setPanning] = useState(false);
  const moved = useRef(false);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  });

  const fit = useCallback(() => {
    const el = vp.current;
    if (!el) return;
    moved.current = false;
    setGlide(true);
    setView(fitTo(el.clientWidth, el.clientHeight));
  }, [fitTo]);

  const zoomBy = useCallback((factor: number, at?: { x: number; y: number }, smooth = false) => {
    const el = vp.current;
    if (!el) return;
    moved.current = true;
    setGlide(smooth);
    setView((v) => {
      const k = clampZoom(v.k * factor);
      const px = at?.x ?? el.clientWidth / 2;
      const py = at?.y ?? el.clientHeight / 2;
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });
  }, []);

  // One more card: glide to fit them all, so the new one is in view.
  const lastSlots = useRef(slots);
  useEffect(() => {
    if (slots === lastSlots.current) return;
    lastSlots.current = slots;
    fit();
  }, [slots, fit]);

  // A resized window refits, until you've moved the canvas yourself.
  useEffect(() => {
    const onResize = () => {
      if (!moved.current && vp.current) setView(fitTo(vp.current.clientWidth, vp.current.clientHeight));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fitTo]);

  // Scroll pans; pinch (which arrives as ⌃ and scroll) or ⌘ and scroll
  // zooms round the pointer. Not passive, so the page itself never zooms.
  useEffect(() => {
    const el = vp.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const step = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        zoomBy(Math.exp(-step * (e.ctrlKey && !e.metaKey ? 0.01 : 0.004)), { x: e.clientX - box.left, y: e.clientY - box.top });
        return;
      }
      moved.current = true;
      setGlide(false);
      setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [zoomBy]);

  // Dragging anywhere, cards included, moves the canvas. A press that
  // doesn't travel stays a click.
  const drag = useRef<{ id: number; sx: number; sy: number; vx: number; vy: number; on: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target instanceof Element && e.target.closest("[data-canvas-ui]"))) return;
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y, on: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.on) {
      if (Math.hypot(dx, dy) < 4) return;
      d.on = true;
      // From here the press belongs to the canvas, so letting go over a
      // card isn't a click on it.
      vp.current?.setPointerCapture(e.pointerId);
      setPanning(true);
      setGlide(false);
    }
    moved.current = true;
    setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const endDrag = (e: React.PointerEvent) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    setPanning(false);
  };

  // Keys: + and - zoom, Shift 1 fits.
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea")) return;
      if (e.key === "+" || e.key === "=") zoomBy(1.25, undefined, true);
      else if (e.key === "-" || e.key === "_") zoomBy(1 / 1.25, undefined, true);
      else if (e.shiftKey && e.code === "Digit1") fit();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [zoomBy, fit]);

  // The finished versions play together from one clock, each looping at
  // its own length.
  const frames = useRef<(HTMLIFrameElement | null)[]>([]);
  const lengths = useRef<number[]>([]);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const i = frames.current.findIndex((f) => f?.contentWindow === e.source);
      const m = e.data as { type?: string; duration?: number } | null;
      if (i >= 0 && m?.type === "studio:ready" && Number(m.duration) > 0) lengths.current[i] = Number(m.duration);
    };
    window.addEventListener("message", onMessage);
    let raf = 0;
    const from = performance.now();
    const tick = () => {
      const now = (performance.now() - from) / 1000;
      frames.current.forEach((f, i) => {
        const d = lengths.current[i] || film.duration;
        f?.contentWindow?.postMessage({ type: "studio:seek", t: d > 0 ? now % d : 0 }, window.location.origin);
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("message", onMessage);
      cancelAnimationFrame(raf);
    };
  }, [film.duration]);

  const [opening, setOpening] = useState<string | null>(null);
  const pick = async (take: Take) => {
    if (take.state !== "done" || busy) return;
    setOpening(take.id);
    await state.pick(take.id);
    setOpening(null);
  };

  const ask = useRef<HTMLDivElement>(null);
  const outside = useOutsideClose(ask, () => setAsking(false), { enabled: asking });

  const working = list.filter((t) => t.state === "working").length;
  const done = list.filter((t) => t.state === "done").length;
  // The count alone: how many are ready while they're made, then how many
  // there are.
  const status = !takes || working ? `${done} of ${count} ready` : done ? `${count} versions` : "None finished";

  // How it works shows for the first few seconds, then fades away.
  const [hint, setHint] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setHint(false), 5000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="absolute inset-0 animate-in fade-in-0 duration-300">
      {/* The canvas itself. */}
      <div
        ref={vp}
        className={cn("absolute inset-0 touch-none select-none", panning ? "cursor-grabbing" : "cursor-grab")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* A faint dot grid that moves with the canvas, so moving reads. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            backgroundImage: "radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1.2px)",
            backgroundSize: `${24 * view.k}px ${24 * view.k}px`,
            backgroundPosition: `${view.x}px ${view.y}px`,
          }}
        />
        <div
          className={cn(
            "absolute top-0 left-0 origin-top-left",
            glide && "transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
          )}
          style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.k})`, width: bw, height: bh }}
        >
          {Array.from({ length: count }, (_, i) => {
            const take = list.find((t) => t.n === i + 1);
            return (
              <TakeCard
                key={i}
                n={i + 1}
                take={take}
                film={film}
                left={i * (pw + GAP)}
                w={pw}
                h={ph}
                delay={i < TAKE_COUNT ? i * 80 : 0}
                busy={busy}
                opening={Boolean(take && opening === take.id)}
                frameRef={(el) => {
                  frames.current[i] = el;
                }}
                onPick={() => take && void pick(take)}
              />
            );
          })}
          {state.canMore ? <MoreCard left={count * (pw + GAP)} w={pw} h={ph} onMore={state.more} /> : null}
        </div>
      </div>

      {/* The toolbar. */}
      <div className="pointer-events-none absolute inset-x-4 top-4 flex items-start gap-3" data-canvas-ui>
        <div className={cn(CARD, "pointer-events-auto flex h-11 shrink-0 items-center p-1.5")}>
          <button type="button" onClick={onBack} className={cn(PILL_BUTTON, "text-white/75 hover:bg-white/[0.08] hover:text-white")}>
            <ArrowLeftIcon aria-hidden="true" />
            Back to the editor
            <Kbd className="ms-0.5">Esc</Kbd>
          </button>
        </div>

        {/* The count isn't shown (the cards say it); screen readers still hear it. */}
        <h2 aria-live="polite" className="sr-only">
          {status}
        </h2>

        <span className="flex-1" />

        <div className={cn(CARD, "pointer-events-auto flex h-11 shrink-0 items-center gap-0.5 p-1.5")}>
          <Hint label="Zoom out" keys={["-"]}>
            <button type="button" className={cn(ICON_BUTTON, "size-8")} onClick={() => zoomBy(1 / 1.25, undefined, true)} aria-label="Zoom out">
              <MinusIcon aria-hidden="true" />
            </button>
          </Hint>
          <Hint label="Actual size">
            <button
              type="button"
              className="h-8 w-12 cursor-pointer rounded-[8px] text-center text-[12px] text-white/70 tabular-nums outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => zoomBy(1 / view.k, undefined, true)}
              aria-label={`Zoom ${Math.round(view.k * 100)} percent. Set to 100 percent`}
            >
              <TextMorph disabled={!glide}>{`${Math.round(view.k * 100)}%`}</TextMorph>
            </button>
          </Hint>
          <Hint label="Zoom in" keys={["+"]}>
            <button type="button" className={cn(ICON_BUTTON, "size-8")} onClick={() => zoomBy(1.25, undefined, true)} aria-label="Zoom in">
              <PlusIcon aria-hidden="true" />
            </button>
          </Hint>
          <Hint label="See them all" keys={["Shift", "1"]}>
            <button type="button" className={cn(PILL_BUTTON, "px-2.5 text-white/70 hover:bg-white/[0.08] hover:text-white")} onClick={fit}>
              Fit
            </button>
          </Hint>
          <span className="mx-1 h-4 w-px bg-white/10" aria-hidden="true" />
          <button
            type="button"
            className={cn(PILL_BUTTON, "px-2.5 text-white/55 hover:bg-white/[0.08] hover:text-white")}
            onClick={() => setAsking(true)}
            disabled={busy || !takes}
          >
            Keep none
          </button>
        </div>
      </div>

      {asking ? (
        <div ref={ask} {...outside} data-canvas-ui className={cn(CARD, "absolute top-[68px] right-4 w-[460px] p-1.5")}>
          <DiscardAsk
            what={`${count === 3 ? "all three" : `all ${count}`} versions${working ? " (they stop being made)" : ""}`}
            onKeep={() => setAsking(false)}
            onDiscard={() => {
              setAsking(false);
              void state.discard();
              onBack();
            }}
          />
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          data-canvas-ui
          className={cn(CARD, "absolute top-[72px] left-1/2 -translate-x-1/2 rounded-full px-4 py-2 text-[12px] text-[#ff9592]")}
        >
          {error}
        </p>
      ) : null}

      {/* How it works, quietly, for the first few seconds. */}
      <p
        aria-hidden={!hint}
        className={cn(
          "pointer-events-none absolute inset-x-4 bottom-6 text-center text-[12px] text-white/35 transition-opacity duration-700 ease-out",
          !hint && "opacity-0",
        )}
      >
        Drag to move, pinch to zoom, click one to open it.
      </p>
    </div>
  );
}

function TakeCard({
  n,
  take,
  film,
  left,
  w,
  h,
  delay,
  busy,
  opening,
  frameRef,
  onPick,
}: {
  n: number;
  take: Take | undefined;
  film: Film;
  left: number;
  w: number;
  h: number;
  delay: number;
  busy: boolean;
  opening: boolean;
  frameRef: (el: HTMLIFrameElement | null) => void;
  onPick: () => void;
}) {
  const label = TAKE_WAYS[n - 1]?.label ?? MORE_LABEL;
  const state = take?.state ?? "working";
  const ready = state === "done";
  const scale = w / film.width;
  const note =
    state === "failed"
      ? (take?.error ?? "It stopped with an error.")
      : state === "stopped"
        ? "Claude stopped before this one was done."
        : ready
          ? lastSentence(take?.reply ?? "")
          : "";

  return (
    <div
      className="group absolute top-0 flex flex-col transition-[opacity,translate] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] starting:opacity-0 motion-safe:starting:translate-y-4"
      style={{ left, width: w, transitionDelay: `${delay}ms` }}
    >
      <p className="flex items-center gap-1.5 text-[13px]" style={{ height: HEAD - 8, marginBottom: 8 }}>
        <span className="font-medium text-white/90">Version {n}</span>
        <span className="text-white/35">{label}</span>
        <span className="ms-auto text-[12px] text-white/40">
          {ready ? opening ? <span className="studio-shimmer">Opening</span> : "Ready" : null}
        </span>
      </p>

      <div
        className={cn(
          "relative overflow-hidden rounded-[14px] bg-[#121212] ring-1 transition-[box-shadow] duration-150",
          ready && !busy ? "ring-white/[0.08] group-hover:ring-white/30" : "ring-white/[0.06]",
          opening && "ring-white/40",
        )}
        style={{ width: w, height: h }}
      >
        {state === "working" ? <Skeleton step={take?.step ?? "Starting"} /> : null}

        {/* The version's own stage, once it's finished. Seen, not touched:
            clicks and drags go to the canvas and the card. */}
        {ready && take ? (
          <iframe
            ref={frameRef}
            title={`Version ${n}`}
            src={`${stageUrl(takeFilm(take.id))}?v=done`}
            tabIndex={-1}
            className="pointer-events-none absolute top-0 left-0 origin-top-left animate-in border-0 fade-in-0 duration-500"
            style={{ width: film.width, height: film.height, transform: `scale(${scale})` }}
          />
        ) : null}

        {state === "failed" || state === "stopped" ? (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <p className="text-center text-[12.5px] text-white/45 leading-relaxed">
              {state === "failed" ? "This one didn't make it." : "This one stopped before it finished."}
            </p>
          </div>
        ) : null}

        {ready ? (
          <button
            type="button"
            onClick={onPick}
            aria-disabled={busy}
            aria-label={`Open version ${n}, ${label}, in the editor`}
            className="absolute inset-0 cursor-pointer rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-inset aria-disabled:cursor-default"
          />
        ) : null}
      </div>

      <p className="mt-3 line-clamp-2 px-0.5 text-[12.5px] text-white/50 leading-[18px]" style={{ minHeight: 36 }}>
        {state === "working" ? <span className="text-white/30">Claude is making this one.</span> : note}
      </p>
    </div>
  );
}

// After the last version: a dashed card that asks for one more. It slides
// along as cards are added; on hover only its colour changes.
function MoreCard({ left, w, h, onMore }: { left: number; w: number; h: number; onMore: () => void }) {
  return (
    <div
      className="absolute top-0 transition-[left,opacity] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] starting:opacity-0 motion-reduce:transition-opacity"
      style={{ left, width: w, paddingTop: HEAD }}
      data-canvas-ui
    >
      <button
        type="button"
        onClick={onMore}
        className="flex w-full cursor-pointer flex-col items-center justify-center gap-2.5 rounded-[14px] border border-white/[0.14] border-dashed text-[15px] text-white/45 outline-none transition-colors duration-150 hover:border-white/35 hover:bg-white/[0.02] hover:text-white/85 focus-visible:ring-2 focus-visible:ring-white/70"
        style={{ height: h }}
      >
        <PlusIcon aria-hidden="true" className="size-6" />
        One more version
      </button>
    </div>
  );
}

// A version still being made: the shape of a frame, with a slow shimmer
// across it and what Claude is doing now.
function Skeleton({ step }: { step: string }) {
  return (
    <div className="absolute inset-0" aria-label={`Being made: ${step}`} role="img">
      <div className="absolute inset-0 animate-skeleton bg-[length:200%_100%] bg-[linear-gradient(100deg,rgba(255,255,255,0.025)_20%,rgba(255,255,255,0.075)_50%,rgba(255,255,255,0.025)_80%)] motion-reduce:animate-none" />
      <div className="absolute top-[18%] left-[9%] flex w-[56%] flex-col gap-2.5">
        <span className="h-3 w-[40%] rounded-full bg-white/[0.06]" />
        <span className="h-6 w-full rounded-[8px] bg-white/[0.06]" />
        <span className="h-6 w-[78%] rounded-[8px] bg-white/[0.06]" />
      </div>
      <span className="absolute right-[9%] bottom-[22%] size-[22%] rounded-[12px] bg-white/[0.05]" />
      <p className="absolute inset-x-4 bottom-3.5 truncate text-[12px]">
        <span key={step} className="studio-shimmer animate-in fade-in-0 duration-300">
          {step}
        </span>
      </p>
    </div>
  );
}

// The sentence Claude ends with, on what makes the version different.
const lastSentence = (reply: string) => {
  const parts = reply.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/);
  return parts.at(-1) ?? "";
};
