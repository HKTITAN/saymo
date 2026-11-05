"use client";

import { Popover } from "@base-ui/react/popover";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ChevronRightIcon,
  CopyIcon,
  DeleteDustbin01Icon,
  FolderIcon,
  GridDashboard02Icon,
  MultipleCrossCancelIcon,
  PencilEditIcon,
  PlusIcon,
  ThreeDotsMenuHorizontalIcon,
  UploadUpIcon,
} from "@/components/icons";
import { Skeleton } from "@/components/skeleton";
import { SURFACE } from "@/components/tool/dial";
import { RulesPage } from "./rules-panel";
import { RenameField } from "@/components/tool/rename";
import { Kbd } from "@/components/ui/kbd";
import type { BrandSummary } from "@/lib/studio/brand";
import type { FilmSummary, Folder } from "@/lib/studio/contract";
import { cn } from "@/lib/utils";
import { api } from "./api";
import { Swatches } from "./brand-row";
import { ClapperDoodle, FolderDoodle, KitsDoodle, PosterLines } from "./doodles";
import { clearNewFilmLink, FirstFilm, readNewFilmLink } from "./first-film";
import { undoKey, useHistory } from "./history";
import { KitMaker } from "./kit-maker";
import { NewKitMenu, PersonalStyleMaker } from "./personal-style";
import { LibraryView } from "./library";
import { cachedLibrary, filesFor } from "./library-api";
import { ago, Confirm, DANGER_ITEM, Empty, everyMinute, FolderCard, ITEM, MENU_POPUP, thisMinute } from "./home-parts";
import { EffectsPage } from "./effects";
import { IdeasPage } from "./ideas-page";
import { EmptyStages, FilmStage, Hero, type Section, SideNav, SortMenu } from "./home";
import { SettingsPage } from "./settings-page";
import { CARD, Hint, ICON_BUTTON, PILL_BUTTON } from "./panel";
import { EdgeBeam } from "./edge-beam";
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

type Overlay = null | "video" | "motion" | "kit" | "personal" | "script" | "reel" | "slides";
type Sort = "edited" | "name";
type Tab = "films" | "library";
const tabFromUrl = (): Tab => (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("library") ? "library" : "films");
// Brand kits, Effects, Rules and Settings, kept in the address too
// (/studio?settings), so a reload or a link lands on the same page.
type Aside = null | "kits" | "effects" | "ideas" | "rules" | "settings";
const ASIDES = ["kits", "effects", "ideas", "rules", "settings"] as const;
const asideFromUrl = (): Aside => {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  return ASIDES.find((a) => q.has(a)) ?? null;
};

const wayFromUrl = (): Overlay => {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  return (["reel", "script", "slides"] as const).find((w) => q.has(w)) ?? null;
};

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
  // A ?new=<prompt> link opens the new film card with it filled in (first-film.tsx);
  // ?reel, ?script or ?slides opens that way in.
  const [link, setLink] = useState(readNewFilmLink);
  const [overlay, setOverlay] = useState<Overlay>(() => (link ? "motion" : wayFromUrl()));
  useEffect(() => {
    if (link) clearNewFilmLink();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the link fills the card once, not every time it opens
    if (link && overlay !== "motion") setLink(null);
  }, [link, overlay]);
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [folderId, setFolderId] = useState<string | null>(readFolder);
  const [query, setQuery] = useState("");
  const [tab, setTabState] = useState<Tab>(tabFromUrl);
  const [, setLibCount] = useState<number | null>(null);
  // A library item being dragged, so film cards and "Make motion graphics" take it.
  const [libDrag, setLibDrag] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("edited");
  const [dragging, setDragging] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ text: string; key: number } | null>(null);
  const zip = useRef<HTMLInputElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const now = useSyncExternalStore(everyMinute, thisMinute, () => 0);
  const [aside, setAsideState] = useState<Aside>(asideFromUrl);
  // A prompt for Home's box, from an effect or an idea picked; its key starts the box afresh.
  const [seed, setSeed] = useState<{ text: string; key: number } | null>(null);
  // A reel idea from the Ideas page, as the reel card's topic.
  const [reelIdea, setReelIdea] = useState<string | null>(null);
  const setAside = useCallback((next: Aside) => {
    setAsideState(next);
    if (!next) return;
    const url = `/studio?${next}`;
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(null, "", url);
  }, []);
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
    const sync = () => {
      setTabState(tabFromUrl());
      setAsideState(asideFromUrl());
    };
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
    if (overlay === "kit" || overlay === "personal" || overlay === "script" || overlay === "reel" || overlay === "slides") return; // these cards handle their own keys
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
  const inFolder = (id: string) =>
    (films ?? []).filter((f) => f.folder === id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  // ─── The home page (its parts are in home.tsx) ───────────────────────────
  // Home lists every film, newest first; a folder in the sidebar narrows it.

  const section: Section = aside ?? (tab === "library" ? "library" : "home");
  const goSection = (s: Section) => {
    setAside(s === "kits" || s === "effects" || s === "ideas" || s === "rules" || s === "settings" ? s : null);
    if (s === "home" || s === "library") setTab(s === "library" ? "library" : "films");
  };
  const everyFilm =
    films === null
      ? null
      : films
          .filter((f) => (folder ? f.folder === folder.id : true) && (!q || f.title.toLowerCase().includes(q)))
          .sort(sort === "name" ? (a, b) => a.title.localeCompare(b.title) : (a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const nextLayout = (
    <div className="absolute inset-0 flex bg-[#080808]">
      <SideNav
        section={section}
        onSection={goSection}
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
        recent={(films ?? []).slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4)}
        onOpenFilm={onOpenFilm}
      />
      <div className="relative my-2 me-2 min-w-0 flex-1 overflow-hidden rounded-[18px] bg-[#0e0e0e] shadow-[0_0_0_1px_rgba(255,255,255,0.05)]">
        <div className="absolute inset-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {section === "home" ? (
            <>
              <Hero
                key={seed?.key ?? 0}
                initial={seed?.text}
                folderName={folder?.name ?? null}
                busy={busy}
                error={error}
                onStart={(prompt, w, h, files) => onStartFilm(prompt, w, h, folder?.id ?? null, files)}
                onWay={(way) => setOverlay(way)}
                onProblem={say}
              />
              {/* The folders, as on the old home: drop a film on one to file it. */}
              {!folder && !q && folders?.length ? (
                <section aria-labelledby="home-folders" className="mx-auto flex max-w-[1180px] flex-col gap-3 px-8 pb-8">
                  <header className="flex h-8 items-center gap-2 px-1">
                    <h2 id="home-folders" className="font-medium text-[13px] text-white/90">
                      Folders
                    </h2>
                    <span className="text-[12px] text-white/35 tabular-nums">{folders.length}</span>
                  </header>
                  <ul aria-label="Folders" className="grid grid-cols-[repeat(auto-fill,minmax(128px,148px))] gap-x-3 gap-y-4">
                    {folders.map((x) => (
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
                </section>
              ) : null}
              <section aria-label={folder ? folder.name : "Films"} className="mx-auto flex max-w-[1180px] flex-col gap-4 px-8 pb-20">
                <header className="flex h-8 items-center gap-2 px-1">
                  <h2 className="truncate font-medium text-[13px] text-white/90">{q ? "Search results" : folder ? folder.name : "Recent"}</h2>
                  {everyFilm ? <span className="text-[12px] text-white/35 tabular-nums">{everyFilm.length}</span> : null}
                  <span className="ms-auto flex items-center gap-3">
                    {dragging ? <span className="text-[11.5px] text-white/45">Drop it on a folder</span> : null}
                    {libDrag ? <span className="text-[11.5px] text-white/45">Drop it on a film to use it in that film’s chat</span> : null}
                    <SortMenu sort={sort} onSort={setSort} />
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

          <div className={cn("mx-auto flex max-w-[1180px] flex-col gap-4 px-8 pt-10 pb-20", section !== "library" && "hidden")}>
            <LibraryView
              active={section === "library"}
              tabs={
                <div className="flex flex-col gap-1.5 px-1 pb-3">
                  <h1 className="font-medium text-[20px] text-white/95 tracking-[-0.01em]">Library</h1>
                  <p className="text-[12.5px] text-white/50">Pictures, clips, sounds, notes and links, ready to add to any prompt.</p>
                </div>
              }
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
            <section aria-labelledby="kits-heading" className="mx-auto flex max-w-[1180px] flex-col gap-5 px-8 pt-10 pb-20">
              <header className="flex flex-wrap items-end gap-2 px-1">
                <div className="me-auto flex flex-col gap-1.5">
                  <h1 id="kits-heading" className="font-medium text-[20px] text-white/95 tracking-[-0.01em]">
                    Brand kits
                  </h1>
                  <p className="text-[12.5px] text-white/50">A kit holds a brand’s colours, fonts and logos, so every film made with it looks the part.</p>
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
                <NewKitMenu busy={busy} onPick={(way) => setOverlay(way === "personal" ? "personal" : "kit")} />
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
                    <Empty doodle={<KitsDoodle className="h-[84px] w-[120px]" />} title="No brand kits yet" note="Make one from your own style or a brand’s guideline, or import one another studio exported." />
                  )
                }
              </Skeleton>
            </section>
          ) : null}

          {section === "effects" ? (
            <EffectsPage
              onUse={(text) => {
                setSeed({ text, key: Date.now() });
                goSection("home");
              }}
            />
          ) : null}
          {section === "ideas" ? (
            <IdeasPage
              onMake={(idea) => {
                if (idea.kind === "reel") {
                  setReelIdea(idea.text);
                  setOverlay("reel");
                  return;
                }
                setSeed({ text: idea.kind === "demo" ? `A product demo: ${idea.text}` : `A video: ${idea.text}`, key: Date.now() });
                goSection("home");
              }}
            />
          ) : null}
          {section === "rules" ? <RulesPage /> : null}
          {section === "settings" ? <SettingsPage /> : null}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {nextLayout}

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
          {overlay === "personal" ? (
            <PersonalStyleMaker
              onDone={(kit) => {
                setOverlay(null);
                onKitMade(kit.id, "");
              }}
              onClose={() => setOverlay(null)}
            />
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
              idea={overlay === "reel" ? (reelIdea ?? undefined) : undefined}
              onClose={() => {
                setOverlay(null);
                setReelIdea(null);
              }}
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
  stage?: boolean; // the film on its stage (home.tsx)
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
          "relative flex w-full cursor-pointer flex-col gap-2.5 rounded-[14px] p-1.5 text-left outline-none transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring",
          over ? "bg-white/[0.07] ring-1 ring-white/40" : takes && "bg-white/[0.03] outline-1 outline-dashed outline-white/20",
        )}
      >
        {stage ? (
          <FilmStage film={f} />
        ) : (
          <span className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-[10px] bg-[#141414] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]" skullet-block="">
            {f.poster ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local still of the film
              <img src={f.poster} alt="" draggable={false} className="max-h-full max-w-full object-contain" />
            ) : (
              <PosterLines width={f.width} height={f.height} />
            )}
          </span>
        )}
        {/* A warm light rides the card's edge while a library item is held over it. */}
        <EdgeBeam on={over} tone="drop" />
        {/* The name, then when it was last edited (and its folder); the
            preview shows its shape and its length. */}
        <span className="flex flex-col gap-0.5 px-0.5 pb-1">
          <span className={cn("truncate text-[13px] text-white/90 leading-[18px]", renaming && "invisible")}>{f.title}</span>
          <span className="truncate text-[12px] text-white/40 leading-4" suppressHydrationWarning>
            {f.kind === "video" ? "Video edit, edited " : "Edited "}
            {now ? ago(f.updatedAt, now) : "\u00a0"}
            {folderLabel ? ` in ${folderLabel}` : ""}
          </span>
        </span>
      </button>

      {renaming ? (
        // Over the card's own name, so typing doesn't open the film.
        <RenameField
          value={f.title}
          className="absolute right-1 bottom-[23px] left-1 h-6 text-[13px]"
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
