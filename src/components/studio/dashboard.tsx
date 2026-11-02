"use client";

import { Popover } from "@base-ui/react/popover";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  CopyIcon,
  DeleteDustbin01Icon,
  FolderIcon,
  GridDashboard02Icon,
  MultipleCrossCancelIcon,
  PencilEditIcon,
  PlusIcon,
  SearchIcon,
  ThreeDotsMenuHorizontalIcon,
  UploadUpIcon,
} from "@/components/icons";
import { Skeleton } from "@/components/skeleton";
import { SURFACE } from "@/components/tool/dial";
import { RenameField } from "@/components/tool/rename";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import type { BrandSummary } from "@/lib/studio/brand";
import type { FilmSummary, Folder } from "@/lib/studio/contract";
import { cn } from "@/lib/utils";
import { api } from "./api";
import { Swatches } from "./brand-row";
import { ClapperDoodle, FolderDoodle, KitsDoodle, MotionDoodle, PosterLines, StudioMark, TinyFolder, VideoDoodle } from "./doodles";
import { FirstFilm } from "./first-film";
import { undoKey, useHistory } from "./history";
import { KitMaker } from "./kit-maker";
import { CARD, Hint, ICON_BUTTON, PILL_BUTTON } from "./panel";

// The studio's home page, at /studio. At the top, the two ways to start a
// film. Below, every film, filed in folders: the row of folders filters the
// grid, and a film moves to a folder by dragging it onto one or from its •••
// menu. ⌘Z undoes moves and renames. Last, the brand kits.

type Overlay = null | "video" | "motion" | "kit";
type Sort = "edited" | "name";

// What a dragged film carries, so only films can be dropped on folders.
const FILM_DRAG = "application/x-studio-film";
// The open folder, kept while you visit a film and come back.
const FOLDER_KEY = "studio:folder";

const readFolder = () => {
  try {
    return window.sessionStorage.getItem(FOLDER_KEY);
  } catch {
    return null;
  }
};
const keepFolder = (id: string | null) => {
  try {
    if (id) window.sessionStorage.setItem(FOLDER_KEY, id);
    else window.sessionStorage.removeItem(FOLDER_KEY);
  } catch {}
};

const plural = new Intl.PluralRules("en");
const filmCount = (n: number) => `${n} ${plural.select(n) === "one" ? "film" : "films"}`;

// "3 hours ago", "yesterday": when a film was last changed. The clock moves
// on once a minute.
const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];
const ago = (iso: string, now: number) => {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  for (const [unit, size] of UNITS) if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  return "just now";
};
const everyMinute = (cb: () => void) => {
  const t = setInterval(cb, 30_000);
  return () => clearInterval(t);
};
const thisMinute = () => Math.floor(Date.now() / 60_000) * 60_000;

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");

// What the loading shapes are measured from: a typical row of films and kits.
const SAMPLE_FILMS: FilmSummary[] = Array.from({ length: 4 }, (_, i) => ({
  id: `sample${i}`,
  title: ["Product launch teaser", "Speaker intro", "Quarterly numbers", "Event recap"][i],
  engine: "html",
  kind: "motion",
  width: 1920,
  height: 1080,
  duration: 6,
  updatedAt: "2026-01-01T00:00:00.000Z",
  poster: null,
}));
const SAMPLE_KITS: BrandSummary[] = [0, 1].map((i) => ({
  id: `sample${i}`,
  name: ["Aerchain", "Partner brand"][i],
  font: "Bricolage Grotesque",
  logo: null,
  swatches: ["#1E1E1E", "#D3CCBF", "#F55A00"],
})) as BrandSummary[];

export function Dashboard({
  films,
  kits,
  busy,
  error,
  onOpenFilm,
  onRenameFilm,
  onDuplicateFilm,
  onDeleteFilm,
  onMoveFilm,
  onRefresh,
  onStartFilm,
  onStartVideo,
  onOpenKit,
  onNewKit,
  onImportKit,
  onKitMade,
  onKitHidden,
}: {
  films: FilmSummary[] | null; // null while loading
  kits: BrandSummary[] | null;
  busy: boolean;
  error: string | null;
  onOpenFilm: (id: string) => void;
  onRenameFilm: (id: string, title: string) => Promise<void>;
  onDuplicateFilm: (id: string) => Promise<void>;
  onDeleteFilm: (id: string) => Promise<void>;
  onMoveFilm: (id: string, folder: string | null) => Promise<void>;
  onRefresh: () => Promise<void>;
  onStartFilm: (prompt: string | null, width: number, height: number, folder: string | null) => void;
  onStartVideo: (files: File[], width: number, height: number, folder: string | null) => void;
  onOpenKit: (id: string) => void;
  onNewKit: () => void;
  onImportKit: (file: File) => void;
  onKitMade: (kitId: string, reply: string) => void;
  onKitHidden: (kitId: string | null) => void;
}) {
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [folderId, setFolderId] = useState<string | null>(readFolder);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("edited");
  const [dragging, setDragging] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ text: string; key: number } | null>(null);
  const zip = useRef<HTMLInputElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const now = useSyncExternalStore(everyMinute, thisMinute, () => 0);
  // Moves and renames are undone here; there's no Claude turn to undo.
  const history = useHistory({ undoClaude: async () => "Nothing to undo", claudeBusy: () => false });

  const loadFolders = useCallback(async () => {
    try {
      setFolders(await api.folders());
    } catch {
      setFolders((f) => f ?? []);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first load of the folders
    void loadFolders();
  }, [loadFolders]);

  const goFolder = (id: string | null) => {
    setFolderId(id);
    setRenamingFolder(false);
    keepFolder(id);
  };
  const folder = (folderId && folders?.find((f) => f.id === folderId)) || null;
  const folderName = (id: string | null) => (id ? (folders?.find((f) => f.id === id)?.name ?? "a folder") : "Films");

  const say = (text: string) => setFlash({ text, key: Date.now() });
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2600);
    return () => clearTimeout(t);
  }, [flash]);
  const note = [flash, history.note].filter((n) => n !== null).sort((a, b) => b.key - a.key)[0] ?? null;

  // ─── Films and folders, changed by hand (and undone with ⌘Z) ────────────

  const move = (film: FilmSummary, to: string | null) => {
    const from = film.folder ?? null;
    if (from === to) return;
    void onMoveFilm(film.id, to);
    const label = to ? `Moved “${film.title}” to ${folderName(to)}` : `Took “${film.title}” out of ${folderName(from)}`;
    say(label);
    history.record({
      label,
      undo: () => {
        void onMoveFilm(film.id, from);
        return () => void onMoveFilm(film.id, to);
      },
    });
  };
  const moveById = (id: string, to: string | null) => {
    const film = films?.find((f) => f.id === id);
    if (film) move(film, to);
  };

  const renameFilm = (film: FilmSummary, title: string) => {
    void onRenameFilm(film.id, title);
    history.record({
      label: `Renamed “${film.title}”`,
      undo: () => {
        void onRenameFilm(film.id, film.title);
        return () => void onRenameFilm(film.id, title);
      },
    });
  };

  const newFolder = async (name: string) => {
    setProblem(null);
    try {
      const made = await api.newFolder(name);
      setFolders((list) => [...(list ?? []), made]);
      return made;
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Unable to make the folder. Try again.");
      return null;
    }
  };

  const renameFolder = (target: Folder, name: string) => {
    const apply = (next: string) => {
      setFolders((list) => list?.map((f) => (f.id === target.id ? { ...f, name: next } : f)) ?? null);
      void api.renameFolder(target.id, next).catch(() => loadFolders());
    };
    apply(name);
    history.record({
      label: `Renamed the folder “${target.name}”`,
      undo: () => {
        apply(target.name);
        return () => apply(name);
      },
    });
  };

  const deleteFolder = async (target: Folder) => {
    await api.removeFolder(target.id).catch(() => undefined);
    goFolder(null);
    await Promise.all([loadFolders(), onRefresh()]);
    say(`Deleted the folder “${target.name}”. Its films are back in Films.`);
  };

  // ─── Keys: ⌘Z undoes, / finds a film, Esc closes the new-film card ──────

  useEffect(() => {
    if (overlay === "kit") return; // the kit card handles its own keys
    const onKey = (e: KeyboardEvent) => {
      if (overlay) {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        e.preventDefault();
        setOverlay(null);
        return;
      }
      const which = undoKey(e);
      if (which) {
        if (typing(e.target)) return;
        e.preventDefault();
        if (which === "undo") void history.undo();
        else history.redo();
        return;
      }
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !typing(e.target)) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay, history]);

  // ─── What the grid shows ───────────────────────────────────────────────

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of films ?? []) if (f.folder) m.set(f.folder, (m.get(f.folder) ?? 0) + 1);
    return m;
  }, [films]);
  const q = query.trim().toLowerCase();
  const shown =
    films === null
      ? null
      : films
          .filter((f) => (folder ? f.folder === folder.id : q || !f.folder) && (!q || f.title.toLowerCase().includes(q)))
          .sort(sort === "name" ? (a, b) => a.title.localeCompare(b.title) : (a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const inView = folder ? (counts.get(folder.id) ?? 0) : (films?.length ?? 0);
  // At the top level, folders sit in the grid before the films not in one.
  const folderCards = !folder && !q ? (folders ?? []) : [];
  const inFolder = (id: string) =>
    (films ?? []).filter((f) => f.folder === id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <>
      <div className="absolute inset-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* The studio's name, finding a film, and their order. */}
        <header className="sticky top-0 z-20 bg-[#0b0b0b]/85 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-2 px-6">
            <div className="group/doodle me-auto flex items-center gap-2.5 px-1">
              <StudioMark />
              <h1 className="font-medium text-[13px] text-white/90">Motion studio</h1>
            </div>
            {/* biome-ignore lint/a11y/noLabelWithoutControl: the input is inside */}
            <label className="flex h-8 w-[min(240px,32vw)] items-center gap-2 rounded-[10px] bg-white/[0.05] ps-2.5 pe-1.5 text-white/40 transition-colors focus-within:bg-white/[0.08] focus-within:ring-1 focus-within:ring-white/15 hover:bg-white/[0.07]">
              <SearchIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <input
                ref={search}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Escape") return;
                  e.preventDefault();
                  e.stopPropagation();
                  setQuery("");
                  e.currentTarget.blur();
                }}
                placeholder="Search films"
                aria-label="Search films"
                className="min-w-0 flex-1 bg-transparent text-[12px] text-white/90 outline-none placeholder:text-white/35"
              />
              {query ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => {
                    setQuery("");
                    search.current?.focus();
                  }}
                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded-[6px] text-white/45 outline-none hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3"
                >
                  <MultipleCrossCancelIcon aria-hidden="true" />
                </button>
              ) : (
                <Kbd>/</Kbd>
              )}
            </label>
            <div role="radiogroup" aria-label="Sort films" className="flex h-8 items-center gap-0.5 rounded-[10px] bg-white/[0.05] ps-3 pe-1 text-[12px]">
              <span className="me-1.5 text-white/40">Sort</span>
              {(
                [
                  ["edited", "Last edited"],
                  ["name", "Name"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={sort === k}
                  onClick={() => setSort(k)}
                  className={cn(
                    "h-6 cursor-pointer rounded-[7px] px-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    sort === k ? "bg-white/[0.12] text-white" : "text-white/50 hover:text-white/80",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="mx-auto flex max-w-[1240px] flex-col gap-10 px-6 pt-3 pb-20">
          {/* The two ways to start. */}
          <section aria-label="Start a film" className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-x-3 gap-y-4">
            <StartCard
              doodle={<VideoDoodle className="absolute inset-0 h-full w-full" />}
              title="Edit a video"
              note="Cut your footage, photos and music into a film."
              onClick={() => setOverlay("video")}
            />
            <StartCard
              doodle={<MotionDoodle className="absolute inset-0 h-full w-full" />}
              title="Make motion graphics"
              note="Describe a film in a sentence and Claude makes it."
              onClick={() => setOverlay("motion")}
            />
          </section>

          <section aria-label={folder ? folder.name : "Films"} className="flex flex-col gap-3">
            {/* Stays in reach while you scroll, so films can be dragged onto a folder from anywhere. */}
            <div className="sticky top-16 z-10 -mx-3 flex flex-col gap-2.5 bg-[#0b0b0b]/85 px-3 pt-1 pb-2.5 backdrop-blur-xl">
              <header className="flex h-8 items-center gap-1.5 px-1">
                {folder ? (
                  <>
                    <Hint label="Films">
                      <button type="button" aria-label="Back to all films" onClick={() => goFolder(null)} className={cn(ICON_BUTTON, "-ms-1.5")}>
                        <ArrowLeftIcon aria-hidden="true" />
                      </button>
                    </Hint>
                    {renamingFolder ? (
                      <RenameField
                        value={folder.name}
                        className="h-7 w-[240px] text-[13px]"
                        onDone={(name) => {
                          setRenamingFolder(false);
                          if (name) renameFolder(folder, name);
                        }}
                      />
                    ) : (
                      <h2 className="truncate font-medium text-[13px] text-white/90">{folder.name}</h2>
                    )}
                    <span className="ms-1 font-mono text-[11.5px] text-white/35 tabular-nums">{inView}</span>
                    <FolderMenu
                      folder={folder}
                      count={inView}
                      onRename={() => setRenamingFolder(true)}
                      onDelete={() => deleteFolder(folder)}
                    />
                  </>
                ) : (
                  <>
                    <h2 className="font-medium text-[13px] text-white/90">Films</h2>
                    <span className="ms-1 font-mono text-[11.5px] text-white/35 tabular-nums">{films?.length ?? ""}</span>
                  </>
                )}
                <span className="ms-auto flex items-center gap-2">
                  {dragging ? <span className="text-[11.5px] text-white/45">Drop it on a folder</span> : null}
                  {naming ? (
                    <RenameField
                      value=""
                      placeholder="Launch films"
                      className="h-8 w-[180px] rounded-[10px] px-2.5 text-[12px]"
                      onDone={(name) => {
                        setNaming(false);
                        if (name) void newFolder(name);
                      }}
                    />
                  ) : (
                    <button type="button" onClick={() => setNaming(true)} className={cn(PILL_BUTTON, "text-white/70 hover:bg-white/[0.07] hover:text-white")}>
                      <PlusIcon aria-hidden="true" />
                      New folder
                    </button>
                  )}
                </span>
              </header>

              <ul aria-label="Folders" className="flex flex-wrap items-center gap-1.5">
                <li>
                  <FolderChip
                    label="Films"
                    count={films ? films.length : null}
                    current={!folder}
                    onOpen={() => goFolder(null)}
                    onDrop={(id) => moveById(id, null)}
                  />
                </li>
                {(folders ?? []).map((f) => (
                  <li key={f.id}>
                    <FolderChip
                      label={f.name}
                      count={films ? (counts.get(f.id) ?? 0) : null}
                      current={folder?.id === f.id}
                      folder
                      onOpen={() => goFolder(f.id)}
                      onDrop={(id) => moveById(id, f.id)}
                    />
                  </li>
                ))}
              </ul>
              {problem ? <p className="px-1 text-[12px] text-[#ff9592]">{problem}</p> : null}
            </div>

            <Skeleton data={shown} sample={SAMPLE_FILMS} id="studio-films" label="Loading your films">
              {(list) =>
                list.length > 0 || folderCards.length > 0 ? (
                  <div className="flex flex-col gap-6">
                    {folderCards.length ? (
                      <ul aria-label="Folders" className="grid grid-cols-[repeat(auto-fill,minmax(128px,148px))] gap-x-3 gap-y-4">
                    {folderCards.map((x) => (
                      <FolderCard
                        key={x.id}
                        folder={x}
                        films={inFolder(x.id)}
                        now={now}
                        dragging={dragging !== null}
                        onOpen={() => goFolder(x.id)}
                        onDrop={(id) => moveById(id, x.id)}
                        onRename={(name) => renameFolder(x, name)}
                        onDelete={() => deleteFolder(x)}
                      />
                    ))}
                      </ul>
                    ) : null}
                    {list.length ? (
                      <ul className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-x-3 gap-y-4">
                    {list.map((f) => (
                      <FilmCard
                        key={f.id}
                        film={f}
                        now={now}
                        folders={folders ?? []}
                        folderLabel={!folder && f.folder ? folderName(f.folder) : null /* only while searching */}
                        dragged={dragging === f.id}
                        onDrag={(on) => setDragging(on ? f.id : null)}
                        onOpen={() => onOpenFilm(f.id)}
                        onRename={(title) => renameFilm(f, title)}
                        onDuplicate={() => onDuplicateFilm(f.id)}
                        onDelete={() => onDeleteFilm(f.id)}
                        onMove={(to) => move(f, to)}
                        onMoveNew={async (name) => {
                          const made = await newFolder(name);
                          if (made) move(f, made.id);
                        }}
                      />
                    ))}
                      </ul>
                    ) : null}
                  </div>
                ) : q ? (
                  <Empty doodle={<ClapperDoodle className="h-[84px] w-[120px]" />} title={`No films match “${query.trim()}”`} note="Check the spelling, or search all your films.">
                    <button type="button" onClick={() => setQuery("")} className={cn(PILL_BUTTON, "mt-2 bg-white/[0.08] text-white/80 hover:bg-white/[0.12]")}>
                      Clear search
                    </button>
                  </Empty>
                ) : folder ? (
                  <Empty
                    doodle={<FolderDoodle className="h-[84px] w-[120px]" open={dragging !== null} />}
                    title={`${folder.name} is empty`}
                    note="Drag films onto the folder above, or choose Move to folder in a film’s ••• menu."
                  >
                    <button type="button" onClick={() => goFolder(null)} className={cn(PILL_BUTTON, "mt-2 bg-white/[0.08] text-white/80 hover:bg-white/[0.12]")}>
                      See all films
                    </button>
                  </Empty>
                ) : (
                  <Empty
                    doodle={<ClapperDoodle className="h-[84px] w-[120px]" />}
                    title="No films yet"
                    note="A film is an edit of your own footage, or motion graphics Claude makes from a sentence. Start one above."
                  />
                )
              }
            </Skeleton>
          </section>

          <section aria-labelledby="kits-heading" className="flex flex-col gap-3">
            <header className="flex flex-wrap items-center gap-2 px-1">
              <h2 id="kits-heading" className="me-auto font-medium text-[13px] text-white/90">
                Brand kits
              </h2>
              <input
                ref={zip}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                tabIndex={-1}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onImportKit(file);
                  e.target.value = "";
                }}
              />
              <button type="button" disabled={busy} onClick={() => zip.current?.click()} className={cn(PILL_BUTTON, "text-white/70 hover:bg-white/[0.07] hover:text-white")}>
                <UploadUpIcon aria-hidden="true" />
                Import a kit
              </button>
              <button type="button" disabled={busy} onClick={() => setOverlay("kit")} className={cn(PILL_BUTTON, "bg-white text-[#141414] hover:bg-white/90")}>
                <PlusIcon aria-hidden="true" />
                New kit
              </button>
            </header>
            <Skeleton data={kits} sample={SAMPLE_KITS} id="studio-kits" label="Loading your brand kits">
              {(list) =>
                list.length > 0 ? (
                  <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
                    {list.map((k) => (
                      <li key={k.id}>
                        <KitCard kit={k} onOpen={() => onOpenKit(k.id)} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty
                    doodle={<KitsDoodle className="h-[84px] w-[120px]" />}
                    title="No brand kits yet"
                    note="A kit holds a brand’s colours, fonts and logos, so every film made with it looks the part."
                  >
                    <button type="button" disabled={busy} onClick={() => setOverlay("kit")} className={cn(PILL_BUTTON, "mt-2 bg-white text-[#141414] hover:bg-white/90")}>
                      <PlusIcon aria-hidden="true" />
                      New kit
                    </button>
                  </Empty>
                )
              }
            </Skeleton>
          </section>
          {error ? <p className="px-1 text-[12px] text-[#ff9592] leading-relaxed">{error}</p> : null}
        </div>
      </div>

      {note ? (
        <p
          key={note.key}
          role="status"
          className={cn(
            CARD,
            "pointer-events-none absolute bottom-6 left-1/2 z-30 flex h-8 max-w-[min(560px,90vw)] -translate-x-1/2 animate-in items-center gap-2.5 rounded-full px-3.5 text-[12px] text-white/80 fade-in-0 slide-in-from-bottom-1",
          )}
        >
          <span className="truncate">{note.text}</span>
          {note === flash ? (
            <span className="flex shrink-0 items-center gap-1 text-white/40">
              <Kbd>⌘</Kbd>
              <Kbd>Z</Kbd>
              undoes
            </span>
          ) : null}
        </p>
      ) : null}

      {overlay ? (
        <div className="absolute inset-0 z-40 bg-black/55 backdrop-blur-[2px]">
          {overlay === "kit" ? (
            <KitMaker
              onDone={(kitId, reply) => {
                setOverlay(null);
                onKitMade(kitId, reply);
              }}
              onClose={() => setOverlay(null)}
              onHide={(kitId) => {
                setOverlay(null);
                onKitHidden(kitId);
              }}
              onBlank={() => {
                setOverlay(null);
                onNewKit();
              }}
            />
          ) : (
            <>
              <FirstFilm
                key={overlay}
                initialKind={overlay}
                title={folder ? `New film in ${folder.name}` : films?.length ? "New film" : "Make your first film"}
                busy={busy}
                error={error}
                onStart={(prompt, w, h) => onStartFilm(prompt, w, h, folder?.id ?? null)}
                onStartVideo={(files, w, h) => onStartVideo(files, w, h, folder?.id ?? null)}
              />
              <Hint label="Close" keys={["Esc"]}>
                <button type="button" onClick={() => setOverlay(null)} className={cn(CARD, ICON_BUTTON, "absolute top-4 right-4 size-11 rounded-[14px]")} aria-label="Close">
                  <MultipleCrossCancelIcon aria-hidden="true" />
                </button>
              </Hint>
            </>
          )}
        </div>
      ) : null}
    </>
  );
}

// One way to start a film: a tile the size of a film, its drawing on top
// and what it is below.
function StartCard({ doodle, title, note, onClick }: { doodle: ReactNode; title: string; note: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group/doodle flex w-full cursor-pointer flex-col gap-2.5 rounded-[14px] p-1.5 text-left outline-none transition-[background-color,scale] duration-200 ease-out hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
    >
      <span className="relative block aspect-video w-full overflow-hidden rounded-[10px] bg-[#141414] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">{doodle}</span>
      <span className="flex flex-col gap-0.5 px-1 pb-0.5">
        <span className="text-[12.5px] text-white/90">{title}</span>
        <span className="text-pretty text-[11.5px] text-white/40 leading-snug">{note}</span>
      </span>
    </button>
  );
}

// An empty place, said plainly, with a drawing and the way forward.
function Empty({ doodle, title, note, children }: { doodle: ReactNode; title: string; note: string; children?: ReactNode }) {
  return (
    <div className="group/doodle flex flex-col items-center gap-1.5 rounded-[16px] px-6 py-12 text-center ring-1 ring-white/[0.05]">
      {doodle}
      <p className="mt-3 font-medium text-[13px] text-white/90">{title}</p>
      <p className="max-w-[360px] text-[12px] text-white/45 leading-relaxed">{note}</p>
      {children}
    </div>
  );
}

// A folder in the grid, the size of a film: the films inside peek out as a
// small fanned stack. Drop a film on it to file it; the stack spreads to
// make room while one is dragged over. The ••• menu renames or deletes it.
function FolderCard({
  folder,
  films,
  now,
  dragging,
  onOpen,
  onDrop,
  onRename,
  onDelete,
}: {
  folder: Folder;
  films: FilmSummary[];
  now: number;
  dragging: boolean;
  onOpen: () => void;
  onDrop: (filmId: string) => void;
  onRename: (name: string) => void;
  onDelete: () => Promise<void>;
}) {
  const [over, setOver] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [landed, setLanded] = useState(0); // bumps when a film lands, for a small nod
  const latest = films[0]?.updatedAt;
  return (
    <li
      className="group/card group/doodle relative"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(FILM_DRAG)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(FILM_DRAG);
        setOver(false);
        if (!id) return;
        e.preventDefault();
        setLanded((n) => n + 1);
        onDrop(id);
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open the folder ${folder.name}`}
        className={cn(
          "flex w-full cursor-pointer flex-col gap-2.5 rounded-[14px] p-1.5 text-left outline-none transition-[background-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-ring [&_*]:pointer-events-none",
          over ? "bg-white/[0.07] ring-1 ring-white/40" : dragging ? "bg-white/[0.03] outline-1 outline-dashed outline-white/20" : "hover:bg-white/[0.04]",
        )}
      >
        <span
          key={landed}
          className={cn(
            "relative flex aspect-[4/5] w-full",
            landed > 0 && "motion-safe:animate-[studio-folder-nod_420ms_cubic-bezier(0.23,1,0.32,1)]",
          )}
          skullet-block=""
        >
          <FolderArt films={films} state={over ? "over" : hovered ? "hover" : "rest"} />
        </span>
        <span className="flex flex-col gap-0.5 px-1 pb-0.5">
          <span className={cn("truncate pe-8 text-[12.5px] text-white/90", renaming && "invisible")}>{folder.name}</span>
          <span className="truncate text-[11.5px] text-white/40" suppressHydrationWarning>
            {over ? "Drop to add it here" : films.length ? `${filmCount(films.length)}${latest && now ? ` · ${ago(latest, now)}` : ""}` : "Empty"}
          </span>
        </span>
      </button>

      {renaming ? (
        <RenameField
          value={folder.name}
          className="absolute right-2 bottom-[28px] left-2 h-6 text-[12.5px]"
          onDone={(name) => {
            setRenaming(false);
            if (name) onRename(name);
          }}
        />
      ) : null}

      <div className="absolute right-1.5 bottom-[18px] opacity-0 transition-opacity focus-within:opacity-100 group-hover/card:opacity-100 has-[[data-popup-open]]:opacity-100">
        <FolderMenu folder={folder} count={films.length} onRename={() => setRenaming(true)} onDelete={onDelete} />
      </div>
    </li>
  );
}

// A folder drawn the Windows way, standing up and seen from the side: the
// back with a small tab low on its right, the cover swung open on the left,
// and the films inside standing in it like pages held in the spine.
//
// Three states, one motion: at rest the cover is ajar and the pages barely
// fan; on hover the cover swings open and the pages fan out one after
// another; with a film dragged over it, it opens wide to take it.
type FolderState = "rest" | "hover" | "over";
const PAGE = { w: 58, h: 80 };
const PAGES: Record<FolderState, { skew: number; scale: number; y: number }[]> = {
  rest: [
    { skew: 0, scale: 1, y: 0 },
    { skew: 4, scale: 0.93, y: 1.5 },
    { skew: 8, scale: 0.86, y: 3 },
  ],
  hover: [
    { skew: 0, scale: 1, y: -2 },
    { skew: 13, scale: 0.8, y: 0 },
    { skew: 25, scale: 0.6, y: 2 },
  ],
  over: [
    { skew: 0, scale: 1, y: -4 },
    { skew: 17, scale: 0.74, y: -2 },
    { skew: 31, scale: 0.52, y: 0 },
  ],
};
const COVER: Record<FolderState, number> = { rest: 0.86, hover: 1.18, over: 1.42 };
const PAGE_FILL = ["#3a3a3a", "#454545", "#505050"];
const SPRING = "cubic-bezier(0.23, 1, 0.32, 1)";
function FolderArt({ films, state }: { films: FilmSummary[]; state: FolderState }) {
  const id = useId();
  // Newest film in front; an empty folder holds one blank page.
  const inside: (FilmSummary | null)[] = films.length ? films.slice(0, 3).reverse() : [null];
  const slots = PAGES[state].slice(3 - inside.length);
  const opening = state !== "rest";
  const move = (delay: number) => ({
    transition: `transform ${opening ? 260 : 200}ms ${SPRING} ${opening ? delay : 0}ms`,
  });
  return (
    <svg viewBox="0 0 100 125" aria-hidden="true" className="absolute inset-0 h-full w-full overflow-visible">
      <defs>
        <clipPath id={`${id}-page`}>
          <rect width={PAGE.w} height={PAGE.h} rx={3.5} />
        </clipPath>
        <linearGradient id={`${id}-cover`} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#3d3d3d" />
          <stop offset="1" stopColor="#303030" />
        </linearGradient>
        <filter id={`${id}-soft`} x="-30%" y="-200%" width="160%" height="500%">
          <feGaussianBlur stdDeviation={2.6} />
        </filter>
      </defs>
      <g transform="translate(1 9)">
        {/* One soft shadow on the ground. */}
        <ellipse cx={50} cy={104} rx={38} ry={3.2} fill="rgb(0 0 0 / 0.55)" filter={`url(#${id}-soft)`} />
        {/* The back and its tab. */}
        <path
          d="M19 6.6 H73.7 Q78.7 6.6 78.7 11.6 V59.5 Q78.7 62.5 81 64 L82 64.7 Q84.3 66.2 84.3 69 V90.6 Q84.3 95.6 79.3 95.6 H19 Q14 95.6 14 90.6 V11.6 Q14 6.6 19 6.6 Z"
          fill="#262626"
        />
        {/* The pages, fanned from the spine. */}
        {inside.map((f, i) => {
          const at = slots[i];
          return (
            <g
              key={f?.id ?? "blank"}
              style={{
                transformBox: "view-box",
                transformOrigin: "0 0",
                transform: `translate(16.5px, ${at.y}px) skewY(${at.skew}deg) scaleX(${at.scale})`,
                ...move(i * 22),
              }}
            >
              <rect width={PAGE.w} height={PAGE.h} rx={3.5} fill={PAGE_FILL[PAGE_FILL.length - inside.length + i]} />
              {f?.poster ? (
                <image href={f.poster} width={PAGE.w} height={PAGE.h} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${id}-page)`} opacity={0.9} />
              ) : (
                <>
                  <rect x={7} y={8} width={20} height={2.6} rx={1.3} fill="rgb(255 255 255 / 0.18)" />
                  <rect x={7} y={14} width={30} height={2.6} rx={1.3} fill="rgb(255 255 255 / 0.08)" />
                </>
              )}
              <rect x={0.3} y={0.3} width={PAGE.w - 0.6} height={PAGE.h - 0.6} rx={3.3} fill="none" stroke="rgb(255 255 255 / 0.06)" strokeWidth={0.6} />
            </g>
          );
        })}
        {/* The cover, swung open toward you. */}
        <g
          style={{
            transformBox: "view-box",
            transformOrigin: "14px 60px",
            transform: `scaleX(${COVER[state]})`,
            ...move(0),
          }}
        >
          <path
            d="M14 10 Q14 5.5 17.6 8.2 L35 21.6 Q37.8 23.8 37.8 27.3 V107.6 Q37.8 113.4 33.6 110.4 L17.4 98.6 Q14 96.2 14 92 Z"
            fill={`url(#${id}-cover)`}
            stroke="rgb(255 255 255 / 0.07)"
            strokeWidth={0.6}
          />
        </g>
      </g>
    </svg>
  );
}

// A folder in the row: opens it, and takes films dropped on it.
function FolderChip({
  label,
  count,
  current,
  folder = false,
  onOpen,
  onDrop,
}: {
  label: string;
  count: number | null; // null while the films load
  current: boolean;
  folder?: boolean;
  onOpen: () => void;
  onDrop: (filmId: string) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={current ? "true" : undefined}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(FILM_DRAG)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(FILM_DRAG);
        setOver(false);
        if (!id) return;
        e.preventDefault();
        onDrop(id);
      }}
      className={cn(
        // Its insides never take the pointer, so a drag over them stays a drag over the folder.
        "group/doodle inline-flex h-8 cursor-pointer items-center gap-2 rounded-[10px] px-2.5 text-[12px] outline-none transition-[background-color,color,box-shadow,scale] duration-150 focus-visible:ring-2 focus-visible:ring-ring [&_*]:pointer-events-none",
        over
          ? "scale-[1.04] bg-[#F55A00]/12 text-white ring-1 ring-[#F55A00]/70"
          : current
            ? "bg-white/[0.12] text-white"
            : "bg-white/[0.04] text-white/60 hover:bg-white/[0.07] hover:text-white/85",
      )}
    >
      {folder ? (
        <TinyFolder open={over} current={current} />
      ) : (
        <GridDashboard02Icon className="size-3.5 opacity-70" aria-hidden="true" />
      )}
      <span className="max-w-[180px] truncate">{label}</span>
      {count === null ? null : <span className="font-mono text-[11px] text-white/35 tabular-nums">{count}</span>}
    </button>
  );
}

const MENU_POPUP =
  "flex origin-(--transform-origin) flex-col p-1 outline-none transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0";

const ITEM =
  "flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-[9px] px-2 pe-3 text-left text-[12.5px] text-white/80 outline-none transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:bg-white/[0.07] disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-white/50";
const DANGER_ITEM = "text-[#ff9592] hover:bg-[#e5484d]/12 hover:text-[#ffaaa8] [&>svg]:text-[#ff9592]";

// Asks before something can't be undone: what goes, what stays, two answers.
function Confirm({
  title,
  body,
  action,
  busy,
  onYes,
  onNo,
}: {
  title: string;
  body: string;
  action: string;
  busy: boolean;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 p-2">
      <p className="font-medium text-[13px] text-white/90">{title}</p>
      <p className="text-[12px] text-white/50 leading-relaxed">{body}</p>
      <div className="mt-1 flex gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={onYes}
          className="inline-flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[9px] bg-[#e5484d] font-medium text-[12px] text-white outline-none transition-colors hover:bg-[#ec5d5e] focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          {busy ? <Spinner className="size-3" /> : null}
          {action}
        </button>
        <button
          type="button"
          onClick={onNo}
          className="inline-flex h-8 flex-1 cursor-pointer items-center justify-center rounded-[9px] bg-white/[0.08] font-medium text-[12px] text-white/80 outline-none transition-colors hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-ring"
        >
          Keep it
        </button>
      </div>
    </div>
  );
}

// The open folder's ••• menu: rename it, or delete it (its films stay).
function FolderMenu({ folder, count, onRename, onDelete }: { folder: Folder; count: number; onRename: () => void; onDelete: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setAsking(false);
      }}
    >
      <Hint label="Folder options">
        <Popover.Trigger aria-label={`Options for ${folder.name}`} className={cn(ICON_BUTTON, "data-popup-open:bg-white/[0.08]")}>
          <ThreeDotsMenuHorizontalIcon aria-hidden="true" />
        </Popover.Trigger>
      </Hint>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={12} className="z-50">
          <Popover.Popup className={cn(SURFACE, MENU_POPUP, asking ? "w-[256px]" : "w-max min-w-[148px]")}>
            {asking ? (
              <Confirm
                title={`Delete the folder “${folder.name}”?`}
                body={
                  count > 0
                    ? `Only the folder goes. Its ${filmCount(count)} move back to Films.`
                    : "It’s empty, so only the folder goes."
                }
                action="Delete folder"
                busy={busy}
                onNo={() => setAsking(false)}
                onYes={async () => {
                  setBusy(true);
                  try {
                    await onDelete();
                    setOpen(false);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            ) : (
              <>
                <button
                  type="button"
                  className={ITEM}
                  onClick={() => {
                    setOpen(false);
                    onRename();
                  }}
                >
                  <PencilEditIcon aria-hidden="true" />
                  Rename
                </button>
                <button type="button" className={cn(ITEM, DANGER_ITEM)} onClick={() => setAsking(true)}>
                  <DeleteDustbin01Icon aria-hidden="true" />
                  Delete folder
                </button>
              </>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

// A kit as a card: its logo on its own surface, its colours as lines.
function KitCard({ kit, onOpen }: { kit: BrandSummary; onOpen: () => void }) {
  const [background, surface] = kit.swatches;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full cursor-pointer flex-col gap-2 rounded-[14px] p-1.5 text-left outline-none transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        className="flex aspect-[16/9] w-full flex-col overflow-hidden rounded-[10px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
        style={{ background: surface }}
        skullet-block=""
      >
        <span className="flex flex-1 items-center justify-center p-6">
          {kit.logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- the kit's own logo file
            <img src={kit.logo} alt="" className="max-h-9 max-w-[70%] object-contain" />
          ) : (
            <span className="text-[13px]" style={{ color: kit.swatches[2] }}>
              {kit.name}
            </span>
          )}
        </span>
        {/* The kit's colours as a run of lines, like the line field. */}
        <span className="flex h-9 flex-col justify-end gap-[3px] px-0 pb-0" style={{ background }} aria-hidden="true">
          {kit.swatches.map((c, i) => (
            <span key={`${c}-${i}`} className="h-[5px]" style={{ background: c, marginLeft: `${i * 18}%` }} />
          ))}
        </span>
      </span>
      <span className="flex items-center gap-2 px-1 pb-0.5">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[12.5px] text-white/90">{kit.name}</span>
          <span className="truncate text-[11.5px] text-white/40">{kit.font ?? "No fonts yet"}</span>
        </span>
        <Swatches colors={kit.swatches} className="h-4" />
      </span>
    </button>
  );
}

// One film on the home page: its still (or its shape in lines until it has
// one), its name, when it last changed and how long it runs. It can be
// dragged onto a folder. The ••• menu, shown on hover, renames, duplicates,
// moves or deletes it; deleting asks first.
function FilmCard({
  film: f,
  now,
  folders,
  folderLabel,
  dragged,
  onDrag,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  onMove,
  onMoveNew,
}: {
  film: FilmSummary;
  now: number;
  folders: Folder[];
  folderLabel: string | null; // the folder it's in, shown in search results
  dragged: boolean;
  onDrag: (on: boolean) => void;
  onOpen: () => void;
  onRename: (title: string) => void;
  onDuplicate: () => Promise<void>;
  onDelete: () => Promise<void>;
  onMove: (folder: string | null) => void;
  onMoveNew: (name: string) => Promise<void>;
}) {
  const [menu, setMenu] = useState(false);
  const [view, setView] = useState<"list" | "move" | "delete">("list");
  const [renaming, setRenaming] = useState(false);
  const [making, setMaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    try {
      await job();
      setMenu(false);
    } finally {
      setBusy(false);
    }
  };
  const here = folders.find((x) => x.id === f.folder) ?? null;

  return (
    <li
      className={cn("group/card relative transition-opacity duration-150", dragged && "opacity-40")}
      draggable={!renaming}
      onDragStart={(e) => {
        e.dataTransfer.setData(FILM_DRAG, f.id);
        e.dataTransfer.effectAllowed = "move";
        onDrag(true);
      }}
      onDragEnd={() => onDrag(false)}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${f.title}`}
        className="flex w-full cursor-pointer flex-col gap-2.5 rounded-[14px] p-1.5 text-left outline-none transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-[10px] bg-[#141414] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]" skullet-block="">
          {f.poster ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local still of the film
            <img src={f.poster} alt="" draggable={false} className="max-h-full max-w-full object-contain transition-transform duration-300 ease-out group-hover/card:scale-[1.02]" />
          ) : (
            <PosterLines width={f.width} height={f.height} />
          )}
        </span>
        <span className="flex flex-col gap-0.5 px-1 pb-0.5">
          <span className="flex items-baseline gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-[12.5px] text-white/90", renaming && "invisible")}>{f.title}</span>
            <span className="shrink-0 text-[11px] text-white/35" suppressHydrationWarning>
              {now ? ago(f.updatedAt, now) : ""}
            </span>
          </span>
          <span className="truncate text-[11.5px] text-white/40">
            {f.kind === "video" ? "Video edit" : "Motion graphics"} · <span className="font-mono tabular-nums">{f.duration.toFixed(1)} s</span>
            {folderLabel ? ` · ${folderLabel}` : null}
          </span>
        </span>
      </button>

      {renaming ? (
        // Over the card's own name, so typing doesn't open the film.
        <RenameField
          value={f.title}
          className="absolute right-2 bottom-[28px] left-2 h-6 text-[12.5px]"
          onDone={(next) => {
            setRenaming(false);
            if (next) onRename(next);
          }}
        />
      ) : null}

      <Popover.Root
        open={menu}
        onOpenChange={(open) => {
          setMenu(open);
          if (open) {
            setView("list");
            setMaking(false);
          }
        }}
      >
        <Hint label="More">
          <Popover.Trigger
            aria-label={`More for ${f.title}`}
            className="absolute top-3.5 right-3.5 inline-flex size-7 cursor-pointer items-center justify-center rounded-[8px] bg-black/55 text-white/85 opacity-0 outline-none backdrop-blur-md transition-opacity hover:bg-black/70 hover:text-white focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/card:opacity-100 data-popup-open:opacity-100 [&_svg]:size-4"
          >
            <ThreeDotsMenuHorizontalIcon aria-hidden="true" />
          </Popover.Trigger>
        </Hint>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={12} className="z-50">
            <Popover.Popup className={cn(SURFACE, MENU_POPUP, view === "delete" ? "w-[248px]" : "w-max min-w-[156px] max-w-[260px]")}>
              {view === "list" ? (
                <>
                  <button
                    type="button"
                    className={ITEM}
                    onClick={() => {
                      setMenu(false);
                      setRenaming(true);
                    }}
                  >
                    <PencilEditIcon aria-hidden="true" />
                    Rename
                  </button>
                  <button type="button" className={ITEM} disabled={busy} onClick={() => run(onDuplicate)}>
                    <CopyIcon aria-hidden="true" />
                    Duplicate
                  </button>
                  <button type="button" className={ITEM} onClick={() => setView("move")}>
                    <FolderIcon aria-hidden="true" />
                    Move to folder
                  </button>
                  <div className="mx-2 my-1 h-px bg-white/[0.07]" />
                  <button type="button" className={cn(ITEM, DANGER_ITEM)} onClick={() => setView("delete")}>
                    <DeleteDustbin01Icon aria-hidden="true" />
                    Delete
                  </button>
                </>
              ) : view === "move" ? (
                <>
                  <button type="button" className={cn(ITEM, "text-white/50")} onClick={() => setView("list")}>
                    <ChevronLeftIcon aria-hidden="true" />
                    Move to folder
                  </button>
                  <div className="mx-2 my-1 h-px bg-white/[0.07]" />
                  {here ? (
                    <button
                      type="button"
                      className={ITEM}
                      onClick={() => {
                        setMenu(false);
                        onMove(null);
                      }}
                    >
                      <GridDashboard02Icon aria-hidden="true" />
                      <span className="truncate">Take out of {here.name}</span>
                    </button>
                  ) : null}
                  {folders.map((x) => (
                    <button
                      key={x.id}
                      type="button"
                      className={ITEM}
                      disabled={x.id === f.folder}
                      onClick={() => {
                        setMenu(false);
                        onMove(x.id);
                      }}
                    >
                      <FolderIcon aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{x.name}</span>
                      {x.id === f.folder ? <span className="shrink-0 text-[11.5px] text-white/40">In it now</span> : null}
                    </button>
                  ))}
                  {making ? (
                    <RenameField
                      value=""
                      placeholder="Launch films"
                      className="m-1 h-8 min-w-[180px] text-[12.5px]"
                      onDone={(name) => {
                        setMaking(false);
                        if (name) void run(() => onMoveNew(name));
                      }}
                    />
                  ) : (
                    <button type="button" className={ITEM} onClick={() => setMaking(true)}>
                      <PlusIcon aria-hidden="true" />
                      New folder
                    </button>
                  )}
                </>
              ) : (
                <Confirm
                  title={`Delete “${f.title}”?`}
                  body="This removes the film, its chat with Claude and its videos. You can’t undo this."
                  action="Delete film"
                  busy={busy}
                  onYes={() => run(onDelete)}
                  onNo={() => setView("list")}
                />
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </li>
  );
}
