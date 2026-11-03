"use client";

import { type ReactNode, useState } from "react";
import {
  BookmarkIcon,
  FileIcon,
  FolderIcon,
  HomeIcon,
  LayerThreeIcon,
  MultipleCrossCancelIcon,
  PencilEditIcon,
  PlayCircleIcon,
  PlusIcon,
  SearchIcon,
  VideoCallIcon,
} from "@/components/icons";
import { RenameField } from "@/components/tool/rename";
import { Kbd } from "@/components/ui/kbd";
import { type FilmSummary, type Folder, SIZES } from "@/lib/studio/contract";
import { LIBRARY_DRAG } from "@/lib/studio/references-shared";
import { cn } from "@/lib/utils";
import { StudioMark } from "./doodles";
import { FolderMenu, useSpringOpen } from "./home-parts";
import { cachedLibrary, filesFor } from "./library-api";
import { Hint } from "./panel";
import { PromptBox } from "./prompt-box";
import { useAttachments } from "./use-attachments";

// The home page's next layout, tried beside the current one before it
// replaces it: a sidebar (Home, Library, Brand kits and the folders) and,
// on Home, a prompt that starts a film straight away, with every film below
// on its own stage at its real shape. dashboard.tsx keeps all the state and
// the gestures (dragging films onto folders, library items onto films, ⌘Z);
// these are the parts it draws with.

// /studio?home=next shows it in this tab (and keeps it while the tab visits
// films), /studio?home=old goes back. Only while developing.
const HOME_KEY = "studio:home";
export function useHomeNext() {
  const [next] = useState(() => {
    if (process.env.NODE_ENV === "production" || typeof window === "undefined") return false;
    try {
      const asked = new URLSearchParams(window.location.search).get("home");
      if (asked === "next") window.sessionStorage.setItem(HOME_KEY, "next");
      if (asked === "old") window.sessionStorage.removeItem(HOME_KEY);
      return window.sessionStorage.getItem(HOME_KEY) === "next";
    } catch {
      return false;
    }
  });
  return next;
}

export type Section = "home" | "library" | "kits";
export type Way = "video" | "script" | "reel" | "slides";
type Size = (typeof SIZES)[number];

const ROW =
  "flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-[9px] px-2.5 text-left text-[12.5px] text-white/60 outline-none transition-colors hover:bg-white/[0.05] hover:text-white/90 focus-visible:ring-2 focus-visible:ring-ring [&>svg]:size-[15px] [&>svg]:shrink-0 [&>svg]:text-white/40";
const ROW_ON = "bg-white/[0.08] text-white hover:bg-white/[0.08] [&>svg]:text-white/80";
const COUNT = "ms-auto shrink-0 font-mono text-[11px] text-white/30 tabular-nums";

// ─── The sidebar ─────────────────────────────────────────────────────────

export function SideNav({
  section,
  onSection,
  films,
  library,
  kits,
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
  onRules,
}: {
  section: Section;
  onSection: (s: Section) => void;
  films: number | null;
  library: number | null;
  kits: number | null;
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
  onRules: () => void;
}) {
  return (
    <nav aria-label="Studio" className="flex w-[232px] shrink-0 flex-col gap-4 px-3 pt-3 pb-3 max-[980px]:w-[200px]">
      <div className="group/doodle flex h-9 items-center gap-2.5 px-2">
        <StudioMark />
        <span className="font-medium text-[13px] text-white/90">Motion Studio</span>
      </div>

      {/* biome-ignore lint/a11y/noLabelWithoutControl: the input is inside */}
      <label className="flex h-8 items-center gap-2 rounded-[10px] bg-white/[0.05] ps-2.5 pe-1.5 text-white/40 transition-colors focus-within:bg-white/[0.08] focus-within:ring-1 focus-within:ring-white/15 hover:bg-white/[0.07]">
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
          <Kbd>/</Kbd>
        )}
      </label>

      <ul className="flex flex-col gap-0.5">
        <NavRow
          icon={<HomeIcon aria-hidden="true" />}
          label="Home"
          count={films}
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
          count={library}
          on={section === "library"}
          onClick={() => onSection("library")}
          // Files held here open the library, to drop them in.
          spring={{ type: "Files", onSpring: () => onSection("library") }}
        />
        <NavRow
          icon={<LayerThreeIcon aria-hidden="true" />}
          label="Brand kits"
          count={kits}
          on={section === "kits"}
          onClick={() => onSection("kits")}
        />
      </ul>

      <div className="flex min-h-0 flex-1 flex-col gap-1">
        <div className="flex h-7 items-center ps-2.5 pe-1">
          <span className="me-auto text-[11.5px] text-white/35">Folders</span>
          <Hint label="New folder">
            <button
              type="button"
              aria-label="New folder"
              onClick={() => onNaming(true)}
              className="inline-flex size-6 cursor-pointer items-center justify-center rounded-[7px] text-white/40 outline-none transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"
            >
              <PlusIcon aria-hidden="true" />
            </button>
          </Hint>
        </div>
        <ul aria-label="Folders" className="-mx-1 flex min-h-0 flex-col gap-0.5 overflow-y-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {folders.map((f) => (
            <FolderRow
              key={f.id}
              folder={f}
              count={folderCounts.get(f.id) ?? 0}
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
            <li>
              <RenameField
                value=""
                placeholder="Launch films"
                className="h-8 w-full rounded-[9px] px-2.5 text-[12.5px]"
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
      </div>

      <button type="button" onClick={onRules} className={ROW}>
        <FileIcon aria-hidden="true" />
        Rules for every film
      </button>
    </nav>
  );
}

function NavRow({
  icon,
  label,
  count,
  on,
  onClick,
  drop,
  spring,
}: {
  icon: ReactNode;
  label: string;
  count: number | null;
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
        {count === null ? null : <span className={COUNT}>{count}</span>}
      </button>
    </li>
  );
}

function FolderRow({
  folder,
  count,
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
  count: number;
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
        <RenameField
          value={folder.name}
          className="h-8 w-full rounded-[9px] px-2.5 text-[12.5px]"
          onDone={(name) => {
            setRenaming(false);
            if (name) onRename(name);
          }}
        />
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
            <span className={cn(COUNT, "group-hover/folder:opacity-0 group-focus-within/folder:opacity-0")}>{count}</span>
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

const WAYS: { way: Way; label: string; icon: ReactNode }[] = [
  { way: "video", label: "Edit a video", icon: <PlayCircleIcon aria-hidden="true" /> },
  { way: "script", label: "Write a script", icon: <PencilEditIcon aria-hidden="true" /> },
  { way: "reel", label: "Record a reel", icon: <VideoCallIcon aria-hidden="true" /> },
  { way: "slides", label: "Turn slides into a video", icon: <LayerThreeIcon aria-hidden="true" /> },
];

export function Hero({
  folderName,
  busy,
  error,
  onStart,
  onWay,
  onProblem,
}: {
  folderName: string | null; // the open folder, where the film is filed
  busy: boolean;
  error: string | null;
  onStart: (prompt: string | null, width: number, height: number, files?: File[]) => void;
  onWay: (way: Way) => void;
  onProblem: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
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
          ? `Describe a film and Claude makes it. It goes in ${folderName}.`
          : "Describe a film and Claude makes it, then point at any part of it to change it."}
      </p>

      {/* A library item dropped here comes along with the prompt. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target around the prompt, which is the keyboard way in */}
      <div
        className={cn("mt-8 w-full rounded-[20px] transition-[box-shadow] duration-200", over && "shadow-[0_0_0_2px_rgba(255,255,255,0.35)]")}
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
            onProblem(`Unable to fetch “${entry.name}” from the library. Try again.`);
          }
        }}
      >
        <PromptBox
          value={draft}
          onChange={setDraft}
          onSend={send}
          attachments={attached}
          running={busy}
          maxRows={8}
          placeholder="A 6 second loop: lines rise like a staircase, then the wordmark appears"
          className="min-h-[124px] justify-between rounded-[20px] bg-[#171717] p-2.5 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.07)] has-[:focus-visible]:bg-[#1a1a1a]"
          tools={<SizePicker size={size} onSize={setSize} />}
        />
      </div>
      {error ? <p className="mt-3 self-start px-1 text-[12px] text-[#ff9592] leading-relaxed">{error}</p> : null}

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <span className="me-1 text-[12px] text-white/35">Or</span>
        {WAYS.map((w) => (
          <button
            key={w.way}
            type="button"
            disabled={busy}
            onClick={() => onWay(w.way)}
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-white/[0.05] px-3 text-[12px] text-white/70 outline-none transition-[background-color,color,scale] duration-150 hover:bg-white/[0.09] hover:text-white focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] disabled:opacity-45 [&_svg]:size-3.5 [&_svg]:text-white/50"
          >
            {w.icon}
            {w.label}
          </button>
        ))}
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

// The four film sizes, each drawn in its own shape.
function SizePicker({ size, onSize }: { size: Size; onSize: (s: Size) => void }) {
  return (
    <div role="radiogroup" aria-label="Size" className="flex h-7 items-center gap-0.5 rounded-[9px] bg-white/[0.05] p-0.5">
      {SIZES.map((s) => {
        const on = s.label === size.label;
        const long = Math.max(s.width, s.height);
        return (
          <Hint key={s.label} label={s.label}>
            <button
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={s.label}
              onClick={() => onSize(s)}
              className={cn(
                "flex h-6 cursor-pointer items-center gap-1.5 rounded-[7px] px-2 text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                on ? "bg-white/[0.12] text-white" : "text-white/45 hover:text-white/80",
              )}
            >
              <span
                aria-hidden="true"
                className="rounded-[1.5px] shadow-[inset_0_0_0_1.25px_currentColor] transition-[width,height] duration-200"
                style={{ width: Math.round((s.width / long) * 12), height: Math.round((s.height / long) * 12) }}
              />
              <span className="font-mono tabular-nums">{s.label.split(" ")[1]}</span>
            </button>
          </Hint>
        );
      })}
    </div>
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
      className="relative flex aspect-[16/11] w-full items-center justify-center overflow-hidden rounded-[12px] bg-[#141414] bg-[radial-gradient(rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:14px_14px] transition-colors duration-300 group-hover/card:bg-[#181818]"
      skullet-block=""
    >
      <span
        className="relative overflow-hidden rounded-[6px] bg-[#1d1d1d] shadow-[0_18px_40px_-14px_rgba(0,0,0,0.85),0_2px_8px_rgba(0,0,0,0.45)] transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover/card:-translate-y-[3px] group-hover/card:scale-[1.02] motion-reduce:transition-none"
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
    </span>
  );
}

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
              className="flex h-[92px] w-[128px] items-center justify-center rounded-[10px] bg-[#141414] bg-[radial-gradient(rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:12px_12px]"
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
          Describe one above, or start from footage, a script, a reel or a deck of slides.
        </p>
      </div>
    </div>
  );
}
