"use client";

import { Popover } from "@base-ui/react/popover";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import {
  BookmarkIcon,
  CheckTickCircleIcon,
  ChevronDownIcon,
  FileIcon,
  FolderIcon,
  HomeIcon,
  LayerThreeIcon,
  MultipleCrossCancelIcon,
  PlayCircleIcon,
  PlusIcon,
  SearchIcon,
  SidebarMenuIcon,
  ThreeDObjectCubeIcon,
  BulbOnIcon,
} from "@/components/icons";
import { SURFACE } from "@/components/ui/dial";
import { RenameField } from "@/components/ui/rename";
import { Kbd } from "@/components/ui/kbd";
import { type FilmSummary, type Folder, SIZES } from "@/lib/studio/films/contract";
import { LIBRARY_DRAG } from "@/lib/studio/library/references-shared";
import { cn } from "@/lib/utils";
import { ReelDoodle, ScriptDoodle, SlidesDoodle, VideoDoodle } from "../ui/doodles";
import { FolderMenu, ITEM, MENU_POPUP, useSpringOpen } from "./home-parts";
import { AccountRow } from "../settings/account-panel";
import { cachedLibrary, filesFor } from "../api/library";
import { Hint } from "../ui/panel";
import { PromptBox } from "../chat/prompt-box";
import { useAttachments } from "../chat/use-attachments";

// The studio's home page: a sidebar (Home, Library, Brand kits and the folders) and,
// on Home, a prompt that starts a film straight away, with every film below
// on its own stage at its real shape. dashboard.tsx keeps all the state and
// the gestures (dragging films onto folders, library items onto films, ⌘Z);
// these are the parts it draws with.

export type Section = "home" | "library" | "kits" | "effects" | "ideas" | "rules" | "settings";
export type Way = "video" | "script" | "reel" | "slides";
type Size = (typeof SIZES)[number];

const ROW =
  "flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-[9px] px-2.5 text-left text-[12.5px] text-white/60 outline-none transition-colors hover:bg-white/[0.05] hover:text-white/90 focus-visible:ring-2 focus-visible:ring-ring [&>svg]:size-[15px] [&>svg]:shrink-0 [&>svg]:text-white/40";
const ROW_ON = "bg-white/[0.08] text-white hover:bg-white/[0.08] [&>svg]:text-white/80";
// A folder being named: the same row, its name typed in place, as in Finder.
const NAMING_ROW =
  "flex h-8 w-full items-center gap-2.5 rounded-[9px] bg-white/[0.07] px-2.5 shadow-[inset_0_0_0_1px_rgb(var(--hi)_/_0.18)] [&>svg]:size-[15px] [&>svg]:shrink-0 [&>svg]:text-white/70";
const NAMING_FIELD = "h-6 flex-1 rounded-none bg-transparent px-0 text-[12.5px] ring-0 focus:ring-0";

// ─── The sidebar ─────────────────────────────────────────────────────────

export function SideNav({
  section,
  onSection,
  folders,
  folderId,
  folderCounts,
  filmDrag,
  dragging,
  naming,
  onNaming,
  onNewFolder,
  onFolder,
  onDropFilm,
  onRenameFolder,
  onDeleteFolder,
  deleteBody,
  query,
  onQuery,
  searchRef,
  recent,
  onOpenFilm,
}: {
  section: Section;
  onSection: (s: Section) => void;
  folders: Folder[];
  folderId: string | null;
  folderCounts: Map<string, number>;
  filmDrag: string; // the drag type films carry
  dragging: boolean; // a film is being dragged
  naming: boolean;
  onNaming: (on: boolean) => void;
  onNewFolder: (name: string) => void;
  onFolder: (id: string | null) => void;
  onDropFilm: (filmId: string, folder: string | null) => void;
  onRenameFolder: (folder: Folder, name: string) => void;
  onDeleteFolder: (folder: Folder) => Promise<void>;
  deleteBody: (count: number) => string;
  query: string;
  onQuery: (q: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  recent: Pick<FilmSummary, "id" | "title">[]; // the films last worked on, newest first
  onOpenFilm: (id: string) => void;
}) {
  const [width, setWidth] = useSideWidth();
  const [collapsed, setCollapsed] = useKept("studio:sidebar-collapsed", false);
  const [foldersOpen, setFoldersOpen] = useKept("studio:group-folders", true);
  const [recentOpen, setRecentOpen] = useKept("studio:group-recent", true);
  // Folding glides: the width eases between the sidebar's and a slim rail's
  // (only while folding, so dragging the edge stays direct), the rows fade,
  // and the toggle keeps its place at the header's right, ending in the rail.
  const [gliding, setGliding] = useState(false);
  const fold = (next: boolean) => {
    setGliding(true);
    setCollapsed(next);
    setTimeout(() => setGliding(false), 340);
  };
  return (
    <nav
      aria-label="Studio"
      className={cn(
        "relative flex shrink-0",
        gliding && "transition-[width] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
      )}
      style={{ width: collapsed ? RAIL : width }}
    >
      {/* The edge handle sits outside the clipped layer, so its grip and hint
          can reach over the page. */}
      {collapsed ? null : <WidthHandle width={width} onWidth={setWidth} onCollapse={() => fold(true)} />}
      {/* Its padding and spacing never change, so nothing inside jumps as it
          folds: only the width moves, and this layer clips the rest. */}
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-hidden px-3 pt-3 pb-3">
      <div className="group/doodle flex h-9 shrink-0 items-center gap-2.5" style={{ width: width - 24 }}>
        <span
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden ps-2 transition-opacity duration-200",
            collapsed && "pointer-events-none opacity-0",
          )}
          aria-hidden={collapsed}
        >
          <span className="truncate whitespace-nowrap font-semibold text-[14px] text-white/95 tracking-[-0.01em]">Saymo</span>
        </span>
        {/* Out of sight once folded (the twin in the page's corner takes over). */}
        {collapsed && !gliding ? null : <SideToggle open={!collapsed} onToggle={() => fold(!collapsed)} />}
      </div>
      {/* Folded: the page takes the width, and the toggle waits in its
          top-left corner on a soft square, as it does in the reference. */}
      {collapsed ? (
        <div className="fixed top-[18px] left-[18px] z-30 animate-in fade-in-0 zoom-in-95 duration-200">
          <SideToggle open={false} onToggle={() => fold(false)} square />
        </div>
      ) : null}

      {/* The rest keeps the sidebar's width while it folds, so nothing
          rewraps; it fades and the rail clips it. */}
      <div
        inert={collapsed}
        className={cn("flex min-h-0 flex-1 flex-col gap-4 transition-opacity duration-200", collapsed && "opacity-0")}
        style={{ width: width - 24 }}
      >
      {/* biome-ignore lint/a11y/noLabelWithoutControl: the input is inside */}
      {/* The key cap's right edge lines up with the counts in the rows below. */}
      <label className="flex h-8 items-center gap-2 rounded-[10px] bg-white/[0.05] ps-2.5 pe-2.5 text-white/40 transition-colors focus-within:bg-white/[0.08] focus-within:ring-1 focus-within:ring-white/15 hover:bg-white/[0.07]">
        <SearchIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            onQuery("");
            e.currentTarget.blur();
          }}
          placeholder={section === "library" ? "Search the library" : "Search films"}
          aria-label={section === "library" ? "Search the library" : "Search films"}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-white/90 outline-none placeholder:text-white/35"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              onQuery("");
              searchRef.current?.focus();
            }}
            className="inline-flex size-5 cursor-pointer items-center justify-center rounded-[6px] text-white/45 outline-none hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3"
          >
            <MultipleCrossCancelIcon aria-hidden="true" />
          </button>
        ) : (
          // Down a pixel: more room above the key cap, less below, as it reads.
          <Kbd className="translate-y-px">/</Kbd>
        )}
      </label>

      <ul className="flex flex-col gap-0.5">
        <NavRow
          icon={<HomeIcon aria-hidden="true" />}
          label="Home"
          on={section === "home" && !folderId}
          onClick={() => {
            onSection("home");
            onFolder(null);
          }}
          // A film dropped here leaves its folder; a library item held here opens Home.
          drop={{ type: filmDrag, onDrop: (id) => onDropFilm(id, null) }}
          spring={{ type: LIBRARY_DRAG, onSpring: () => onSection("home") }}
        />
        <NavRow
          icon={<BookmarkIcon aria-hidden="true" />}
          label="Library"
          on={section === "library"}
          onClick={() => onSection("library")}
          // Files held here open the library, to drop them in.
          spring={{ type: "Files", onSpring: () => onSection("library") }}
        />
        <NavRow
          icon={<LayerThreeIcon aria-hidden="true" />}
          label="Brand kits"
          on={section === "kits"}
          onClick={() => onSection("kits")}
        />
        <NavRow
          icon={<ThreeDObjectCubeIcon aria-hidden="true" />}
          label="Effects"
          on={section === "effects"}
          onClick={() => onSection("effects")}
        />
        <NavRow icon={<BulbOnIcon aria-hidden="true" />} label="Ideas" on={section === "ideas"} onClick={() => onSection("ideas")} />
        <NavRow icon={<FileIcon aria-hidden="true" />} label="Rules" on={section === "rules"} onClick={() => onSection("rules")} />
      </ul>

      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex h-7 shrink-0 items-center ps-1 pe-1">
          <GroupToggle label="Folders" open={foldersOpen} onToggle={() => setFoldersOpen(!foldersOpen)} />
          <Hint label="New folder">
            <button
              type="button"
              aria-label="New folder"
              onClick={() => {
                setFoldersOpen(true);
                onNaming(true);
              }}
              className="inline-flex size-6 cursor-pointer items-center justify-center rounded-[7px] text-white/40 outline-none transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"
            >
              <PlusIcon aria-hidden="true" />
            </button>
          </Hint>
        </div>
        <ul aria-label="Folders" className={cn("flex flex-col gap-0.5", !foldersOpen && "hidden")}>
          {folders.map((f) => (
            <FolderRow
              key={f.id}
              folder={f}
              current={section === "home" && folderId === f.id}
              filmDrag={filmDrag}
              dragging={dragging}
              deleteBody={deleteBody(folderCounts.get(f.id) ?? 0)}
              onOpen={() => {
                onSection("home");
                onFolder(f.id);
              }}
              onDrop={(id) => onDropFilm(id, f.id)}
              onRename={(name) => onRenameFolder(f, name)}
              onDelete={() => onDeleteFolder(f)}
            />
          ))}
          {naming ? (
            <li className={NAMING_ROW}>
              <FolderIcon aria-hidden="true" />
              <RenameField
                value=""
                placeholder="New folder"
                className={NAMING_FIELD}
                onDone={(name) => {
                  onNaming(false);
                  if (name) onNewFolder(name);
                }}
              />
            </li>
          ) : folders.length === 0 ? (
            <li className="px-2.5 py-1 text-[11.5px] text-white/30 leading-snug">Drag films onto a folder to file them.</li>
          ) : null}
        </ul>

        {recent.length ? (
          <>
            <div className="mt-2 flex h-7 shrink-0 items-center ps-1 pe-1">
              <GroupToggle label="Recent" open={recentOpen} onToggle={() => setRecentOpen(!recentOpen)} />
            </div>
            <ul aria-label="Recent films" className={cn("flex flex-col gap-0.5", !recentOpen && "hidden")}>
              {recent.map((f) => (
                <li key={f.id}>
                  <button type="button" onClick={() => onOpenFilm(f.id)} className={ROW} title={f.title}>
                    <PlayCircleIcon aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{f.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>

      {/* Settings opens from here, the one way in. */}
      <AccountRow on={section === "settings"} onSettings={() => onSection("settings")} />
      </div>
      </div>
    </nav>
  );
}

const RAIL = 8; // the folded sidebar: just the page's margin (its toggle sits in the page's corner)

// The sidebar's toggle: the panel icon, the same in both states (the
// sidebar's slide is the motion).
function SideToggle({ open, onToggle, square = false }: { open: boolean; onToggle: () => void; square?: boolean }) {
  const label = open ? "Hide the sidebar" : "Show the sidebar";
  return (
    <Hint label={label}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={onToggle}
        className={cn(SIDE_BUTTON, square && "size-8 rounded-[9px] bg-white/[0.06] text-white/60 hover:bg-white/[0.1]")}
      >
        <SidebarMenuIcon aria-hidden="true" />
      </button>
    </Hint>
  );
}

const SIDE_BUTTON =
  "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[8px] text-white/45 outline-none transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4";

// A group's name in the sidebar ("Folders", "Recent"), with a small arrow:
// click to fold the group away or open it again.
function GroupToggle({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="me-auto inline-flex h-6 cursor-pointer items-center gap-1 rounded-[6px] px-1.5 text-[11.5px] text-white/35 outline-none transition-colors hover:text-white/70 focus-visible:ring-2 focus-visible:ring-ring"
    >
      {label}
      <ChevronDownIcon aria-hidden="true" className={cn("size-3 transition-transform duration-200 motion-reduce:transition-none", !open && "-rotate-90")} />
    </button>
  );
}

// A small choice kept on this Mac (a folded group, the folded sidebar).
function useKept(key: string, start: boolean) {
  const [value, setValue] = useState(() => {
    try {
      const kept = window.localStorage.getItem(key);
      return kept === null ? start : kept === "1";
    } catch {
      return start;
    }
  });
  const set = (next: boolean) => {
    setValue(next);
    try {
      window.localStorage.setItem(key, next ? "1" : "0");
    } catch {}
  };
  return [value, set] as const;
}

// The sidebar's width: dragged at its edge, kept on this Mac.
const SIDE_KEY = "studio:sidebar-width";
const SIDE = { min: 184, start: 232, max: 400 };
const clampSide = (w: number) => Math.round(Math.min(SIDE.max, Math.max(SIDE.min, w)));

function useSideWidth() {
  const [width, setWidth] = useState(() => {
    try {
      const kept = Number(window.localStorage.getItem(SIDE_KEY));
      return kept ? clampSide(kept) : SIDE.start;
    } catch {
      return SIDE.start;
    }
  });
  const set = (w: number) => {
    const next = clampSide(w);
    setWidth(next);
    try {
      window.localStorage.setItem(SIDE_KEY, String(next));
    } catch {}
  };
  return [width, set] as const;
}

// The edge between the sidebar and the page: drag it to resize, click it to
// fold the sidebar away (or Enter), or use ← and →. A short bar shows on
// hover, and beside the pointer a small hint: Drag to resize, Click to
// collapse.
function WidthHandle({ width, onWidth, onCollapse }: { width: number; onWidth: (w: number) => void; onCollapse: () => void }) {
  const [drag, setDrag] = useState<{ x: number; w: number; moved: boolean } | null>(null);
  // Where the pointer is along the edge, while it rests there (after a beat).
  const [hint, setHint] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    setHint(null);
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a draggable splitter, which <hr> can't be
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Sidebar width. Drag to resize, click to collapse"
      aria-valuemin={SIDE.min}
      aria-valuemax={SIDE.max}
      aria-valuenow={width}
      tabIndex={0}
      onPointerEnter={(e) => {
        const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setHint(y), 450);
      }}
      onPointerLeave={clear}
      onPointerDown={(e) => {
        clear();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag({ x: e.clientX, w: width, moved: false });
      }}
      onPointerMove={(e) => {
        if (!drag) {
          if (hint !== null) setHint(e.clientY - e.currentTarget.getBoundingClientRect().top);
          return;
        }
        if (!drag.moved && Math.abs(e.clientX - drag.x) < 3) return;
        if (!drag.moved) setDrag({ ...drag, moved: true });
        onWidth(drag.w + e.clientX - drag.x);
      }}
      onPointerUp={() => {
        // A click, not a drag: fold the sidebar away.
        if (drag && !drag.moved) onCollapse();
        setDrag(null);
      }}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCollapse();
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        onWidth(width + (e.key === "ArrowRight" ? 16 : -16));
      }}
      className="group/edge absolute inset-y-0 -right-1 z-10 flex w-2 cursor-col-resize touch-none justify-center outline-none"
    >
      {/* A small grip: a rounded bar with a column of dots, as on the
          sidebar icon's pane. */}
      <span
        aria-hidden="true"
        className={cn(
          "my-auto flex h-7 w-[7px] flex-col items-center justify-center gap-[3px] rounded-full bg-knob opacity-0 shadow-[0_0_0_1px_rgb(var(--hi)_/_0.08)] transition-opacity duration-150 group-hover/edge:opacity-100 group-focus-visible/edge:opacity-100",
          drag && "opacity-100",
        )}
      >
        <span className="size-[2px] rounded-full bg-white/60" />
        <span className="size-[2px] rounded-full bg-white/60" />
        <span className="size-[2px] rounded-full bg-white/60" />
      </span>
      {hint !== null && !drag ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-4 z-20 flex -translate-y-1/2 flex-col gap-0.5 whitespace-nowrap rounded-[9px] bg-popover px-2.5 py-1.5 text-[11.5px] leading-4 shadow-lg shadow-shade/40 ring-1 ring-white/10 animate-in fade-in-0 duration-150"
          style={{ top: hint }}
        >
          <span>
            <span className="text-white/90">Drag</span> <span className="text-white/45">to resize</span>
          </span>
          <span>
            <span className="text-white/90">Click</span> <span className="text-white/45">to collapse</span>
          </span>
        </span>
      ) : null}
    </div>
  );
}

function NavRow({
  icon,
  label,
  on,
  onClick,
  drop,
  spring,
}: {
  icon: ReactNode;
  label: string;
  on: boolean;
  onClick: () => void;
  drop?: { type: string; onDrop: (id: string) => void };
  spring?: { type: string; onSpring: () => void };
}) {
  const [over, setOver] = useState(false);
  const springs = useSpringOpen(spring?.onSpring);
  return (
    <li
      onDragOver={(e) => {
        const takes = drop && e.dataTransfer.types.includes(drop.type);
        const opens = spring && e.dataTransfer.types.includes(spring.type);
        if (!takes && !opens) return;
        e.preventDefault();
        if (takes) {
          e.dataTransfer.dropEffect = "move";
          setOver(true);
        } else springs.arm();
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOver(false);
        springs.disarm();
      }}
      onDrop={(e) => {
        springs.disarm();
        setOver(false);
        if (!drop) return;
        const id = e.dataTransfer.getData(drop.type);
        if (!id) return;
        e.preventDefault();
        drop.onDrop(id);
      }}
    >
      <button type="button" aria-current={on ? "page" : undefined} onClick={onClick} className={cn(ROW, on && ROW_ON, over && "bg-white/[0.1] ring-1 ring-white/30")}>
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
    </li>
  );
}

function FolderRow({
  folder,
  current,
  filmDrag,
  dragging,
  deleteBody,
  onOpen,
  onDrop,
  onRename,
  onDelete,
}: {
  folder: Folder;
  current: boolean;
  filmDrag: string;
  dragging: boolean;
  deleteBody: string;
  onOpen: () => void;
  onDrop: (filmId: string) => void;
  onRename: (name: string) => void;
  onDelete: () => Promise<void>;
}) {
  const [over, setOver] = useState(false);
  const [renaming, setRenaming] = useState(false);
  // A library item held over a folder opens it, to drop the item on a film inside.
  const springs = useSpringOpen(onOpen);
  return (
    <li
      className="group/folder relative"
      onDragOver={(e) => {
        const film = e.dataTransfer.types.includes(filmDrag);
        if (!film && !e.dataTransfer.types.includes(LIBRARY_DRAG)) return;
        e.preventDefault();
        if (film) {
          e.dataTransfer.dropEffect = "move";
          setOver(true);
        } else springs.arm();
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOver(false);
        springs.disarm();
      }}
      onDrop={(e) => {
        springs.disarm();
        setOver(false);
        const id = e.dataTransfer.getData(filmDrag);
        if (!id) return;
        e.preventDefault();
        onDrop(id);
      }}
    >
      {renaming ? (
        <div className={NAMING_ROW}>
          <FolderIcon aria-hidden="true" />
          <RenameField
            value={folder.name}
            className={NAMING_FIELD}
            onDone={(name) => {
              setRenaming(false);
              if (name) onRename(name);
            }}
          />
        </div>
      ) : (
        <>
          <button
            type="button"
            aria-current={current ? "page" : undefined}
            onClick={onOpen}
            className={cn(
              ROW,
              "pe-9",
              current && ROW_ON,
              over ? "bg-white/[0.1] text-white ring-1 ring-white/30" : dragging && "bg-white/[0.025] outline-1 outline-dashed outline-white/15",
            )}
          >
            <FolderIcon aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{folder.name}</span>
          </button>
          <span className="absolute top-1/2 right-0.5 -translate-y-1/2 opacity-0 transition-opacity focus-within:opacity-100 group-hover/folder:opacity-100 has-[[data-popup-open]]:opacity-100">
            <FolderMenu folder={folder} deleteBody={deleteBody} onRename={() => setRenaming(true)} onDelete={onDelete} />
          </span>
        </>
      )}
    </li>
  );
}

// ─── The prompt at the top of Home ──────────────────────────────────────

// The other ways to start, each a tile with its little scene, which plays
// on hover (doodles.tsx).
const WAYS: { way: Way; label: string; note: string; art: ReactNode }[] = [
  { way: "video", label: "Edit a video", note: "Cut footage, add captions", art: <VideoDoodle className="size-full" /> },
  { way: "script", label: "Write a script", note: "A topic becomes beats", art: <ScriptDoodle className="size-full" /> },
  { way: "reel", label: "Record a reel", note: "Read to a prompter", art: <ReelDoodle className="size-full" /> },
  { way: "slides", label: "Slides to video", note: "Your deck, narrated", art: <SlidesDoodle className="size-full" /> },
];

export function Hero({
  folderName,
  initial,
  busy,
  error,
  onStart,
  onWay,
  onProblem,
}: {
  folderName: string | null; // the open folder, where the film is filed
  initial?: string; // a prompt to start from, such as an effect's
  busy: boolean;
  error: string | null;
  onStart: (prompt: string | null, width: number, height: number, files?: File[]) => void;
  onWay: (way: Way) => void;
  onProblem: (text: string) => void;
}) {
  const [draft, setDraft] = useState(initial ?? "");
  const [size, setSize] = useState<Size>(SIZES[0]);
  // Files picked before the film exists; they go in once it does.
  const attached = useAttachments(null);
  const [over, setOver] = useState(false);

  const send = () => {
    const picked = attached.items.filter((a) => !a.error).map((a) => a.file);
    if (!draft.trim() && !picked.length) return;
    onStart(draft.trim() || "Have a look at what I attached.", size.width, size.height, picked);
  };

  return (
    <section aria-labelledby="home-ask" className="mx-auto flex w-full max-w-[720px] flex-col items-center px-6 pt-[clamp(40px,9vh,96px)] pb-12">
      <h1 id="home-ask" className="text-balance text-center font-medium text-[30px] text-white/95 leading-[1.15] tracking-[-0.02em] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-500">
        What are we making today?
      </h1>
      <p className="mt-2.5 text-pretty text-center text-[13px] text-white/45 leading-relaxed">
        {folderName
          ? `Describe a film and Claude makes it in ${folderName}.`
          : "Describe a film and Claude makes it."}
      </p>

      {/* A library item dropped here comes along with the prompt. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target around the prompt, which is the keyboard way in */}
      <div
        className={cn("mt-8 w-full rounded-[20px] transition-[box-shadow] duration-200", over && "shadow-[0_0_0_2px_rgb(var(--hi)_/_0.35)]")}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(LIBRARY_DRAG)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={async (e) => {
          const id = e.dataTransfer.getData(LIBRARY_DRAG);
          setOver(false);
          if (!id) return;
          e.preventDefault();
          const entry = [...(cachedLibrary()?.items ?? []), ...(cachedLibrary()?.brands ?? [])].find((x) => x.id === id);
          if (!entry) return;
          try {
            attached.add(await filesFor(entry));
          } catch {
            onProblem(`Unable to fetch “${entry.name}”. Try again.`);
          }
        }}
      >
        <PromptBox
          value={draft}
          onChange={setDraft}
          onSend={send}
          attachments={attached}
          running={busy}
          glow
          held={over}
          autoFocus={Boolean(initial)}
          maxRows={8}
          placeholder="A 6 second launch teaser for a note-taking app"
          className="min-h-[124px] justify-between rounded-[20px] bg-menu p-2.5 shadow-[0_6px_16px_-8px_rgb(0_0_0_/_calc(0.25*var(--shade))),0_0_0_1px_rgb(var(--hi)_/_0.08)] has-[:focus-visible]:bg-raised"
          tools={<SizePicker size={size} onSize={setSize} />}
        />
      </div>
      {error ? <p className="mt-3 self-start px-1 text-[12px] text-danger leading-relaxed">{error}</p> : null}

      <div className="mt-12 grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
        {WAYS.map((w) => (
          <button
            key={w.way}
            type="button"
            disabled={busy}
            onClick={() => onWay(w.way)}
            className="group/doodle flex cursor-pointer flex-col gap-2 rounded-[14px] p-1.5 text-left outline-none transition-[background-color] duration-200 ease-out hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-45"
          >
            <span className="relative block aspect-video w-full overflow-hidden rounded-[10px] bg-well shadow-[inset_0_0_0_1px_rgb(var(--hi)_/_0.06)]">
              {w.art}
            </span>
            <span className="flex flex-col gap-0.5 px-1 pb-0.5">
              <span className="text-[12.5px] text-white/90">{w.label}</span>
              <span className="text-[11.5px] text-white/40 leading-snug">{w.note}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="mt-3 flex justify-center">
        <button
          type="button"
          disabled={busy}
          onClick={() => onStart(null, size.width, size.height)}
          className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12px] text-white/45 outline-none transition-colors hover:bg-white/[0.05] hover:text-white/80 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-45 [&_svg]:size-3.5"
        >
          <PlusIcon aria-hidden="true" />
          Blank film
        </button>
      </div>
    </section>
  );
}

// The four film sizes, each drawn in its own shape. One highlight slides
// (and stretches) to the picked size, as the studio's other switches do.
function SizePicker({ size, onSize }: { size: Size; onSize: (s: Size) => void }) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [mark, setMark] = useState<{ left: number; width: number } | null>(null);
  const at = Math.max(0, SIZES.findIndex((s) => s.label === size.label));
  useLayoutEffect(() => {
    const place = () => {
      const b = buttons.current[at];
      if (b) setMark({ left: b.offsetLeft, width: b.offsetWidth });
    };
    place();
    // The words' widths settle once the font has loaded.
    void document.fonts?.ready.then(place);
  }, [at]);
  return (
    <div role="radiogroup" aria-label="Size" className="relative flex h-7 items-center gap-0.5 rounded-[9px] bg-white/[0.05] p-0.5">
      {mark ? (
        <span
          aria-hidden="true"
          className="absolute top-0.5 bottom-0.5 left-0 rounded-[7px] bg-white/[0.12] shadow-[0_1px_2px_rgb(0_0_0_/_calc(0.3*var(--shade)))] transition-[transform,width] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
          style={{ width: mark.width, transform: `translateX(${mark.left}px)` }}
        />
      ) : null}
      {SIZES.map((s, i) => {
        const on = s.label === size.label;
        const long = Math.max(s.width, s.height);
        return (
          <Hint key={s.label} label={s.label}>
            <button
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={s.label}
              onClick={() => onSize(s)}
              className={cn(
                "relative flex h-6 cursor-pointer items-center gap-1.5 rounded-[7px] px-2 text-[11.5px] outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring",
                on ? "text-white" : "text-white/45 hover:text-white/80",
                on && !mark && "bg-white/[0.12]",
              )}
            >
              {/* Every shape gets the same 12 px box, so the words start in line. */}
              <span aria-hidden="true" className="flex size-3 shrink-0 items-center justify-center">
                <span
                  className="rounded-[1.5px] shadow-[inset_0_0_0_1.25px_currentColor]"
                  style={{ width: Math.round((s.width / long) * 12), height: Math.round((s.height / long) * 12) }}
                />
              </span>
              <span className="leading-none tabular-nums">{s.label.split(" ")[1]}</span>
            </button>
          </Hint>
        );
      })}
    </div>
  );
}

// ─── The order of the films ─────────────────────────────────────────────

// The order shown as words with a chevron, which opens a short menu, the
// way a file browser shows it.
const ORDERS = [
  ["edited", "Last edited"],
  ["name", "Name"],
] as const;
type Order = (typeof ORDERS)[number][0];

export function SortMenu({ sort, onSort }: { sort: Order; onSort: (s: Order) => void }) {
  const [open, setOpen] = useState(false);
  const label = ORDERS.find(([k]) => k === sort)?.[1] ?? "Last edited";
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={`Sort films, now by ${label.toLowerCase()}`}
        className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-[8px] ps-2 pe-1.5 text-[12px] text-white/55 outline-none transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-white/[0.06] data-popup-open:text-white [&_svg]:size-3.5 [&_svg]:text-white/40"
      >
        {label}
        <ChevronDownIcon aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={12} className="z-50">
          <Popover.Popup className={cn(SURFACE, MENU_POPUP, "flex w-[168px] flex-col")}>
            <p className="ps-[30px] pe-2 pt-1 pb-1 text-[11px] text-white/35">Sort by</p>
            {/* As in a Mac menu: rows light only under the pointer, and a tick marks the order in use. */}
            {ORDERS.map(([k, text]) => (
              <button
                key={k}
                type="button"
                role="menuitemradio"
                aria-checked={sort === k}
                className={cn(ITEM, "min-h-8 gap-2 ps-2", sort === k ? "text-white" : "text-white/65")}
                onClick={() => {
                  onSort(k);
                  setOpen(false);
                }}
              >
                <span aria-hidden="true" className="flex size-3.5 shrink-0 items-center justify-center [&_svg]:size-3.5">
                  {sort === k ? <CheckTickCircleIcon /> : null}
                </span>
                <span className="flex-1 text-left">{text}</span>
              </button>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ─── A film on its stage ─────────────────────────────────────────────────

// Each film stands on a stage of one shape, drawn at its own size inside it,
// so a 9:16 reel and a 16:9 film sit side by side as they really are.
const STAGE = 16 / 11;
const FIT_W = 0.84;
const FIT_H = 0.78;

export function FilmStage({ film }: { film: FilmSummary }) {
  const ratio = film.width / film.height;
  const byHeight = ratio <= STAGE * (FIT_W / FIT_H);
  const width = byHeight ? ((ratio * FIT_H) / STAGE) * 100 : FIT_W * 100;
  const height = byHeight ? FIT_H * 100 : ((FIT_W * STAGE) / ratio) * 100;
  return (
    <span
      className="relative flex aspect-[16/11] w-full items-center justify-center overflow-hidden rounded-[12px] bg-well bg-[radial-gradient(rgb(var(--hi)_/_0.05)_1px,transparent_1px)] bg-[size:14px_14px] transition-colors duration-300 group-hover/card:bg-raised"
      skullet-block=""
    >
      <span
        className="relative overflow-hidden rounded-[6px] bg-raised shadow-[0_18px_40px_-14px_rgb(0_0_0_/_calc(0.85*var(--shade))),0_2px_8px_rgb(0_0_0_/_calc(0.45*var(--shade)))]"
        style={{ width: `${width}%`, height: `${height}%` }}
      >
        {film.poster ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local still of the film
          <img src={film.poster} alt="" draggable={false} className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-white/20 [&_svg]:size-5">
            <PlayCircleIcon aria-hidden="true" />
          </span>
        )}
      </span>
      {/* Its length, in the corner, as on any video. */}
      <span className="absolute right-2 bottom-2 rounded-[6px] bg-black/60 px-1.5 py-0.5 font-medium text-[10.5px] text-white/85 tabular-nums leading-[14px] backdrop-blur-sm">
        {clock(film.duration)}
      </span>
    </span>
  );
}

// 8 s reads "0:08"; 82 s reads "1:22".
const clock = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// "16:9" for a film of that shape, or its pixel size when it's another.
export const shapeOf = (film: Pick<FilmSummary, "width" | "height">) =>
  SIZES.find((s) => s.width === film.width && s.height === film.height)?.label.split(" ")[1] ?? `${film.width}×${film.height}`;

// ─── No films yet ────────────────────────────────────────────────────────

export function EmptyStages() {
  return (
    <div className="flex flex-col items-center gap-5 rounded-[16px] py-10">
      <div className="flex items-end justify-center gap-3" aria-hidden="true">
        {(
          [
            [16, 9],
            [1, 1],
            [9, 16],
          ] as const
        ).map(([w, h]) => {
          const long = Math.max(w, h);
          return (
            <span
              key={`${w}x${h}`}
              className="flex h-[92px] w-[128px] items-center justify-center rounded-[10px] bg-well bg-[radial-gradient(rgb(var(--hi)_/_0.05)_1px,transparent_1px)] bg-[size:12px_12px]"
            >
              <span
                className="rounded-[4px] border border-white/20 border-dashed"
                style={{ width: (w / long) * (w >= h ? 84 : 62), height: (h / long) * (w >= h ? 84 : 62) }}
              />
            </span>
          );
        })}
      </div>
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="font-medium text-[13px] text-white/85">Your films will live here</p>
        <p className="max-w-[340px] text-pretty text-[12px] text-white/45 leading-relaxed">
          Describe one above to get started.
        </p>
      </div>
    </div>
  );
}
