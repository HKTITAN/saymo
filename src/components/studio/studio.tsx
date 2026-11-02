"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { EyeOnIcon, RefreshIcon, UploadUpIcon } from "@/components/icons";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { BrandSummary } from "@/lib/studio/brand";
import type { Film, FilmSummary, Param, Picked, StageOutbound } from "@/lib/studio/contract";
import type { FilmSound } from "@/lib/studio/sound";
import { editEnd, type GraphicInfo, type Media } from "@/lib/studio/edit";
import { cn } from "@/lib/utils";
import { api, StudioError } from "./api";
import { Bubble, PickOutline } from "./bubble";
import { ChatPanel } from "./chat";
import { createClock, useClock } from "./clock";
import { EditInspector } from "./edit-inspector";
import { addGraphic, addMedia, endOf, type Item } from "./edit-ops";
import { FilmsMenu } from "./films-menu";
import { brandApi } from "./brand-api";
import { SkeletonProvider } from "@/components/skeleton";
import { Dashboard } from "./dashboard";
import { undoKey, useHistory } from "./history";
import { Inspector, type Values } from "./inspector";
import { KitPage } from "./kit-page";
import { MediaBin } from "./media-bin";
import { Opening } from "./opening";
import { clipNumber, defaults, Multitrack } from "./multitrack";
import { CARD, PILL_BUTTON } from "./panel";
import { RenderControl } from "./render";
import { SoundGroup } from "./sound-group";
import { type SoundLaneData, showLane, showStems } from "./sound-lane";
import { soundApi, soundOf } from "./sound-api";
import { createBridge, type Insets, Stage, type StageStatus, useFit } from "./stage";
import { Timeline } from "./timeline";
import { attachFiles } from "./use-attachments";
import { useChat } from "./use-chat";
import { useEdit } from "./use-edit";
import { useSound } from "./use-sound";
import { useSoundEdit } from "./use-sound-edit";
import { isMediaFile } from "./video-api";
import { type Pinned, type SoundPin, soundChipLabel, tryAnotherPrompt } from "./words";

// The motion studio: the film fills the window and every panel floats over
// it. The engines that make the film stay out of sight; you work by asking
// Claude, pointing at the film, and tweaking the settings the film exposes.
// A video film adds a timeline of tracks, a bin of footage and graphics,
// and an inspector for whatever is selected on the timeline.

// ─── What's open: /studio (the dashboard), /studio?film=<id>, or
// /studio?brand=<id> (a brand kit) ──────────────────────────────────────────

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
const currentKit = () => new URLSearchParams(window.location.search).get("brand") ?? "";

function openKit(id: string | null, replace = false) {
  const url = id ? `/studio?brand=${id}` : "/studio";
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  window.dispatchEvent(new Event(NAVIGATE));
}

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

// A video film is named after its first file: "Interview with Darshan.mov"
// becomes "Interview with Darshan".
// Words typed on the film travel from the stage handler to where they are
// saved and undone.
const WORDS_EVENT = "studio:words";

const titleFromFile = (name: string) => {
  const words = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Untitled video";
};

// A side column: 16 from the window edge, 300 wide, then 16 of air.
const COLUMN = 16 + 300 + 16;

export function Studio() {
  const id = useSyncExternalStore(subscribe, currentFilm, () => null);
  const kitId = useSyncExternalStore(subscribe, currentKit, () => null);
  const [films, setFilms] = useState<FilmSummary[] | null>(null);
  const [kits, setKits] = useState<BrandSummary[] | null>(null);
  // A kit made from files opens with Claude reading them.
  const kitOpening = useRef<{ prompt: string; url: string } | null>(null);
  // A kit Claude just made opens with its note on what it found.
  const kitArrival = useRef<{ id: string; reply: string } | null>(null);
  const [kitNote, setKitNote] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // A prompt to send, or footage to bring in, as soon as a new film opens.
  const opening = useRef<string | null>(null);
  const openingFiles = useRef<File[] | null>(null);
  const openingAttach = useRef<File[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      setFilms(await api.list());
    } catch {
      setFilms((f) => f ?? []);
    }
  }, []);

  const refreshKits = useCallback(async () => {
    try {
      setKits(await brandApi.list());
    } catch {
      setKits((k) => k ?? []);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first load of the film list
    void refresh();
  }, [refresh]);

  // The dashboard's kits, fresh each time it shows.
  const onDashboard = id === "" && kitId === "";
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load the kits for the dashboard
    if (onDashboard) void refreshKits();
  }, [onDashboard, refreshKits]);

  const newKit = () =>
    start(async () => {
      const kit = await brandApi.create("New brand");
      openKit(kit.id);
    });
  const importKit = (file: File) =>
    start(async () => {
      const kit = await brandApi.import(file);
      openKit(kit.id);
    });
  // Claude made a kit from what was shared: open it with its note.
  const kitMade = (kitId: string, reply: string) => {
    kitArrival.current = { id: kitId, reply };
    openKit(kitId);
  };
  // The kit card was closed while Claude builds: it carries on, and the kit
  // is already on the dashboard.
  const kitHidden = (kitId: string | null) => {
    void refreshKits();
    if (kitId) setKitNote("Claude is still making the kit. Open it to watch.");
  };
  useEffect(() => {
    if (!kitNote) return;
    const t = setTimeout(() => setKitNote(null), 4000);
    return () => clearTimeout(t);
  }, [kitNote]);

  const create = async (
    width: number,
    height: number,
    {
      prompt = null,
      kind = "motion",
      files = null,
      folder = null,
      attach = null,
    }: {
      prompt?: string | null;
      kind?: "motion" | "video";
      files?: File[] | null;
      folder?: string | null;
      attach?: File[] | null;
    } = {},
  ) => {
    const title = kind === "video" ? titleFromFile(files?.[0]?.name ?? "") : prompt ? titleFrom(prompt) : "Untitled film";
    const film = await api.create({ title, width, height, ...(kind === "video" ? { kind } : {}) });
    // Started inside a folder: it's filed there.
    if (folder) await api.edit(film.id, { folder }).catch(() => undefined);
    opening.current = prompt?.trim() || null;
    openingFiles.current = files?.length ? files : null;
    openingAttach.current = attach?.length ? attach : null;
    await refresh();
    openFilm(film.id);
  };

  const start = async (job: () => Promise<void>) => {
    setStarting(true);
    setStartError(null);
    try {
      await job();
    } catch (e) {
      setStartError(e instanceof StudioError ? e.message : "Unable to make the film. Try again.");
    } finally {
      setStarting(false);
    }
  };

  // The home page draws its loading shapes; a film or kit waits for the list.
  if (id === null || kitId === null || (films === null && (id || kitId))) return <div className="fixed inset-0 bg-[#0b0b0b]" />;

  return (
    <SkeletonProvider>
    <TooltipProvider delay={400}>
      <main className="fixed inset-0 overflow-hidden bg-[#0b0b0b] font-sans text-white antialiased">
        {kitId ? (
          <KitPage
            key={kitId}
            id={kitId}
            openingRef={kitOpening}
            arrivalRef={kitArrival}
            onHome={() => openFilm(null)}
            onOpenKit={(next) => openKit(next)}
            onGone={() => openKit(null, true)}
          />
        ) : id && films?.some((f) => f.id === id) ? (
          <FilmView
            key={id}
            id={id}
            films={films ?? []}
            hidden={hidden}
            setHidden={setHidden}
            firstPromptRef={opening}
            firstFilesRef={openingFiles}
            firstAttachRef={openingAttach}
            onRefresh={refresh}
            onOpen={(next) => openFilm(next)}
            onCreate={(w, h, kind) => create(w, h, { kind })}
            onHome={() => openFilm(null)}
            onGone={async () => {
              const rest = (await api.list().catch(() => [])) ?? [];
              setFilms(rest);
              openFilm(null, true);
            }}
          />
        ) : !id ? (
          <Dashboard
            films={films}
            kits={kits}
            busy={starting}
            error={startError}
            onOpenFilm={(next) => openFilm(next)}
            onRenameFilm={async (fid, title) => {
              setFilms((list) => list?.map((x) => (x.id === fid ? { ...x, title } : x)) ?? null);
              await api.edit(fid, { title }).catch(() => undefined);
              await refresh();
            }}
            onDuplicateFilm={async (fid) => {
              await api.duplicate(fid).catch(() => undefined);
              await refresh();
            }}
            onDeleteFilm={async (fid) => {
              await api.remove(fid).catch(() => undefined);
              await refresh();
            }}
            onMoveFilm={async (fid, folder) => {
              setFilms((list) => list?.map((x) => (x.id === fid ? { ...x, folder: folder ?? undefined } : x)) ?? null);
              await api.edit(fid, { folder }).catch(() => refresh());
            }}
            onRefresh={refresh}
            onStartFilm={(prompt, w, h, folder, attach?: File[]) => start(() => create(w, h, { prompt, folder, attach }))}
            onStartVideo={(files, w, h, folder) => start(() => create(w, h, { kind: "video", files, folder }))}
            onOpenKit={(next) => openKit(next)}
            onNewKit={newKit}
            onImportKit={importKit}
            onKitMade={kitMade}
            onKitHidden={kitHidden}
          />
        ) : (
          <Missing onBack={() => openFilm(null, true)} />
        )}
        {kitNote && onDashboard ? (
          <div className="pointer-events-none absolute bottom-6 left-1/2 z-30 -translate-x-1/2">
            <p className={cn(CARD, "flex h-9 items-center rounded-full px-4 text-[12px] text-white/85")} aria-live="polite">
              <span className="studio-shimmer">{kitNote}</span>
            </p>
          </div>
        ) : null}
      </main>
    </TooltipProvider>
    </SkeletonProvider>
  );
}

function Missing({ onBack }: { onBack: () => void }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <div className={cn(CARD, "flex max-w-[360px] flex-col items-start gap-3 p-5")}>
        <p className="font-medium text-[14px] text-white/90">This film isn’t here any more</p>
        <p className="text-[12.5px] text-white/55 leading-relaxed">It may have been deleted. Your other films and kits are in the studio.</p>
        <button type="button" onClick={onBack} className={cn(PILL_BUTTON, "bg-white text-[#141414] hover:bg-white/90")}>
          Back to the studio
        </button>
      </div>
    </div>
  );
}

// ─── One open film ───────────────────────────────────────────────────────────

const valuesOf = (film: Film): Values => Object.fromEntries(film.params.map((p) => [p.key, p.value]));

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

// A param's value as the undo note says it: "Speed 1.40 x", "Accent #F55A00".
function paramNote(p: Param, v: Param["value"]) {
  if (typeof v === "boolean") return `${p.label} ${v ? "on" : "off"}`;
  if (typeof v === "number") {
    const step = p.step ?? 0.01;
    const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;
    return `${p.label} ${v.toFixed(decimals)}${p.unit ? ` ${p.unit}` : ""}`;
  }
  return v.length > 18 ? p.label : `${p.label} ${v}`;
}

const SIZE_NAMES: Record<string, string> = { "1920x1080": "16:9", "1080x1080": "1:1", "1080x1350": "4:5", "1080x1920": "9:16" };

const subscribeResize = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};
const windowHeight = () => window.innerHeight;

function FilmView({
  id,
  films,
  hidden,
  setHidden,
  firstPromptRef,
  firstAttachRef,
  firstFilesRef,
  onRefresh,
  onOpen,
  onCreate,
  onGone,
  onHome,
}: {
  onHome: () => void;
  id: string;
  films: FilmSummary[];
  hidden: boolean;
  setHidden: (fn: (h: boolean) => boolean) => void;
  firstPromptRef: React.RefObject<string | null>;
  firstAttachRef: React.RefObject<File[] | null>;
  firstFilesRef: React.RefObject<File[] | null>;
  onRefresh: () => Promise<void>;
  onOpen: (id: string) => void;
  onCreate: (width: number, height: number, kind: "motion" | "video") => Promise<void>;
  onGone: () => Promise<void>;
}) {
  const [film, setFilm] = useState<Film | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<Values>({});
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<StageStatus>({ state: "loading" });
  // The text params the film binds to its words (editable on the film).
  const [texts, setTexts] = useState<string[]>([]);
  const [pointing, setPointing] = useState(false);
  const [pinned, setPinned] = useState<Pinned | null>(null);
  // Part of the sound, picked on the timeline and pinned to the prompt.
  const [soundPin, setSoundPin] = useState<SoundPin | null>(null);
  const [bubble, setBubble] = useState(false);
  const [folded, setFolded] = useState({ chat: false, inspector: false, media: false });
  // The timeline's height: a third of the window until you pull its edge.
  const [timelineHeight, setTimelineHeight] = useState<number | null>(null);
  const [dropping, setDropping] = useState(false);
  const chatInput = useRef<HTMLTextAreaElement>(null);
  const winH = useSyncExternalStore(subscribeResize, windowHeight, () => 900);
  const isVideo = film?.kind === "video";

  const bridge = useMemo(() => createBridge(), []);
  const clock = useMemo(() => createClock((t) => bridge.post({ type: "studio:seek", t })), [bridge]);
  useEffect(() => () => clock.dispose(), [clock]);
  const time = useCallback(() => clock.get().t, [clock]);

  // Values follow the film until you change one; then yours go to the stage.
  const valuesRef = useRef(values);
  const filmRef = useRef(film);
  useEffect(() => {
    valuesRef.current = values;
    filmRef.current = film;
  });

  const adopt = useCallback(
    (next: Film) => {
      setFilm(next);
      setValues(valuesOf(next));
      // A video film is as long as its edit, which sets the clock itself.
      if (next.kind !== "video") clock.setDuration(next.duration);
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

  // Did the Claude turn under way change the film? Then it's a step in the
  // undo history once it ends.
  const claudeChanged = useRef(false);
  const edRef = useRef<ReturnType<typeof useEdit> | null>(null);
  const chat = useChat(id, {
    onChanged: () => {
      claudeChanged.current = true;
      reloadStage();
      if (filmRef.current?.kind === "video") void edRef.current?.reload();
    },
    onFilm: (f) => {
      adopt(f);
      void onRefresh();
    },
  });

  const history = useHistory({ undoClaude: chat.undo, claudeBusy: () => chat.turn.running });

  // The film's sound design: played here in step with the clock.
  const sound = useSound({ id, film, clock, bridge, claudeRunning: chat.turn.running });
  const soundRef = useRef(sound);
  useEffect(() => {
    soundRef.current = sound;
  });

  const wasRunning = useRef(false);
  useEffect(() => {
    const running = chat.turn.running;
    if (running && !wasRunning.current) claudeChanged.current = false;
    if (!running && wasRunning.current && claudeChanged.current) {
      history.recordClaude();
      claudeChanged.current = false;
    }
    wasRunning.current = running;
  }, [chat.turn.running, history]);

  // The timeline's edit, for video films (unused for motion films).
  const ed = useEdit(id, {
    onLive: (edit) => bridge.post({ type: "studio:edit", edit }),
    onDuration: (d) => {
      if (filmRef.current?.kind === "video") clock.setDuration(d);
    },
    record: history.record,
    enabled: film?.kind === "video",
  });
  useEffect(() => {
    edRef.current = ed;
  });

  // What the chat and the bubble use: a video film's waiting edits are saved
  // before Claude reads it, and what's selected on its timeline goes along
  // ("drop this one and close the gap"). The chat's own Undo keeps the
  // history true.
  const chatView = useMemo(
    () => ({
      ...chat,
      send: async (prompt: string, context: Parameters<typeof chat.send>[1]) => {
        const ed = edRef.current;
        if (filmRef.current?.kind !== "video" || !ed) return chat.send(prompt, context);
        await ed.flush();
        const selection = [...ed.selected].slice(0, 50);
        const withSelection: typeof context & { selection?: string[] } = { ...context, selection };
        return chat.send(prompt, withSelection);
      },
      undo: async () => {
        const error = await chat.undo();
        if (!error) history.forgetClaude();
        return error;
      },
      // Going back is a step ⌘Z can take back, like a Claude turn.
      restore: async (n: number, t: number) => {
        const error = await chat.restore(n, t);
        if (!error) history.recordClaude();
        return error;
      },
    }),
    [chat, history],
  );

  // Parts of the sound picked on the timeline's Music and Effects lanes:
  // changed by hand (each change a step for ⌘Z), pinned to the prompt, or
  // sent to Claude for another take.
  const soundLength = film?.duration ?? 0;
  const soundEdit = useSoundEdit({
    id,
    sound,
    duration: soundLength,
    record: history.record,
    onAsk: useCallback((pin: SoundPin) => {
      setPinned(null);
      setSoundPin(pin);
      setFolded((f) => ({ ...f, chat: false }));
      setTimeout(() => chatInput.current?.focus(), 0);
    }, []),
    onTry: useCallback(
      (pin: SoundPin) => {
        setFolded((f) => ({ ...f, chat: false }));
        void chatView.send(tryAnotherPrompt(pin, soundLength), { t: clock.get().t, pick: null, sound: pin });
      },
      [chatView, clock, soundLength],
    ),
    // Typed in the sound panel itself: sent with that stretch of sound.
    onSend: useCallback(
      (pin: SoundPin, words: string) => {
        void chatView.send(words, { t: clock.get().t, pick: null, sound: pin });
      },
      [chatView, clock],
    ),
    running: chatView.turn.running,
  });

  // A film made from a prompt sends that prompt once it's open; one made
  // from footage brings the footage in and lays it on the timeline.
  const sent = useRef(false);
  useEffect(() => {
    if (!film || sent.current) return;
    if (firstPromptRef.current) {
      sent.current = true;
      const prompt = firstPromptRef.current;
      firstPromptRef.current = null;
      // Files attached to the first prompt go in now the film exists.
      const toAttach = firstAttachRef.current;
      firstAttachRef.current = null;
      void (async () => {
        const attachments = toAttach?.length ? await attachFiles(`/api/studio/films/${id}/attachments`, toAttach) : [];
        void chatView.send(prompt, { t: 0, pick: null, ...(attachments.length ? { attachments } : {}) });
      })();
    } else if (firstFilesRef.current && film.kind === "video") {
      sent.current = true;
      const files = firstFilesRef.current;
      firstFilesRef.current = null;
      void ed.importFiles(files, { append: true });
    }
  }, [film, firstPromptRef, firstFilesRef, firstAttachRef, chatView, ed, id]);

  // What's under a click on a video film: the top visible graphic playing
  // now, else the top clip of footage.
  const pickFromEdit = useCallback(
    (at: { x: number; y: number }): Picked => {
      const edit = edRef.current?.edit;
      const now = clock.get().t;
      const none: Picked = { ...at, id: null, tag: null, text: null, rect: null };
      if (!edit) return none;
      const playing = (items: Item[]) => items.find((i) => now >= i.start && now < endOf(i));
      const top = [...edit.tracks].reverse().filter((t) => !t.hidden);
      for (const kind of ["graphics", "video"] as const) {
        for (const track of top.filter((t) => t.kind === kind)) {
          const item = playing(track.items);
          if (!item) continue;
          if (item.type === "graphic") {
            const label = edRef.current?.graphics.find((g) => g.name === item.graphic)?.label ?? item.graphic;
            return { ...none, id: item.id, tag: "graphic", text: label };
          }
          const media = edRef.current?.mediaById.get(item.media);
          const name = `Clip ${clipNumber(edit, item)}`;
          return { ...none, id: item.id, tag: "clip", text: media ? `${name} (${media.name})`.slice(0, 80) : name };
        }
      }
      return none;
    },
    [clock],
  );

  // Words retyped on the film that aren't a text param: swapped in the
  // film's files when they appear there once (kept as a version, so it can
  // be undone), otherwise handed to Claude as a prompt.
  const changeWordsRef = useRef<(from: string, to: string) => Promise<void>>(async () => {});
  useEffect(() => {
    changeWordsRef.current = async (from, to) => {
      const t = clock.get().t;
      const res = await api.words(id, from, to, t).catch(() => ({ result: "ask" as const }));
      if (res.result === "done") reloadStage();
      else await chat.send(`Change the words “${from}” to “${to}”.`, { t, pick: null });
    };
  });
  const changeWords = (from: string, to: string) => changeWordsRef.current(from, to);
  const onStage = useCallback(
    (m: StageOutbound) => {
      switch (m.type) {
        case "studio:ready":
          setStatus({ state: "ready" });
          setTexts(m.texts ?? []);
          if (filmRef.current?.kind === "video") {
            const edit = edRef.current?.edit;
            if (edit) bridge.post({ type: "studio:edit", edit });
          } else {
            clock.setDuration(m.duration);
            bridge.post({ type: "studio:params", params: valuesRef.current });
          }
          bridge.post({ type: "studio:seek", t: clock.get().t });
          break;
        case "studio:loading":
          setStatus({ state: "loading" });
          break;
        case "studio:error":
          setStatus({ state: "error", message: m.message });
          break;
        case "studio:picked": {
          clock.pause();
          const pick = filmRef.current?.kind === "video" ? pickFromEdit(m.pick) : m.pick;
          if (pick.id && filmRef.current?.kind === "video") edRef.current?.setSelected(new Set([pick.id]));
          setPinned({ pick, t: clock.get().t });
          setSoundPin(null);
          setPointing(false);
          setBubble(true);
          break;
        }
        case "studio:param-edit":
          // Handled below, where the saving and ⌘Z live.
          window.dispatchEvent(new CustomEvent(WORDS_EVENT, { detail: { key: m.key, value: m.value, editing: m.editing } }));
          break;
        case "studio:text-editing":
          // Typing into words that aren't a text param: keep the keys there.
          freeWords.current = m.on;
          if (m.on) clock.pause();
          break;
        case "studio:text-edit":
          void changeWords(m.from, m.to);
          break;
        case "studio:param-at":
          // Jump to where the words are on screen, then edit them there.
          clock.pause();
          if (m.t !== null) clock.seek(m.t);
          setTimeout(() => bridge.post({ type: "studio:focus-param", key: m.key }), 60);
          break;
      }
    },
    [bridge, clock, pickFromEdit],
  );

  // Words typed on the film: shown there already, so only remembered and
  // saved here; the finished edit is one step for ⌘Z.
  const wordsBefore = useRef<{ key: string; value: Param["value"] } | null>(null);
  const freeWords = useRef(false);

  // ─── Changes by hand, each one a step for ⌘Z ─────────────────────────────

  // Shows a value on the stage at once and saves it a moment later.
  const pending = useRef<Values>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyParam = useCallback(
    (key: string, value: Param["value"]) => {
      const next = { ...valuesRef.current, [key]: value };
      valuesRef.current = next;
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
    },
    [bridge, id],
  );

  const setParam = (key: string, value: Param["value"]) => {
    const param = film?.params.find((p) => p.key === key);
    const before = valuesRef.current[key] ?? param?.value;
    if (param && before !== undefined && before !== value) {
      history.record({
        label: paramNote(param, value),
        group: `param-${key}`,
        undo: () => {
          const now = valuesRef.current[key];
          applyParam(key, before);
          return () => applyParam(key, now);
        },
      });
    }
    applyParam(key, value);
  };

  const takeWords = useCallback(
    (key: string, value: string, editing: boolean) => {
      const param = filmRef.current?.params.find((p) => p.key === key);
      if (!param) return;
      if (!wordsBefore.current || wordsBefore.current.key !== key) {
        wordsBefore.current = { key, value: valuesRef.current[key] ?? param.value };
        clock.pause();
      }
      const next = { ...valuesRef.current, [key]: value };
      valuesRef.current = next;
      setValues(next);
      pending.current[key] = value;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        const params = pending.current;
        pending.current = {};
        const saved = await api.edit(id, { params }).catch(() => null);
        if (saved) setFilm(saved);
      }, 400);
      if (editing) return;
      const before = wordsBefore.current.value;
      wordsBefore.current = null;
      // Keys go back to the studio (Space plays, ⌘Z undoes) once typing ends.
      if (document.activeElement instanceof HTMLIFrameElement) document.activeElement.blur();
      if (before !== value) {
        history.record({
          label: `${param.label}: “${value.slice(0, 40)}”`,
          group: `words-${key}-${Date.now()}`,
          undo: () => {
            const now = valuesRef.current[key];
            applyParam(key, before);
            return () => applyParam(key, now);
          },
        });
      }
    },
    [applyParam, clock, history, id],
  );
  useEffect(() => {
    const take = (e: Event) => {
      const { key, value, editing } = (e as CustomEvent<{ key: string; value: string; editing: boolean }>).detail;
      takeWords(key, value, editing);
    };
    window.addEventListener(WORDS_EVENT, take);
    // A click on the film that isn't on its words leaves the keys with the
    // studio, so Space and the other shortcuts keep working.
    let later = 0;
    const away = () => {
      window.clearTimeout(later);
      later = window.setTimeout(() => {
        if (!wordsBefore.current && !freeWords.current && document.activeElement instanceof HTMLIFrameElement) document.activeElement.blur();
      }, 150);
    };
    window.addEventListener("blur", away);
    return () => {
      window.removeEventListener(WORDS_EVENT, take);
      window.removeEventListener("blur", away);
      window.clearTimeout(later);
    };
  }, [takeWords]);

  const applySize = useCallback(
    async (width: number, height: number) => {
      const saved = await api.edit(id, { width, height }).catch(() => null);
      if (saved) {
        setFilm(saved);
        setStatus({ state: "loading" });
        setVersion((v) => v + 1);
        void onRefresh();
      }
    },
    [id, onRefresh],
  );

  // The film's brand kit: saved, then the film is drawn afresh in it. A
  // colour setting still at the old kit's accent follows to the new one.
  const applyBrand = useCallback(
    async (brand: string, params?: Record<string, Param["value"]>) => {
      const saved = await api.edit(id, { brand, ...(params ? { params } : {}) }).catch(() => null);
      if (saved) {
        setFilm(saved);
        if (params) setValues((v) => ({ ...v, ...params }));
        setStatus({ state: "loading" });
        setVersion((v) => v + 1);
        void onRefresh();
      }
    },
    [id, onRefresh],
  );
  const setBrand = async (brand: string) => {
    const was = film?.brand ?? "aerchain";
    if (was === brand || !film) return;
    const [from, to] = await Promise.all([brandApi.get(was).catch(() => null), brandApi.get(brand).catch(() => null)]);
    const before: Record<string, Param["value"]> = {};
    const after: Record<string, Param["value"]> = {};
    if (from && to) {
      for (const p of film.params) {
        const v = valuesRef.current[p.key] ?? p.value;
        if (p.type === "color" && String(v).toUpperCase() === from.colors.roles.accent.toUpperCase()) {
          before[p.key] = v;
          after[p.key] = to.colors.roles.accent;
        }
      }
    }
    const moved = Object.keys(after).length > 0;
    history.record({
      label: `Brand kit ${to?.name ?? ""}`.trim(),
      undo: () => {
        void applyBrand(was, moved ? before : undefined);
        return () => void applyBrand(brand, moved ? after : undefined);
      },
    });
    void applyBrand(brand, moved ? after : undefined);
  };

  const setSize = (width: number, height: number) => {
    const was = film ? { w: film.width, h: film.height } : null;
    if (was && (was.w !== width || was.h !== height)) {
      history.record({
        label: `Size ${SIZE_NAMES[`${width}x${height}`] ?? `${width} × ${height}`}`,
        undo: () => {
          const now = filmRef.current;
          void applySize(was.w, was.h);
          return now ? () => void applySize(now.width, now.height) : undefined;
        },
      });
    }
    void applySize(width, height);
  };

  const applyDuration = useCallback(
    async (seconds: number) => {
      setFilm((f) => (f ? { ...f, duration: seconds } : f));
      clock.setDuration(seconds);
      const saved = await api.edit(id, { duration: seconds }).catch(() => null);
      if (saved) {
        setFilm(saved);
        reloadStage();
      }
    },
    [id, clock, reloadStage],
  );

  // A drag of the Length row is one step: back to the length before it.
  const lengthBefore = useRef<number | null>(null);
  const setDuration = async (seconds: number, commit: boolean) => {
    const rounded = Math.round(seconds * 10) / 10;
    if (lengthBefore.current === null) lengthBefore.current = film?.duration ?? rounded;
    setFilm((f) => (f ? { ...f, duration: rounded } : f));
    clock.setDuration(rounded);
    if (!commit) return;
    const before = lengthBefore.current;
    lengthBefore.current = null;
    if (before !== rounded) {
      history.record({
        label: `Length ${rounded.toFixed(1)} s`,
        undo: () => {
          const now = filmRef.current?.duration ?? rounded;
          void applyDuration(before);
          return () => void applyDuration(now);
        },
      });
    }
    await applyDuration(rounded);
  };

  const applyTitle = useCallback(
    async (title: string) => {
      setFilm((f) => (f ? { ...f, title } : f));
      const saved = await api.edit(id, { title }).catch(() => null);
      if (saved) setFilm(saved);
      void onRefresh();
    },
    [id, onRefresh],
  );

  const rename = async (title: string) => {
    const before = film?.title;
    if (before !== undefined && before !== title) {
      history.record({
        label: `Name “${title}”`,
        undo: () => {
          const now = filmRef.current?.title ?? title;
          void applyTitle(before);
          return () => void applyTitle(now);
        },
      });
    }
    await applyTitle(title);
  };

  // Adds to the timeline at the playhead, from the bin.
  const addMediaAtPlayhead = (m: Media) => {
    if (m.status !== "ready") return;
    let made = "";
    ed.change(
      (e) => {
        const r = addMedia(e, m, clock.get().t);
        made = r.id;
        return r.edit;
      },
      { label: `Added ${m.name}` },
    );
    if (made) ed.setSelected(new Set([made]));
  };
  const addGraphicAtPlayhead = (g: GraphicInfo) => {
    let made = "";
    ed.change(
      (e) => {
        const r = addGraphic(e, { name: g.name, duration: g.duration, values: defaults(g) }, clock.get().t);
        made = r.id;
        return r.edit;
      },
      { label: `Added ${g.label.toLowerCase()}` },
    );
    if (made) ed.setSelected(new Set([made]));
  };

  // Words on a motion film are editable on the film whenever it is paused
  // and nothing else (pointing) is using the clicks.
  const playing = useClock(clock, (s) => s.playing);
  const wordsEditable = !playing && !pointing && !isVideo && status.state === "ready";
  useEffect(() => {
    bridge.post({ type: "studio:text", on: wordsEditable });
  }, [bridge, wordsEditable]);
  // From the panel: jump to where those words are on screen and edit them.
  const editWords = useCallback(
    (key: string) => {
      clock.pause();
      bridge.post({ type: "studio:find-param", key });
    },
    [bridge, clock],
  );

  // Sound On | Off and volume: shown at once, saved a moment later, each a
  // step for ⌘Z (a volume drag is one step).
  const soundTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applySound = useCallback(
    (next: FilmSound) => {
      setFilm((f) => (f ? { ...f, sound: next } : f));
      if (soundTimer.current) clearTimeout(soundTimer.current);
      soundTimer.current = setTimeout(() => void soundApi.set(id, next).catch(() => null), 300);
    },
    [id],
  );
  const setSoundOn = (on: boolean) => {
    const before = soundOf(filmRef.current);
    if (before.on === on) return;
    history.record({
      label: `Sound ${on ? "on" : "off"}`,
      undo: () => {
        const now = soundOf(filmRef.current);
        applySound(before);
        return () => applySound(now);
      },
    });
    applySound({ ...before, on });
  };
  const setSoundVolume = (volume: number) => {
    const before = soundOf(filmRef.current);
    const v = Math.round(volume * 100) / 100;
    if (before.volume === v) return;
    history.record({
      label: `Volume ${Math.round(v * 100)}%`,
      group: "sound-volume",
      undo: () => {
        const now = soundOf(filmRef.current);
        applySound(before);
        return () => applySound(now);
      },
    });
    applySound({ ...before, volume: v });
  };

  const togglePoint = useCallback(() => {
    setBubble(false);
    setPointing((p) => {
      if (!p) clock.pause();
      return !p;
    });
  }, [clock]);

  // Keys: Space plays, P points, ⌘K asks, H hides the panels, L loops,
  // arrows step a frame (with Shift, a second), ⌘Z undoes and ⇧⌘Z redoes,
  // Escape backs out.
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      const which = undoKey(e);
      if (which) {
        // In a text field, the browser's own text undo stays in charge.
        if (isTyping(e.target)) return;
        e.preventDefault();
        if (which === "undo") void history.undo();
        else history.redo();
        return;
      }
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
        else if (edRef.current?.selected.size) edRef.current.setSelected(new Set());
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
        case "m":
        case "M":
          // Only listening here: the film's own Sound On | Off is unchanged.
          if (soundRef.current.status.state !== "none") soundRef.current.setMuted(!soundRef.current.muted);
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
  }, [bubble, pointing, pinned, clock, togglePoint, setHidden, film?.fps, history]);

  // Files dragged in from the computer, anywhere on a video film, go to the
  // bin (and onto the timeline when it's still empty).
  useEffect(() => {
    if (!isVideo) return;
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDropping(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDropping(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // Dropped onto a prompt box: those files are attachments, not footage.
      const claimed = e.defaultPrevented;
      e.preventDefault();
      depth = 0;
      setDropping(false);
      if (claimed) return;
      const files = [...(e.dataTransfer?.files ?? [])].filter(isMediaFile);
      const empty = !edRef.current?.edit?.tracks.some((t) => t.items.length);
      if (files.length) {
        setFolded((f) => ({ ...f, media: false }));
        void edRef.current?.importFiles(files, { append: empty });
      }
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [isVideo]);

  // ─── Layout ──────────────────────────────────────────────────────────────

  // Room the panels take; the film fits in the rest. Hidden panels give the
  // film the whole window.
  const tlH = Math.min(Math.max(180, timelineHeight ?? Math.min(300, winH * 0.32)), Math.round(winH * 0.62));
  const chatOpen = !hidden && !folded.chat;
  const mediaOpen = !hidden && !folded.media && isVideo;
  const inspectorOpen = !hidden && !folded.inspector;
  const soundLane: SoundLaneData = {
    status: sound.status,
    peaks: sound.peaks,
    on: sound.sound.on,
    muted: sound.muted,
    error: sound.error,
    onRetry: () => void sound.render(),
    stems: sound.stems,
    present: sound.status.state === "ready" ? sound.status.stems : undefined,
    editor: soundEdit,
  };
  // The motion timeline grows by the sound lane once there is one (two,
  // Music and Effects, once the sound has stems).
  const bottom = isVideo ? tlH + 28 : showStems(soundLane) ? 150 : showLane(soundLane) ? 126 : 96;
  const insets: Insets = hidden
    ? { top: 0, right: 0, bottom: 0, left: 0 }
    : {
        // Folded panels leave a pill under the top bar; keep the film below it.
        top: folded.chat || folded.inspector ? 116 : 72,
        // Both side columns are 300 wide, 16 from the edge, with 16 of air.
        right: inspectorOpen ? COLUMN : 24,
        bottom,
        left: chatOpen || mediaOpen ? COLUMN : 24,
      };
  const fit = useFit(film?.width ?? 1920, film?.height ?? 1080, insets);

  // On a video film the left column holds the chat above the bin, both
  // ending above the timeline.
  // The side columns run to the bottom; the timeline sits between them.
  const column = winH - 68 - 16;
  const binH = folded.chat ? column - 48 : Math.max(180, Math.round(column * 0.44));
  const chatMax = mediaOpen ? Math.max(160, column - binH - 10) : column;

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
  if (!film) return <Opening what="film" />;

  const selection = isVideo && ed.selected.size > 0;

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
        ownPick={isVideo}
        words={!isVideo && texts.length > 0}
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
                  chatView.send(`The film stopped playing with this error: ${status.message}\nFix it.`, { t: time(), pick: null })
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
        {isVideo && ed.edit && !ed.edit.tracks.some((t) => t.items.length) && status.state !== "error" ? (
          <p
            className={cn(CARD, "absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-4 py-2 text-[12.5px] text-white/60")}
            style={{ left: fit.x + fit.width / 2, top: fit.y + fit.height / 2 + 28 }}
          >
            Drop footage anywhere to start
          </p>
        ) : null}
        {bubble ? (
          <Bubble
            filmId={id}
            fit={fit}
            pinned={pinned}
            time={time}
            chat={chatView}
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
      <div
        className="pointer-events-none absolute inset-0"
        style={{ "--above-timeline": `${tlH + 28}px` } as React.CSSProperties}
      >
        <FilmsMenu
          film={film}
          films={films}
          hidden={hidden}
          onOpen={onOpen}
          onHome={onHome}
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
          filmId={id}
          chat={chatView}
          pinned={bubble ? null : pinned}
          sound={soundPin ? { pin: soundPin, label: soundChipLabel(soundPin, soundLength) } : null}
          soundLength={soundLength}
          time={time}
          clock={clock}
          onClearPick={() => {
            setPinned(null);
            setSoundPin(null);
          }}
          pointing={pointing}
          onPoint={togglePoint}
          folded={folded.chat}
          onFold={(f) => setFolded((s) => ({ ...s, chat: f }))}
          hidden={hidden}
          inputRef={chatInput}
          style={isVideo ? { maxHeight: chatMax } : undefined}
        />
        {isVideo ? (
          <MediaBin
            id={id}
            ed={ed}
            onAddMedia={addMediaAtPlayhead}
            onAddGraphic={addGraphicAtPlayhead}
            folded={folded.media}
            onFold={(f) => setFolded((s) => ({ ...s, media: f }))}
            hidden={hidden}
            className="bottom-4 left-4 w-[300px]"
            pillClassName="bottom-4 left-4"
            style={{ height: binH }}
          />
        ) : null}
        {selection ? (
          <EditInspector
            id={id}
            ed={ed}
            filmWidth={film.width}
            filmHeight={film.height}
            folded={folded.inspector}
            onFold={(f) => setFolded((s) => ({ ...s, inspector: f }))}
            hidden={hidden}
            style={{ height: column }}
          />
        ) : (
          <Inspector
            film={film}
            values={values}
            onParam={setParam}
            onWords={isVideo ? undefined : editWords}
            texts={texts}
            onSize={setSize}
            onBrand={setBrand}
            onDuration={setDuration}
            folded={folded.inspector}
            onFold={(f) => setFolded((s) => ({ ...s, inspector: f }))}
            hidden={hidden}
            // The side columns run to the bottom; the timeline sits between them.
            style={{ height: column }}
            editLength={isVideo && ed.edit ? editEnd(ed.edit) : undefined}
            soundGroup={
              <SoundGroup
                sound={sound}
                isVideo={isVideo}
                claudeBusy={chat.turn.running}
                onOn={setSoundOn}
                onVolume={(v) => setSoundVolume(v)}
                onPrompt={(prompt) => {
                  setFolded((f) => ({ ...f, chat: false }));
                  void chatView.send(prompt, { t: time(), pick: null });
                }}
              />
            }
          />
        )}
        {isVideo ? (
          <Multitrack
            id={id}
            clock={clock}
            ed={ed}
            marks={film.marks}
            hidden={hidden}
            height={tlH}
            onHeight={setTimelineHeight}
            onUndo={() => void history.undo()}
            onRedo={history.redo}
            sound={soundLane}
            className="right-4 bottom-4 left-4"
          />
        ) : (
          <Timeline
            clock={clock}
            fps={film.fps}
            marks={film.marks}
            hidden={hidden}
            sound={soundLane}
            onMute={sound.setMuted}
            className="bottom-4 transition-[left,right,opacity,translate,scale,filter]"
            style={{ left: chatOpen || mediaOpen ? COLUMN : 16, right: inspectorOpen ? COLUMN : 16 }}
          />
        )}

        {/* What ⌘Z just did, one line that changes in place. */}
        {history.note ? (
          <p
            key={history.note.key}
            role="status"
            className={cn(
              CARD,
              "absolute flex h-8 -translate-x-1/2 animate-in items-center rounded-full px-3.5 text-[12px] text-white/80 fade-in-0 slide-in-from-bottom-1",
            )}
            style={{ left: fit.x + fit.width / 2, bottom: (hidden ? 16 : bottom) + 12 }}
          >
            {history.note.text}
          </p>
        ) : null}

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

      {dropping ? (
        <div className="pointer-events-none absolute inset-3 z-50 flex items-center justify-center rounded-[20px] border-2 border-white/40 border-dashed bg-black/40 backdrop-blur-[2px]">
          <p className={cn(CARD, "flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] text-white/90")}>
            <UploadUpIcon aria-hidden="true" className="size-4" />
            Drop to add to Media
          </p>
        </div>
      ) : null}
    </>
  );
}
