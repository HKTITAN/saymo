"use client";

import { Popover } from "@base-ui/react/popover";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  FileIcon,
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
import { RulesPanel } from "./rules-panel";
import { RenameField } from "@/components/tool/rename";
import { Kbd } from "@/components/ui/kbd";
import type { BrandSummary } from "@/lib/studio/brand";
import type { FilmSummary, Folder } from "@/lib/studio/contract";
import { cn } from "@/lib/utils";
import { api } from "./api";
import { Swatches } from "./brand-row";
import { ClapperDoodle, FolderDoodle, KitsDoodle, MotionDoodle, PosterLines, ReelDoodle, ScriptDoodle, SlidesDoodle, StudioMark, VideoDoodle } from "./doodles";
import { clearNewFilmLink, FirstFilm, readNewFilmLink } from "./first-film";
import { undoKey, useHistory } from "./history";
import { KitMaker } from "./kit-maker";
import { LibraryView } from "./library";
import { cachedLibrary, filesFor } from "./library-api";
import { ago, Confirm, DANGER_ITEM, Empty, everyMinute, FolderCard, FolderChip, FolderMenu, ITEM, MENU_POPUP, thisMinute } from "./home-parts";
import { EmptyStages, FilmStage, Hero, type Section, SideNav, shapeOf, useHomeNext } from "./home-next";
import { CARD, Hint, ICON_BUTTON, PILL_BUTTON } from "./panel";
import { ReelFlow } from "./reel-flow";
import { SlidesFlow } from "./slides-flow";
import { handOff } from "./use-attachments";
import { LIBRARY_DRAG } from "@/lib/studio/references-shared";

// The studio's home page, at /studio. At the top, the ways to start a film
// (edit a video, make motion graphics, write a script, record a reel).
// Below, every film, filed in folders: the row of folders filters the
// grid, and a film moves to a folder by dragging it onto one or from its •••
// menu. ⌘Z undoes moves and renames. Beside Films, the Library (library.tsx,
// also at /studio?library): references saved for any film. A library item
// dragged onto a film card waits in that film's chat; dragged onto "Make
// motion graphics", in the new film's prompt. Last, the brand kits.

type Overlay = null | "video" | "motion" | "kit" | "script" | "reel" | "slides" | "rules";
type Sort = "edited" | "name";
type Tab = "films" | "library";
const tabFromUrl = (): Tab => (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("library") ? "library" : "films");

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
const folderDetail = (films: FilmSummary[], now: number) =>
  films.length ? `${filmCount(films.length)}${films[0] && now ? ` · ${ago(films[0].updatedAt, now)}` : ""}` : "Empty";
const folderDeleteBody = (count: number) =>
  count > 0 ? `Only the folder goes. Its ${filmCount(count)} move back to Films.` : "It’s empty, so only the folder goes.";


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
  onOpenNewFilm,
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
  onStartFilm: (prompt: string | null, width: number, height: number, folder: string | null, attach?: File[]) => void;
  onStartVideo: (files: File[], width: number, height: number, folder: string | null) => void;
  // A film made here (a reel), opened with its first prompt and files to attach.
  onOpenNewFilm: (id: string, prompt: string, attach: File[]) => void;
  onOpenKit: (id: string) => void;
  onNewKit: () => void;
  onImportKit: (file: File) => void;
  onKitMade: (kitId: string, reply: string) => void;
  onKitHidden: (kitId: string | null) => void;
}) {
  // A ?new=<prompt> link opens the new film card with it filled in (first-film.tsx).
  const [link, setLink] = useState(readNewFilmLink);
  const [overlay, setOverlay] = useState<Overlay>(link ? "motion" : null);
  useEffect(() => {
    if (link) clearNewFilmLink();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the link fills the card once, not every time it opens
    if (link && overlay !== "motion") setLink(null);
  }, [link, overlay]);
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [folderId, setFolderId] = useState<string | null>(readFolder);
  const [query, setQuery] = useState("");
  const [tab, setTabState] = useState<Tab>(tabFromUrl);
  const [libCount, setLibCount] = useState<number | null>(null);
  // A library item being dragged, so film cards and "Make motion graphics" take it.
  const [libDrag, setLibDrag] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("edited");
  const [dragging, setDragging] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ text: string; key: number } | null>(null);
  const zip = useRef<HTMLInputElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const now = useSyncExternalStore(everyMinute, thisMinute, () => 0);
  // The next layout (home-next.tsx), tried with /studio?home=next while developing.
  const next = useHomeNext();
  const [kitsOpen, setKitsOpen] = useState(false);
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
  // A film started from here is filed in the open folder, while Films shows.
  const startIn = tab === "films" ? folder : null;
  const folderName = (id: string | null) => (id ? (folders?.find((f) => f.id === id)?.name ?? "a folder") : "Films");

  const say = useCallback((text: string) => setFlash({ text, key: Date.now() }), []);

  // Films or Library, kept in the address (/studio?library) so a reload or
  // a link lands on the same one.
  const setTab = useCallback((next: Tab) => {
    setTabState(next);
    const url = next === "library" ? "/studio?library" : "/studio";
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(null, "", url);
  }, []);
  useEffect(() => {
    const sync = () => setTabState(tabFromUrl());
    window.addEventListener("studio:navigate", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("studio:navigate", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  // A library item dropped on a film: it waits in that film's chat as an
  // attachment. Dropped on "Make motion graphics": in the new film's prompt.
  const takeFromLibrary = async (itemId: string, to: { film: string } | "new") => {
    const entry = [...(cachedLibrary()?.items ?? []), ...(cachedLibrary()?.brands ?? [])].find((e) => e.id === itemId);
    if (!entry) return;
    try {
      const files = await filesFor(entry);
      if (to === "new") {
        handOff(null, files);
        setOverlay("motion");
      } else {
        handOff(`/api/studio/films/${to.film}/attachments`, files);
        onOpenFilm(to.film);
      }
    } catch {
      say(`Unable to fetch “${entry.name}” from the library. Try again.`);
    }
  };
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
    if (overlay === "kit" || overlay === "script" || overlay === "reel" || overlay === "slides") return; // these cards handle their own keys
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

  // ─── The next layout (home-next.tsx), while it's tried beside this one ──
  // Home lists every film, newest first; a folder in the sidebar narrows it.

  const section: Section = kitsOpen ? "kits" : tab === "library" ? "library" : "home";
  const goSection = (s: Section) => {
    setKitsOpen(s === "kits");
    if (s !== "kits") setTab(s === "library" ? "library" : "films");
  };
  const everyFilm =
    films === null
      ? null
      : films
          .filter((f) => (folder ? f.folder === folder.id : true) && (!q || f.title.toLowerCase().includes(q)))
          .sort(sort === "name" ? (a, b) => a.title.localeCompare(b.title) : (a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const nextLayout = next ? (
    <div className="absolute inset-0 flex bg-[#080808]">
      <SideNav
        section={section}
        onSection={goSection}
        films={films ? films.length : null}
        library={libCount}
        kits={kits ? kits.length : null}
        folders={folders ?? []}
        folderId={folder?.id ?? null}
        folderCounts={counts}
        filmDrag={FILM_DRAG}
        dragging={dragging !== null}
        naming={naming}
        onNaming={setNaming}
        onNewFolder={(name) => void newFolder(name)}
        onFolder={goFolder}
        onDropFilm={moveById}
        onRenameFolder={renameFolder}
        onDeleteFolder={deleteFolder}
        deleteBody={folderDeleteBody}
        query={query}
        onQuery={setQuery}
        searchRef={search}
        onRules={() => setOverlay("rules")}
      />
      <div className="relative my-2 me-2 min-w-0 flex-1 overflow-hidden rounded-[18px] bg-[#0e0e0e] shadow-[0_0_0_1px_rgba(255,255,255,0.05)]">
        <div className="absolute inset-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {section === "home" ? (
            <>
              <Hero
                folderName={folder?.name ?? null}
                busy={busy}
                error={error}
                onStart={(prompt, w, h, files) => onStartFilm(prompt, w, h, folder?.id ?? null, files)}
                onWay={(way) => setOverlay(way)}
                onProblem={say}
              />
              <section aria-label={folder ? folder.name : "Films"} className="mx-auto flex max-w-[1180px] flex-col gap-4 px-8 pb-20">
                <header className="flex h-8 items-center gap-2 px-1">
                  <h2 className="truncate font-medium text-[13px] text-white/90">{q ? "Search results" : folder ? folder.name : "Recent"}</h2>
                  {everyFilm ? <span className="font-mono text-[11.5px] text-white/35 tabular-nums">{everyFilm.length}</span> : null}
                  <span className="ms-auto flex items-center gap-3">
                    {dragging ? <span className="text-[11.5px] text-white/45">Drop it on a folder in the sidebar</span> : null}
                    {libDrag ? <span className="text-[11.5px] text-white/45">Drop it on a film to use it in that film’s chat</span> : null}
                    <div role="radiogroup" aria-label="Sort films" className="flex h-7 items-center gap-0.5 rounded-[9px] bg-white/[0.05] ps-2.5 pe-0.5 text-[11.5px]">
                      <span className="me-1 text-white/40">Sort</span>
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
                  </span>
                </header>
                {problem ? <p className="px-1 text-[12px] text-[#ff9592]">{problem}</p> : null}
                <Skeleton data={everyFilm} sample={SAMPLE_FILMS} id="studio-films-next" label="Loading your films">
                  {(list) =>
                    list.length > 0 ? (
                      <ul className="grid grid-cols-[repeat(auto-fill,minmax(244px,1fr))] gap-x-4 gap-y-6">
                        {list.map((f) => (
                          <FilmCard
                            key={f.id}
                            stage
                            film={f}
                            now={now}
                            folders={folders ?? []}
                            folderLabel={!folder && f.folder ? folderName(f.folder) : null}
                            dragged={dragging === f.id}
                            onDrag={(on) => setDragging(on ? f.id : null)}
                            takes={libDrag !== null}
                            onLibraryDrop={(id) => void takeFromLibrary(id, { film: f.id })}
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
                        note="Drag films onto the folder in the sidebar, or choose Move to folder in a film’s ••• menu."
                      >
                        <button type="button" onClick={() => goFolder(null)} className={cn(PILL_BUTTON, "mt-2 bg-white/[0.08] text-white/80 hover:bg-white/[0.12]")}>
                          See all films
                        </button>
                      </Empty>
                    ) : (
                      <EmptyStages />
                    )
                  }
                </Skeleton>
              </section>
            </>
          ) : null}

          <div className={cn("mx-auto flex max-w-[1180px] flex-col gap-4 px-8 pt-8 pb-20", section !== "library" && "hidden")}>
            <LibraryView
              active={section === "library"}
              tabs={<h2 className="px-1 font-medium text-[15px] text-white/90">Library</h2>}
              query={query}
              sort={sort}
              now={now}
              history={history}
              say={say}
              onClearQuery={() => setQuery("")}
              onDragItem={setLibDrag}
              onOpenKit={onOpenKit}
              onCount={setLibCount}
            />
          </div>

          {section === "kits" ? (
            <section aria-labelledby="kits-heading" className="mx-auto flex max-w-[1180px] flex-col gap-5 px-8 pt-8 pb-20">
              <header className="flex flex-wrap items-end gap-2 px-1">
                <div className="me-auto flex flex-col gap-1">
                  <h2 id="kits-heading" className="font-medium text-[15px] text-white/90">
                    Brand kits
                  </h2>
                  <p className="text-[12px] text-white/45">A kit holds a brand’s colours, fonts and logos, so every film made with it looks the part.</p>
                </div>
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
              <Skeleton data={kits} sample={SAMPLE_KITS} id="studio-kits-next" label="Loading your brand kits">
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
                    <Empty doodle={<KitsDoodle className="h-[84px] w-[120px]" />} title="No brand kits yet" note="Make one from a brand’s guideline, links and files, or import one another studio exported." />
                  )
                }
              </Skeleton>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      {nextLayout ?? (
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
                placeholder={tab === "library" ? "Search the library" : "Search films"}
                aria-label={tab === "library" ? "Search the library" : "Search films"}
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
            <button type="button" onClick={() => setOverlay("rules")} className={cn(PILL_BUTTON, "h-8 text-white/65 hover:bg-white/[0.07] hover:text-white")}>
              <FileIcon aria-hidden="true" />
              Rules
            </button>
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
          {/* The ways to start. */}
          <section aria-label="Start a film" className="grid gap-x-3 gap-y-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
            <StartCard
              doodle={<VideoDoodle className="absolute inset-0 h-full w-full" />}
              title="Edit a video"
              note="Cut your footage, photos and music into a film."
              onClick={() => setOverlay("video")}
            />
            <StartCard
              doodle={<MotionDoodle className="absolute inset-0 h-full w-full" />}
              title="Make motion graphics"
              note={libDrag ? "Drop it here to start a film with it." : "Describe a film in a sentence and Claude makes it."}
              onClick={() => setOverlay("motion")}
              onLibraryDrop={(id) => void takeFromLibrary(id, "new")}
              waiting={libDrag !== null}
            />
            <StartCard
              doodle={<ScriptDoodle className="absolute inset-0 h-full w-full" />}
              title="Write a script"
              note="Claude writes it as a storyboard, beat by beat."
              onClick={() => setOverlay("script")}
            />
            <StartCard
              doodle={<ReelDoodle className="absolute inset-0 h-full w-full" />}
              title="Record a reel"
              note="Read your script to camera; the prompter follows your voice."
              onClick={() => setOverlay("reel")}
            />
            <StartCard
              doodle={<SlidesDoodle className="absolute inset-0 h-full w-full" />}
              title="Turn slides into a video"
              note="Bring in a deck; Claude brings each slide to life."
              onClick={() => setOverlay("slides")}
            />
          </section>

          <LibraryView
            active={tab === "library"}
            tabs={<Tabs tab={tab} films={films?.length ?? null} library={libCount} onTab={setTab} />}
            query={query}
            sort={sort}
            now={now}
            history={history}
            say={say}
            onClearQuery={() => setQuery("")}
            onDragItem={setLibDrag}
            onOpenKit={onOpenKit}
            onCount={setLibCount}
          />

          <section aria-label={folder ? folder.name : "Films"} className="flex flex-col gap-3" hidden={tab !== "films"}>
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
                      deleteBody={folderDeleteBody(inView)}
                      onRename={() => setRenamingFolder(true)}
                      onDelete={() => deleteFolder(folder)}
                    />
                  </>
                ) : (
                  <Tabs tab={tab} films={films?.length ?? null} library={libCount} onTab={setTab} />
                )}
                <span className="ms-auto flex items-center gap-2">
                  {dragging ? <span className="text-[11.5px] text-white/45">Drop it on a folder</span> : null}
                  {libDrag ? <span className="text-[11.5px] text-white/45">Drop it on a film to use it in that film’s chat</span> : null}
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
                    dragType={FILM_DRAG}
                    springType={LIBRARY_DRAG}
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
                      dragType={FILM_DRAG}
                      springType={LIBRARY_DRAG}
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
                        pages={inFolder(x.id)}
                        detail={folderDetail(inFolder(x.id), now)}
                        deleteBody={folderDeleteBody(inFolder(x.id).length)}
                        dragType={FILM_DRAG}
                        springType={LIBRARY_DRAG}
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
                        takes={libDrag !== null}
                        onLibraryDrop={(id) => void takeFromLibrary(id, { film: f.id })}
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
      )}

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
        <div
          data-backdrop=""
          className="absolute inset-0 z-40 bg-black/55 backdrop-blur-[2px]"
          // A press on the dimmed space around a card closes it, the same as
          // Esc (cards with typed or dropped things ask first).
          onPointerDown={(e) => {
            if (!(e.target instanceof HTMLElement) || !e.target.hasAttribute("data-backdrop")) return;
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
          }}
        >
          {overlay === "rules" ? (
            <RulesPanel onClose={() => setOverlay(null)} />
          ) : overlay === "kit" ? (
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
          ) : overlay === "slides" ? (
            <SlidesFlow folder={startIn?.id ?? null} onClose={() => setOverlay(null)} onOpenFilm={onOpenNewFilm} />
          ) : overlay === "script" || overlay === "reel" ? (
            <ReelFlow
              start={overlay}
              folder={startIn?.id ?? null}
              onClose={() => setOverlay(null)}
              onStartMotion={(prompt, w, h) => onStartFilm(prompt, w, h, startIn?.id ?? null)}
              onOpenFilm={onOpenNewFilm}
            />
          ) : (
            <>
              <FirstFilm
                key={overlay}
                initialKind={overlay}
                link={overlay === "motion" ? link : null}
                title={startIn ? `New film in ${startIn.name}` : films?.length ? "New film" : "Make your first film"}
                busy={busy}
                error={error}
                onStart={(prompt, w, h, files) => onStartFilm(prompt, w, h, startIn?.id ?? null, files)}
                onStartVideo={(files, w, h) => onStartVideo(files, w, h, startIn?.id ?? null)}
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
function StartCard({
  doodle,
  title,
  note,
  onClick,
  onLibraryDrop,
  waiting = false,
}: {
  doodle: ReactNode;
  title: string;
  note: string;
  onClick: () => void;
  onLibraryDrop?: (itemId: string) => void; // takes a library item dragged onto it
  waiting?: boolean; // one is being dragged
}) {
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onDragOver={
        onLibraryDrop
          ? (e) => {
              if (!e.dataTransfer.types.includes(LIBRARY_DRAG)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              setOver(true);
            }
          : undefined
      }
      onDragLeave={onLibraryDrop ? (e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(false) : undefined}
      onDrop={
        onLibraryDrop
          ? (e) => {
              const id = e.dataTransfer.getData(LIBRARY_DRAG);
              setOver(false);
              if (!id) return;
              e.preventDefault();
              onLibraryDrop(id);
            }
          : undefined
      }
      className={cn(
        "group/doodle flex w-full cursor-pointer flex-col gap-2.5 rounded-[14px] p-1.5 text-left outline-none transition-[background-color,scale] duration-200 ease-out hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]",
        over ? "bg-white/[0.07] ring-1 ring-white/40" : waiting && onLibraryDrop && "bg-white/[0.03] outline-1 outline-dashed outline-white/20",
      )}
    >
      <span className="relative block aspect-video w-full overflow-hidden rounded-[10px] bg-[#141414] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">{doodle}</span>
      <span className="flex flex-col gap-0.5 px-1 pb-0.5">
        <span className="text-[12.5px] text-white/90">{title}</span>
        <span className="text-pretty text-[11.5px] text-white/40 leading-snug">{note}</span>
      </span>
    </button>
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
  stage = false,
  now,
  folders,
  folderLabel,
  dragged,
  onDrag,
  takes,
  onLibraryDrop,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  onMove,
  onMoveNew,
}: {
  film: FilmSummary;
  stage?: boolean; // the next layout: the film on its stage (home-next.tsx)
  now: number;
  folders: Folder[];
  folderLabel: string | null; // the folder it's in, shown in search results
  dragged: boolean;
  onDrag: (on: boolean) => void;
  takes: boolean; // a library item is being dragged
  onLibraryDrop: (itemId: string) => void;
  onOpen: () => void;
  onRename: (title: string) => void;
  onDuplicate: () => Promise<void>;
  onDelete: () => Promise<void>;
  onMove: (folder: string | null) => void;
  onMoveNew: (name: string) => Promise<void>;
}) {
  const [menu, setMenu] = useState(false);
  const [view, setView] = useState<"list" | "delete">("list");
  const [moveOpen, setMoveOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [making, setMaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
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
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(LIBRARY_DRAG)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(LIBRARY_DRAG);
        setOver(false);
        if (!id) return;
        e.preventDefault();
        onLibraryDrop(id);
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${f.title}`}
        className={cn(
          "flex w-full cursor-pointer flex-col gap-2.5 rounded-[14px] p-1.5 text-left outline-none transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring",
          over ? "bg-white/[0.07] ring-1 ring-white/40" : takes && "bg-white/[0.03] outline-1 outline-dashed outline-white/20",
        )}
      >
        {stage ? (
          <FilmStage film={f} />
        ) : (
          <span className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-[10px] bg-[#141414] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]" skullet-block="">
            {f.poster ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local still of the film
              <img src={f.poster} alt="" draggable={false} className="max-h-full max-w-full object-contain transition-transform duration-300 ease-out group-hover/card:scale-[1.02]" />
            ) : (
              <PosterLines width={f.width} height={f.height} />
            )}
          </span>
        )}
        <span className="flex flex-col gap-0.5 px-1 pb-0.5">
          <span className="flex items-baseline gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-[12.5px] text-white/90", renaming && "invisible")}>{f.title}</span>
            <span className="shrink-0 text-[11px] text-white/35" suppressHydrationWarning>
              {now ? ago(f.updatedAt, now) : ""}
            </span>
          </span>
          <span className="truncate text-[11.5px] text-white/40">
            {f.kind === "video" ? "Video edit" : "Motion graphics"} · <span className="font-mono tabular-nums">{f.duration.toFixed(1)}</span>{"\u2009"}s
            {stage ? (
              <>
                {" · "}
                <span className="font-mono tabular-nums">{shapeOf(f)}</span>
              </>
            ) : null}
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
          if (!open) setMoveOpen(false);
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
                  {/* Opens beside the menu, with the folders listed. */}
                  <Popover.Root open={moveOpen} onOpenChange={setMoveOpen}>
                    <Popover.Trigger openOnHover delay={80} className={cn(ITEM, "data-popup-open:bg-white/[0.07] data-popup-open:text-white")}>
                      <FolderIcon aria-hidden="true" />
                      <span className="flex-1 text-left">Move to folder</span>
                      <ChevronRightIcon aria-hidden="true" className="ms-3 !size-3.5 text-white/40" />
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Positioner side="right" align="start" sideOffset={10} alignOffset={-6} collisionPadding={12} className="z-50">
                        <Popover.Popup className={cn(SURFACE, MENU_POPUP, "w-max min-w-[168px] max-w-[260px]")}>
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
                        </Popover.Popup>
                      </Popover.Positioner>
                    </Popover.Portal>
                  </Popover.Root>
                  <div className="mx-2 my-1 h-px bg-white/[0.07]" />
                  <button type="button" className={cn(ITEM, DANGER_ITEM)} onClick={() => setView("delete")}>
                    <DeleteDustbin01Icon aria-hidden="true" />
                    Delete
                  </button>
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

// Films | Library: the two lists on the home page, with a highlight that
// slides to the open one. Hold a library item over Films to switch to it
// and drop the item on a film; drop files on Library to add them.
function Tabs({ tab, films, library, onTab }: { tab: Tab; films: number | null; library: number | null; onTab: (tab: Tab) => void }) {
  const refs = useRef<Record<Tab, HTMLButtonElement | null>>({ films: null, library: null });
  const [mark, setMark] = useState<{ x: number; w: number } | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLayoutEffect(() => {
    const el = refs.current[tab];
    if (el) setMark({ x: el.offsetLeft, w: el.offsetWidth });
  }, [tab, films, library]);
  const springTo = (next: Tab) => {
    if (tab === next || hold.current) return;
    hold.current = setTimeout(() => {
      hold.current = null;
      onTab(next);
    }, 450);
  };
  const cancel = () => {
    if (hold.current) clearTimeout(hold.current);
    hold.current = null;
  };
  return (
    <div role="tablist" aria-label="Films or library" className="relative -ms-1 flex h-8 items-center gap-0.5 rounded-[10px] bg-white/[0.05] p-0.5">
      {mark ? (
        <span
          aria-hidden="true"
          className="absolute top-0.5 bottom-0.5 rounded-[8px] bg-white/[0.12] transition-[left,width] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
          style={{ left: mark.x, width: mark.w }}
        />
      ) : null}
      {(
        [
          ["films", "Films", films],
          ["library", "Library", library],
        ] as const
      ).map(([k, label, count]) => (
        <button
          key={k}
          ref={(el) => {
            refs.current[k] = el;
          }}
          type="button"
          role="tab"
          aria-selected={tab === k}
          onClick={() => onTab(k)}
          onDragOver={(e) => {
            const wants = k === "films" ? e.dataTransfer.types.includes(LIBRARY_DRAG) : e.dataTransfer.types.includes("Files");
            if (!wants) return;
            e.preventDefault();
            springTo(k);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) cancel();
          }}
          onDrop={cancel}
          className={cn(
            "relative z-[1] flex h-7 cursor-pointer items-center gap-1.5 rounded-[8px] px-2.5 font-medium text-[12.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
            tab === k ? "text-white" : "text-white/50 hover:text-white/80",
          )}
        >
          {label}
          {count === null ? null : <span className="font-mono font-normal text-[11px] text-white/35 tabular-nums">{count}</span>}
        </button>
      ))}
    </div>
  );
}
