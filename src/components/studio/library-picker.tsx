"use client";

import { Popover } from "@base-ui/react/popover";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookmarkIcon, CheckTickCircleIcon, ChevronLeftIcon, LinkChainHorizontalIcon, MusicBeamNoteIcon, PaperclipVerticalIcon, SearchIcon, UploadUpIcon } from "@/components/icons";
import { SURFACE } from "@/components/tool/dial";
import { KIND_NAME, type LibraryList, type RefEntry } from "@/lib/studio/references-shared";
import { cn } from "@/lib/utils";
import { StudioError } from "./api";
import { ITEM, MENU_POPUP } from "./home-parts";
import { cachedLibrary, filesFor, libraryApi, openLibrary } from "./library-api";
import { Hint } from "./panel";
import { type Attachments, clockText as formatTime } from "./use-attachments";

// The paperclip in every prompt box: a small menu with "Upload files" and
// "From the library". The library side lists what's saved there (recent
// first, by folder, or the brand kits) with a search; picking an item
// attaches it exactly like a file from Finder: it's fetched, handed to the
// box's attachments and uploaded into the film's refs/ (or the kit's
// guide/). A clip comes in as four stills, a note or link as a short text
// file, a sound as itself (where the box takes sounds).

type Place = "recent" | "brands" | string;

export function AttachMenu({ attachments, onUpload }: { attachments: Attachments; onUpload: () => void }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"menu" | "library">("menu");
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setView("menu");
      }}
    >
      <Hint label="Attach files">
        <Popover.Trigger
          aria-label="Attach files"
          className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[8px] text-white/55 outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-white/[0.08] data-popup-open:text-white [&_svg]:size-4"
        >
          <PaperclipVerticalIcon aria-hidden="true" />
        </Popover.Trigger>
      </Hint>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8} collisionPadding={12} className="z-50">
          <Popover.Popup className={cn(SURFACE, MENU_POPUP, view === "menu" ? "w-max" : "w-[340px] max-w-[calc(100vw-24px)] p-1.5")}>
            {view === "menu" ? (
              <>
                <button
                  type="button"
                  className={ITEM}
                  onClick={() => {
                    setOpen(false);
                    onUpload();
                  }}
                >
                  <UploadUpIcon aria-hidden="true" />
                  Upload files…
                </button>
                <button type="button" className={ITEM} onClick={() => setView("library")}>
                  <BookmarkIcon aria-hidden="true" />
                  From the library
                </button>
              </>
            ) : (
              <LibraryPicker attachments={attachments} onBack={() => setView("menu")} onClose={() => setOpen(false)} />
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function LibraryPicker({ attachments, onBack, onClose }: { attachments: Attachments; onBack: () => void; onClose: () => void }) {
  const [list, setList] = useState<LibraryList | null>(cachedLibrary);
  const [query, setQuery] = useState("");
  const [place, setPlace] = useState<Place>("recent");
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    void libraryApi
      .list()
      .then((l) => live && setList(l))
      .catch(() => live && setList((l) => l ?? { items: [], folders: [], brands: [] }));
    search.current?.focus();
    return () => {
      live = false;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!list) return [];
    const hit = (e: RefEntry) => !q || [e.name, e.note, e.site ?? "", e.brand?.name ?? "", ...e.tags].some((s) => s.toLowerCase().includes(q));
    const own = [...list.items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (q) return [...own, ...list.brands].filter(hit).slice(0, 60);
    if (place === "recent") return own.slice(0, 30);
    if (place === "brands") return list.brands;
    return own.filter((e) => e.folder === place);
  }, [list, q, place]);

  const pick = async (entry: RefEntry) => {
    if (busy) return;
    setProblem(null);
    setBusy(entry.id);
    try {
      const files = await filesFor(entry);
      attachments.add(files);
      setPicked((s) => new Set(s).add(entry.id));
    } catch (e) {
      setProblem(e instanceof StudioError ? e.message : `Unable to attach ${entry.name}. Try again.`);
    } finally {
      setBusy(null);
    }
  };

  const places: [Place, string][] = list
    ? [["recent", "Recent"], ...list.folders.map((f): [Place, string] => [f.id, f.name]), ...(list.brands.length ? [["brands", "Brand kits"] as [Place, string]] : [])]
    : [];
  const empty = list !== null && !list.items.length && !list.brands.length;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <Hint label="Back">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[9px] text-white/55 outline-none hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4"
          >
            <ChevronLeftIcon aria-hidden="true" />
          </button>
        </Hint>
        {/* biome-ignore lint/a11y/noLabelWithoutControl: the input is inside */}
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[9px] bg-white/[0.05] px-2.5 text-white/40 focus-within:bg-white/[0.08]">
          <SearchIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <input
            ref={search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the library"
            aria-label="Search the library"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-white/90 outline-none placeholder:text-white/35"
          />
        </label>
      </div>
      {!q && places.length > 1 ? (
        <div className="flex flex-wrap gap-1 px-0.5" role="radiogroup" aria-label="Show">
          {places.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={place === id}
              onClick={() => setPlace(id)}
              className={cn(
                "h-6 max-w-[140px] cursor-pointer truncate rounded-[7px] px-2 text-[11.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                place === id ? "bg-white/[0.12] text-white" : "text-white/50 hover:bg-white/[0.05] hover:text-white/80",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex max-h-[300px] flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {list === null ? (
          <p className="px-2 py-3 text-[12px]">
            <span className="studio-shimmer">Loading the library</span>
          </p>
        ) : empty ? (
          <div className="flex flex-col items-start gap-2 px-2 py-3">
            <p className="font-medium text-[12.5px] text-white/85">Your library is empty</p>
            <p className="text-[12px] text-white/50 leading-relaxed">Save pictures, clips and links there first.</p>
            <button
              type="button"
              onClick={() => {
                onClose();
                openLibrary();
              }}
              className="mt-1 inline-flex h-7 cursor-pointer items-center rounded-[8px] bg-white/[0.08] px-2.5 font-medium text-[12px] text-white/85 outline-none hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-ring"
            >
              Open the library
            </button>
          </div>
        ) : shown.length ? (
          shown.map((e) => {
            const blocked = e.kind === "audio" && !attachments.audio;
            const done = picked.has(e.id);
            return (
              <button
                key={e.id}
                type="button"
                disabled={blocked || busy !== null}
                onClick={() => void pick(e)}
                className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-[9px] px-1.5 py-1 text-left outline-none transition-colors hover:bg-white/[0.07] focus-visible:bg-white/[0.07] disabled:cursor-default disabled:hover:bg-transparent"
              >
                <Thumb entry={e} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={cn("truncate text-[12px]", blocked ? "text-white/40" : "text-white/85")}>{e.name}</span>
                  <span className="truncate text-[11px] text-white/40">
                    {busy === e.id ? (
                      <span className="studio-shimmer">Attaching</span>
                    ) : blocked ? (
                      "Sounds go in a film’s prompts"
                    ) : (
                      <>
                        {e.brand ? e.brand.name : KIND_NAME[e.kind]}
                        {e.kind === "video" ? (
                          <>
                            {e.duration ? <> · <span className="tabular-nums">{formatTime(e.duration)}</span></> : null} · comes in as {e.attach.length} stills
                          </>
                        ) : e.kind === "audio" && e.duration ? (
                          <> · <span className="tabular-nums">{formatTime(e.duration)}</span></>
                        ) : e.kind === "link" && e.site ? (
                          ` · ${e.site}`
                        ) : null}
                      </>
                    )}
                  </span>
                </span>
                {done ? <CheckTickCircleIcon aria-label="Attached" className="size-4 shrink-0 text-white/60" /> : null}
              </button>
            );
          })
        ) : (
          <p className="px-2 py-3 text-[12px] text-white/45">
            {q ? `Nothing matches “${query.trim()}”.` : place === "recent" ? "Nothing saved yet." : "This folder is empty."}
          </p>
        )}
      </div>
      {problem ? <p className="px-1.5 text-[11.5px] text-danger leading-relaxed">{problem}</p> : null}
    </div>
  );
}

function Thumb({ entry: e }: { entry: RefEntry }) {
  if (e.thumbUrl) {
    return (
      <span className={cn("flex h-8 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-white/[0.06]", e.ground === "light" && "bg-[#e9e6e0]")}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a local picture of the item */}
        <img src={e.thumbUrl} alt="" className="max-h-full max-w-full object-contain" />
      </span>
    );
  }
  return (
    <span className="flex h-8 w-10 shrink-0 items-center justify-center rounded-[6px] bg-white/[0.06] text-white/45 [&_svg]:size-3.5">
      {e.kind === "audio" ? (
        <MusicBeamNoteIcon aria-hidden="true" />
      ) : e.kind === "link" ? (
        <LinkChainHorizontalIcon aria-hidden="true" />
      ) : (
        <span className="font-medium text-[9.5px] uppercase tracking-[0.04em]">{KIND_NAME[e.kind]}</span>
      )}
    </span>
  );
}
