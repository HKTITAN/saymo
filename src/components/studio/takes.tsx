"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MultipleCrossCancelIcon, PauseCircleIcon, PlayCircleIcon } from "@/components/icons";
import type { ProviderId } from "@/lib/studio/ai-types";
import type { ChatContext, Film } from "@/lib/studio/contract";
import { TAKE_WAYS, type Take, type Takes } from "@/lib/studio/takes-shared";
import { cn } from "@/lib/utils";
import { api, StudioError, stageUrl } from "./api";
import { CARD, DiscardAsk, Hint, ICON_BUTTON, PILL_BUTTON } from "./panel";
import { useOutsideClose } from "./use-outside";

// Three versions of one prompt, made at once and shown side by side over
// the film (takes.ts on the server). They play together from one clock;
// "Use this one" makes the film that version (one step, undoable), "Keep
// none" throws all three away. Esc or a click outside asks first, as the
// versions took a while to make.

export function useTakes(id: string, onPicked: (film: Film) => void) {
  const [takes, setTakes] = useState<Takes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const picked = useRef(onPicked);
  useEffect(() => {
    picked.current = onPicked;
  });

  // How they're going: once on opening, then every 1.5 s while any is
  // still being made.
  const working = Boolean(takes?.takes.some((t) => t.state === "working"));
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      const next = await api.takes(id).catch(() => undefined);
      if (!live || next === undefined) return;
      setTakes(next);
      if (next?.takes.some((t) => t.state === "working")) timer = setTimeout(ask, 1500);
    };
    void ask();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id, working]);

  const start = useCallback(
    async (prompt: string, context: ChatContext, provider: ProviderId) => {
      setError(null);
      try {
        setTakes(await api.startTakes(id, { prompt, context, provider }));
      } catch (e) {
        setError(e instanceof StudioError ? e.message : "Unable to start the three versions. Try again.");
      }
    },
    [id],
  );

  const pick = useCallback(
    async (take: string) => {
      setBusy(true);
      setError(null);
      try {
        const film = await api.pickTake(id, take);
        setTakes(null);
        picked.current(film);
      } catch (e) {
        setError(e instanceof StudioError ? e.message : "Unable to use that version. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [id],
  );

  const discard = useCallback(async () => {
    setTakes(null);
    setError(null);
    await api.discardTakes(id).catch(() => {});
  }, [id]);

  return { takes, error, busy, start, pick, discard, clearError: () => setError(null) };
}

export type TakesState = ReturnType<typeof useTakes>;

type Box = { left: number; top: number; right: number; bottom: number };

export function TakesView({ state, film, box }: { state: TakesState; film: Film; box: Box }) {
  const { takes, busy, error } = state;
  const view = useRef<HTMLElement>(null);
  const room = useRef<HTMLDivElement>(null);
  const frames = useRef<(HTMLIFrameElement | null)[]>([]);
  const lengths = useRef<number[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [playing, setPlaying] = useState(true);
  const [t, setT] = useState(0);
  const [asking, setAsking] = useState(false);

  // The room the view can take: the film's area.
  useLayoutEffect(() => {
    const el = room.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Each version's own length, from its stage when it's ready.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const i = frames.current.findIndex((f) => f?.contentWindow === e.source);
      const m = e.data as { type?: string; duration?: number } | null;
      if (i >= 0 && m?.type === "studio:ready" && Number(m.duration) > 0) lengths.current[i] = Number(m.duration);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // One clock for all three; each loops at its own length.
  const clock = useRef({ t: 0, from: 0 });
  useEffect(() => {
    let raf = 0;
    const seekAll = (now: number) => {
      frames.current.forEach((f, i) => {
        const d = lengths.current[i] || film.duration;
        f?.contentWindow?.postMessage({ type: "studio:seek", t: d > 0 ? now % d : 0 }, window.location.origin);
      });
    };
    if (!playing) {
      seekAll(clock.current.t);
      return;
    }
    clock.current.from = performance.now() - clock.current.t * 1000;
    const tick = () => {
      const now = (performance.now() - clock.current.from) / 1000;
      clock.current.t = now;
      seekAll(now);
      setT(now);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, film.duration]);

  const ask = () => setAsking(true);
  const outside = useOutsideClose(view, () => (asking ? setAsking(false) : ask()), { enabled: !busy });
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setAsking((a) => !a);
    };
    window.addEventListener("keydown", keys, true);
    return () => window.removeEventListener("keydown", keys, true);
  }, []);

  if (!takes) return null;
  const working = takes.takes.filter((x) => x.state === "working").length;

  // Each preview at the film's shape, as big as three side by side allow.
  // Around them: the view's padding and header and the line under them
  // (about 98 px), and each card's name, words and button (about 110 px).
  const gap = 12;
  const colW = Math.max(0, (size.w - 24 - gap * 2) / 3);
  const scale = size.w ? Math.min(colW / film.width, Math.max(0, size.h - 208) / film.height) : 0;
  const w = Math.round(film.width * scale);
  const h = Math.round(film.height * scale);
  const loop = film.duration > 0 ? (t % film.duration) / film.duration : 0;

  return (
    // Centred over the film's area, only as tall as the three previews need.
    <div
      ref={room}
      className="pointer-events-none absolute z-30 flex items-center justify-center"
      style={{ left: box.left, top: box.top, right: box.right, bottom: box.bottom }}
    >
    <section
      ref={view}
      {...outside}
      aria-label={`Three versions of: ${takes.prompt}`}
      className={cn(
        CARD,
        "pointer-events-auto flex max-h-full w-full flex-col gap-3 bg-[#141414] p-3 backdrop-blur-none animate-in fade-in-0 zoom-in-[0.98] duration-200",
      )}
    >
      <header className="flex h-8 items-center gap-2 ps-1">
        <h2 className="shrink-0 font-medium text-[13px] text-white/90">3 versions</h2>
        <p className="min-w-0 truncate text-[12px] text-white/45">{takes.prompt}</p>
        <span className="ms-auto" />
        <Hint label={playing ? "Pause all three" : "Play all three"}>
          <button type="button" className={cn(ICON_BUTTON, "size-8")} onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <PauseCircleIcon aria-hidden="true" /> : <PlayCircleIcon aria-hidden="true" />}
          </button>
        </Hint>
        <span className="relative h-1 w-24 overflow-hidden rounded-full bg-white/[0.08]" aria-hidden="true">
          <span className="absolute inset-y-0 left-0 rounded-full bg-white/50" style={{ width: `${loop * 100}%` }} />
        </span>
        <button type="button" className={cn(PILL_BUTTON, "h-8 px-2.5 text-white/65 hover:bg-white/[0.08] hover:text-white")} onClick={ask} disabled={busy}>
          Keep none
        </button>
        <Hint label="Close" keys={["Esc"]}>
          <button type="button" className={ICON_BUTTON} onClick={ask} aria-label="Close the three versions" disabled={busy}>
            <MultipleCrossCancelIcon aria-hidden="true" />
          </button>
        </Hint>
      </header>

      <div className="flex min-h-0 items-start justify-center gap-3">
        {scale > 0
          ? takes.takes.map((take, i) => (
              <TakeCard
                key={take.id}
                take={take}
                film={film}
                w={w}
                h={h}
                scale={scale}
                busy={busy}
                frameRef={(el) => {
                  frames.current[i] = el;
                }}
                onPick={() => void state.pick(take.id)}
              />
            ))
          : null}
      </div>

      {asking ? (
        <DiscardAsk
          what={working ? "the three versions (they stop being made)" : "these three versions"}
          onKeep={() => setAsking(false)}
          onDiscard={() => void state.discard()}
        />
      ) : error ? (
        <p className="px-1 text-[12px] text-[#ff9592] leading-relaxed">{error}</p>
      ) : (
        <p className="px-1 text-[11.5px] text-white/40">
          {working ? `Claude is making all three at once. ${working === 3 ? "This takes about as long as one change." : "Almost there."}` : "Pick the one to keep. The film becomes that version, and Undo brings this one back."}
        </p>
      )}
    </section>
    </div>
  );
}

function TakeCard({
  take,
  film,
  w,
  h,
  scale,
  busy,
  frameRef,
  onPick,
}: {
  take: Take;
  film: Film;
  w: number;
  h: number;
  scale: number;
  busy: boolean;
  frameRef: (el: HTMLIFrameElement | null) => void;
  onPick: () => void;
}) {
  const way = TAKE_WAYS[take.n - 1];
  const ready = take.state === "done";
  return (
    <div className="flex min-w-0 flex-col gap-2" style={{ width: w }}>
      <p className="flex h-5 items-center gap-1.5 text-[12px]">
        <span className="text-white/85">Version {take.n}</span>
        <span className="text-white/35">{way?.label}</span>
      </p>
      <div className="relative overflow-hidden rounded-[10px] bg-black/40 ring-1 ring-white/[0.06]" style={{ width: w, height: h }}>
        {/* The version's own stage, reloaded once it's finished. Seen, not
            touched: clicks go to the card. */}
        <iframe
          key={`${take.id}-${take.state}`}
          ref={frameRef}
          title={`Version ${take.n}`}
          src={`${stageUrl(take.id)}?v=${take.state}`}
          tabIndex={-1}
          className={cn("pointer-events-none absolute top-0 left-0 origin-top-left border-0 transition-opacity duration-300", ready ? "opacity-100" : "opacity-35")}
          style={{ width: film.width, height: film.height, transform: `scale(${scale})` }}
        />
        {take.state === "working" ? (
          <span className="absolute inset-x-3 bottom-3 truncate text-[12px]">
            <span className="studio-shimmer">{take.step ?? "Working on it"}</span>
          </span>
        ) : null}
      </div>
      <p className="line-clamp-2 min-h-[34px] px-0.5 text-[11.5px] text-white/50 leading-[17px]">
        {take.state === "failed"
          ? (take.error ?? "This version stopped with an error.")
          : take.state === "stopped"
            ? "This version stopped before it finished."
            : ready
              ? lastSentence(take.reply)
              : ""}
      </p>
      <button
        type="button"
        disabled={!ready || busy}
        onClick={onPick}
        className={cn(
          PILL_BUTTON,
          "justify-center",
          ready ? "bg-white text-[#141414] hover:bg-white/90" : "bg-white/[0.06] text-white/40",
        )}
      >
        Use this one
      </button>
    </div>
  );
}

// The sentence Claude ends with, on what makes the version different.
const lastSentence = (reply: string) => {
  const parts = reply.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/);
  return parts.at(-1) ?? "";
};
