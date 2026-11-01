"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { EyeOnIcon, RefreshIcon } from "@/components/icons";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Film, FilmSummary, Param, StageOutbound } from "@/lib/studio/contract";
import { cn } from "@/lib/utils";
import { api, StudioError } from "./api";
import { Bubble, PickOutline } from "./bubble";
import { ChatPanel } from "./chat";
import { createClock } from "./clock";
import { FilmsMenu } from "./films-menu";
import { FirstFilm } from "./first-film";
import { Inspector, type Values } from "./inspector";
import { CARD, PILL_BUTTON } from "./panel";
import { RenderControl } from "./render";
import { createBridge, type Insets, Stage, type StageStatus, useFit } from "./stage";
import { Timeline } from "./timeline";
import { useChat } from "./use-chat";
import type { Pinned } from "./words";

// The motion studio: the film fills the window and every panel floats over
// it. The engines that make the film stay out of sight; you work by asking
// Claude, pointing at the film, and tweaking the settings the film exposes.

// ─── Which film is open: /studio?film=<id> ──────────────────────────────────

const NAVIGATE = "studio:navigate";
const subscribe = (cb: () => void) => {
  window.addEventListener("popstate", cb);
  window.addEventListener(NAVIGATE, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(NAVIGATE, cb);
  };
};
const currentFilm = () => new URLSearchParams(window.location.search).get("film") ?? "";

function openFilm(id: string | null, replace = false) {
  const url = id ? `/studio?film=${id}` : "/studio";
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  window.dispatchEvent(new Event(NAVIGATE));
}

// A title from the first words of a prompt: "A 6 second loop: orange…"
// becomes "A 6 second loop".
const titleFrom = (prompt: string) => {
  const first = prompt.split(/[.:;,\n]/)[0].trim().split(/\s+/).slice(0, 6).join(" ");
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : "Untitled film";
};

export function Studio() {
  const id = useSyncExternalStore(subscribe, currentFilm, () => null);
  const [films, setFilms] = useState<FilmSummary[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // A prompt to send as soon as a new film opens.
  const opening = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setFilms(await api.list());
    } catch {
      setFilms((f) => f ?? []);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first load of the film list
    void refresh();
  }, [refresh]);

  // With no film named, open the newest.
  useEffect(() => {
    if (id === "" && films && films.length) openFilm(films[0].id, true);
  }, [id, films]);

  const create = async (width: number, height: number, prompt: string | null = null) => {
    const film = await api.create({ title: prompt ? titleFrom(prompt) : "Untitled film", width, height });
    opening.current = prompt?.trim() || null;
    await refresh();
    openFilm(film.id);
  };

  const start = async (prompt: string | null, width: number, height: number) => {
    setStarting(true);
    setStartError(null);
    try {
      await create(width, height, prompt);
    } catch (e) {
      setStartError(e instanceof StudioError ? e.message : "Unable to make the film. Try again.");
    } finally {
      setStarting(false);
    }
  };

  if (id === null || films === null) return <div className="fixed inset-0 bg-[#0b0b0b]" />;

  return (
    <TooltipProvider delay={400}>
      <main className="fixed inset-0 overflow-hidden bg-[#0b0b0b] font-sans text-white antialiased">
        {id && films.some((f) => f.id === id) ? (
          <FilmView
            key={id}
            id={id}
            films={films}
            hidden={hidden}
            setHidden={setHidden}
            firstPromptRef={opening}
            onRefresh={refresh}
            onOpen={(next) => openFilm(next)}
            onCreate={(w, h) => create(w, h)}
            onGone={async () => {
              const rest = (await api.list().catch(() => [])) ?? [];
              setFilms(rest);
              openFilm(rest[0]?.id ?? null, true);
            }}
          />
        ) : films.length === 0 || !id ? (
          <>
            <FirstFilm busy={starting} error={startError} onStart={start} />
          </>
        ) : (
          <Missing onBack={() => openFilm(films[0]?.id ?? null, true)} />
        )}
      </main>
    </TooltipProvider>
  );
}

function Missing({ onBack }: { onBack: () => void }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <div className={cn(CARD, "flex max-w-[360px] flex-col items-start gap-3 p-5")}>
        <p className="font-medium text-[14px] text-white/90">This film isn’t here any more</p>
        <p className="text-[12.5px] text-white/55 leading-relaxed">It may have been deleted. Open your newest film instead.</p>
        <button type="button" onClick={onBack} className={cn(PILL_BUTTON, "bg-white text-[#141414] hover:bg-white/90")}>
          Open newest film
        </button>
      </div>
    </div>
  );
}

// ─── One open film ───────────────────────────────────────────────────────────

const valuesOf = (film: Film): Values => Object.fromEntries(film.params.map((p) => [p.key, p.value]));

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

function FilmView({
  id,
  films,
  hidden,
  setHidden,
  firstPromptRef,
  onRefresh,
  onOpen,
  onCreate,
  onGone,
}: {
  id: string;
  films: FilmSummary[];
  hidden: boolean;
  setHidden: (fn: (h: boolean) => boolean) => void;
  firstPromptRef: React.RefObject<string | null>;
  onRefresh: () => Promise<void>;
  onOpen: (id: string) => void;
  onCreate: (width: number, height: number) => Promise<void>;
  onGone: () => Promise<void>;
}) {
  const [film, setFilm] = useState<Film | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<Values>({});
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<StageStatus>({ state: "loading" });
  const [pointing, setPointing] = useState(false);
  const [pinned, setPinned] = useState<Pinned | null>(null);
  const [bubble, setBubble] = useState(false);
  const [folded, setFolded] = useState({ chat: false, inspector: false });
  const chatInput = useRef<HTMLTextAreaElement>(null);

  const bridge = useMemo(() => createBridge(), []);
  const clock = useMemo(() => createClock((t) => bridge.post({ type: "studio:seek", t })), [bridge]);
  useEffect(() => () => clock.dispose(), [clock]);
  const time = useCallback(() => clock.get().t, [clock]);

  // Values follow the film until you change one; then yours go to the stage.
  const valuesRef = useRef(values);
  useEffect(() => {
    valuesRef.current = values;
  });

  const adopt = useCallback(
    (next: Film) => {
      setFilm(next);
      setValues(valuesOf(next));
      clock.setDuration(next.duration);
    },
    [clock],
  );

  useEffect(() => {
    let live = true;
    api
      .get(id)
      .then((f) => {
        if (!live) return;
        adopt(f);
        // Open on the cover frame, where the film is fully in view, rather
        // than on its first frame, which is often empty.
        clock.seek(f.marks.find((m) => m.label === "Cover")?.t ?? 0);
      })
      .catch((e) => live && setLoadError(e instanceof StudioError ? e.message : "Unable to open this film."));
    return () => {
      live = false;
    };
  }, [id, adopt, clock]);

  const reloadStage = useCallback(() => {
    setStatus({ state: "loading" });
    bridge.post({ type: "studio:reload" });
  }, [bridge]);

  const chat = useChat(id, {
    onChanged: reloadStage,
    onFilm: (f) => {
      adopt(f);
      void onRefresh();
    },
  });

  // A film made from a prompt sends that prompt once it's open.
  const sent = useRef(false);
  useEffect(() => {
    if (!film || sent.current || !firstPromptRef.current) return;
    sent.current = true;
    const prompt = firstPromptRef.current;
    firstPromptRef.current = null;
    void chat.send(prompt, { t: 0, pick: null });
  }, [film, firstPromptRef, chat]);

  const onStage = useCallback(
    (m: StageOutbound) => {
      switch (m.type) {
        case "studio:ready":
          setStatus({ state: "ready" });
          clock.setDuration(m.duration);
          bridge.post({ type: "studio:params", params: valuesRef.current });
          bridge.post({ type: "studio:seek", t: clock.get().t });
          break;
        case "studio:loading":
          setStatus({ state: "loading" });
          break;
        case "studio:error":
          setStatus({ state: "error", message: m.message });
          break;
        case "studio:picked":
          clock.pause();
          setPinned({ pick: m.pick, t: clock.get().t });
          setPointing(false);
          setBubble(true);
          break;
      }
    },
    [bridge, clock],
  );

  // Saves param changes a moment after the last one.
  const pending = useRef<Values>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setParam = (key: string, value: Param["value"]) => {
    const next = { ...valuesRef.current, [key]: value };
    setValues(next);
    bridge.post({ type: "studio:params", params: next });
    pending.current[key] = value;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const params = pending.current;
      pending.current = {};
      const saved = await api.edit(id, { params }).catch(() => null);
      if (saved) setFilm(saved);
    }, 400);
  };

  const setSize = async (width: number, height: number) => {
    const saved = await api.edit(id, { width, height }).catch(() => null);
    if (saved) {
      setFilm(saved);
      setStatus({ state: "loading" });
      setVersion((v) => v + 1);
      void onRefresh();
    }
  };

  const setDuration = async (seconds: number, commit: boolean) => {
    const rounded = Math.round(seconds * 10) / 10;
    setFilm((f) => (f ? { ...f, duration: rounded } : f));
    clock.setDuration(rounded);
    if (!commit) return;
    const saved = await api.edit(id, { duration: rounded }).catch(() => null);
    if (saved) {
      setFilm(saved);
      reloadStage();
    }
  };

  const rename = async (title: string) => {
    setFilm((f) => (f ? { ...f, title } : f));
    const saved = await api.edit(id, { title }).catch(() => null);
    if (saved) setFilm(saved);
    void onRefresh();
  };

  const togglePoint = useCallback(() => {
    setBubble(false);
    setPointing((p) => {
      if (!p) clock.pause();
      return !p;
    });
  }, [clock]);

  // Keys: Space plays, P points, ⌘K asks, H hides the panels, L loops,
  // arrows step a frame (with Shift, a second), Escape backs out.
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPointing(false);
        setBubble(true);
        return;
      }
      if (e.key === "Escape") {
        if (bubble) setBubble(false);
        else if (pointing) setPointing(false);
        else if (pinned) setPinned(null);
        return;
      }
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const onControl = e.target instanceof HTMLElement && e.target.closest("button, [role=slider], a");
      switch (e.key) {
        case " ":
          if (onControl) return;
          e.preventDefault();
          clock.toggle();
          break;
        case "p":
        case "P":
          e.preventDefault();
          togglePoint();
          break;
        case "h":
        case "H":
          e.preventDefault();
          setHidden((h) => !h);
          break;
        case "l":
        case "L":
          clock.setLoop(!clock.get().loop);
          break;
        case "ArrowRight":
        case "ArrowLeft": {
          if (e.target instanceof HTMLElement && e.target.closest("[role=slider]")) return;
          e.preventDefault();
          clock.pause();
          const step = e.shiftKey ? 1 : 1 / (film?.fps || 60);
          clock.seek(clock.get().t + (e.key === "ArrowRight" ? step : -step));
          break;
        }
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [bubble, pointing, pinned, clock, togglePoint, setHidden, film?.fps]);

  // Room the panels take; the film fits in the rest. Hidden panels give the
  // film the whole window.
  const chatOpen = !hidden && !folded.chat;
  const inspectorOpen = !hidden && !folded.inspector;
  const insets: Insets = hidden
    ? { top: 0, right: 0, bottom: 0, left: 0 }
    : {
        // Folded panels leave a pill under the top bar; keep the film below it.
        top: folded.chat || folded.inspector ? 116 : 72,
        right: inspectorOpen ? 320 : 24,
        bottom: 96,
        left: chatOpen ? 372 : 24,
      };
  const fit = useFit(film?.width ?? 1920, film?.height ?? 1080, insets);

  if (loadError) {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <div className={cn(CARD, "flex max-w-[360px] flex-col gap-2 p-5")}>
          <p className="font-medium text-[14px] text-white/90">Unable to open this film</p>
          <p className="text-[12.5px] text-white/55 leading-relaxed">{loadError}</p>
        </div>
      </div>
    );
  }
  if (!film) return null;

  return (
    <>
      <Stage
        id={id}
        engine={film.engine}
        width={film.width}
        height={film.height}
        fit={fit}
        bridge={bridge}
        version={version}
        pointing={pointing}
        onMessage={onStage}
      />

      {/* Over the film: what's going on with it. */}
      <div className="pointer-events-none absolute inset-0">
        {pointing ? (
          <div
            className="absolute rounded-[4px] ring-2 ring-[#F55A00] ring-offset-0"
            style={{ left: fit.x, top: fit.y, width: fit.width, height: fit.height }}
          >
            <span className="absolute -top-8 left-1/2 flex h-6 -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-[7px] bg-[#F55A00] px-2 font-medium text-[11.5px] text-white">
              Click the part you want to change <Kbd className="bg-white/20 text-white">Esc</Kbd>
            </span>
          </div>
        ) : null}
        {pinned && !pointing ? <PickOutline fit={fit} pinned={pinned} /> : null}
        {status.state === "loading" ? (
          <span
            className={cn(CARD, "absolute flex h-8 -translate-x-1/2 items-center gap-2 rounded-full px-3 text-[12px] text-white/70")}
            style={{ left: fit.x + fit.width / 2, top: fit.y + fit.height / 2 - 16 }}
          >
            <Spinner className="size-3" /> Loading the film
          </span>
        ) : null}
        {status.state === "error" ? (
          <div
            className={cn(CARD, "pointer-events-auto absolute flex w-[320px] -translate-x-1/2 -translate-y-1/2 flex-col gap-2 p-4")}
            style={{ left: fit.x + fit.width / 2, top: fit.y + fit.height / 2 }}
            role="alert"
          >
            <p className="font-medium text-[13px] text-white/90">The film stopped playing</p>
            <p className="line-clamp-4 font-mono text-[11.5px] text-white/50 leading-relaxed">{status.message}</p>
            <div className="mt-1 flex gap-1.5">
              <button
                type="button"
                disabled={chat.turn.running}
                onClick={() =>
                  chat.send(`The film stopped playing with this error: ${status.message}\nFix it.`, { t: time(), pick: null })
                }
                className={cn(PILL_BUTTON, "bg-white text-[#141414] hover:bg-white/90")}
              >
                Ask Claude to fix it
              </button>
              <button
                type="button"
                onClick={() => {
                  setStatus({ state: "loading" });
                  setVersion((v) => v + 1);
                }}
                className={cn(PILL_BUTTON, "text-white/70 hover:bg-white/[0.08] hover:text-white")}
              >
                <RefreshIcon aria-hidden="true" />
                Try again
              </button>
            </div>
          </div>
        ) : null}
        {bubble ? (
          <Bubble
            fit={fit}
            pinned={pinned}
            time={time}
            chat={chat}
            onClose={() => setBubble(false)}
            onSent={() => {
              setBubble(false);
              setPinned(null);
              setFolded((f) => ({ ...f, chat: false }));
            }}
          />
        ) : null}
      </div>

      {/* The panels. */}
      <div className="pointer-events-none absolute inset-0">
        <FilmsMenu
          film={film}
          films={films}
          hidden={hidden}
          onOpen={onOpen}
          onCreate={onCreate}
          onRefresh={() => void onRefresh()}
          onRename={rename}
          onDuplicate={async () => {
            const copy = await api.duplicate(id);
            await onRefresh();
            onOpen(copy.id);
          }}
          onDelete={async () => {
            await api.remove(id);
            await onGone();
          }}
        />
        <RenderControl id={id} hidden={hidden} onHide={() => setHidden(() => true)} />
        <ChatPanel
          chat={chat}
          pinned={bubble ? null : pinned}
          time={time}
          onClearPick={() => setPinned(null)}
          pointing={pointing}
          onPoint={togglePoint}
          folded={folded.chat}
          onFold={(f) => setFolded((s) => ({ ...s, chat: f }))}
          hidden={hidden}
          inputRef={chatInput}
        />
        <Inspector
          film={film}
          values={values}
          onParam={setParam}
          onSize={setSize}
          onDuration={setDuration}
          folded={folded.inspector}
          onFold={(f) => setFolded((s) => ({ ...s, inspector: f }))}
          hidden={hidden}
        />
        <Timeline
          clock={clock}
          fps={film.fps}
          marks={film.marks}
          hidden={hidden}
          className="right-4 bottom-4 transition-[left,opacity,translate,scale,filter]"
          style={{ left: chatOpen ? 372 : 16 }}
        />
        {hidden ? (
          <button
            type="button"
            onClick={() => setHidden(() => false)}
            className={cn(
              CARD,
              PILL_BUTTON,
              "pointer-events-auto absolute top-4 right-4 text-white/45 opacity-60 transition-opacity hover:text-white hover:opacity-100 focus-visible:opacity-100",
            )}
          >
            <EyeOnIcon aria-hidden="true" />
            Show panels
            <Kbd>H</Kbd>
          </button>
        ) : null}
      </div>
    </>
  );
}
