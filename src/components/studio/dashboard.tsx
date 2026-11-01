"use client";

import { Popover } from "@base-ui/react/popover";
import { useEffect, useRef, useState } from "react";
import {
  CopyIcon,
  DeleteDustbin01Icon,
  MultipleCrossCancelIcon,
  PencilEditIcon,
  PlusIcon,
  ThreeDotsMenuHorizontalIcon,
  UploadUpIcon,
} from "@/components/icons";
import { RenameField } from "@/components/tool/rename";
import { SURFACE } from "@/components/tool/dial";
import { Spinner } from "@/components/ui/spinner";
import type { BrandSummary } from "@/lib/studio/brand";
import type { FilmSummary } from "@/lib/studio/contract";
import { cn } from "@/lib/utils";
import { Swatches } from "./brand-row";
import { FirstFilm } from "./first-film";
import { KitMaker } from "./kit-maker";
import { CARD, Hint, ICON_BUTTON, PILL_BUTTON } from "./panel";

// The studio's front page, at /studio: every film, and every brand kit.
// A film opens in the studio; a kit opens on its own page, where it can be
// changed by hand or by Claude. New films start from the same two ways as
// before (edit a video, or describe motion graphics).

type Overlay = null | "film" | "kit";

export function Dashboard({
  films,
  kits,
  busy,
  error,
  onOpenFilm,
  onRenameFilm,
  onDuplicateFilm,
  onDeleteFilm,
  onStartFilm,
  onStartVideo,
  onOpenKit,
  onNewKit,
  onImportKit,
  onKitMade,
  onKitHidden,
}: {
  films: FilmSummary[];
  kits: BrandSummary[] | null;
  busy: boolean;
  error: string | null;
  onOpenFilm: (id: string) => void;
  onRenameFilm: (id: string, title: string) => Promise<void>;
  onDuplicateFilm: (id: string) => Promise<void>;
  onDeleteFilm: (id: string) => Promise<void>;
  onStartFilm: (prompt: string | null, width: number, height: number) => void;
  onStartVideo: (files: File[], width: number, height: number) => void;
  onOpenKit: (id: string) => void;
  onNewKit: () => void;
  onImportKit: (file: File) => void;
  onKitMade: (kitId: string, reply: string) => void;
  onKitHidden: (kitId: string | null) => void;
}) {
  const [overlay, setOverlay] = useState<Overlay>(films.length ? null : "film");
  const zip = useRef<HTMLInputElement>(null);

  // Esc closes the new-film card (the kit card handles its own Esc, since
  // it may need to ask first).
  const closable = overlay === "film";
  useEffect(() => {
    if (!closable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      setOverlay(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closable]);

  return (
    <>
      <div className="absolute inset-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-10 px-6 pt-24 pb-16">
          <section aria-labelledby="films-heading" className="flex flex-col gap-3">
            <header className="flex items-center gap-3 px-1">
              <h2 id="films-heading" className="font-medium text-[13px] text-white/90">
                Films
              </h2>
              <span className="font-mono text-[11.5px] text-white/35 tabular-nums">{films.length}</span>
            </header>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              <li className="p-1.5">
                <button
                  type="button"
                  onClick={() => setOverlay("film")}
                  className="flex aspect-video w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-[10px] border border-white/12 border-dashed text-[12.5px] text-white/55 outline-none transition-colors hover:border-white/25 hover:bg-white/[0.03] hover:text-white/85 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <PlusIcon className="size-4" aria-hidden="true" />
                  New film
                </button>
              </li>
              {films.map((f) => (
                <FilmCard
                  key={f.id}
                  film={f}
                  onOpen={() => onOpenFilm(f.id)}
                  onRename={(title) => onRenameFilm(f.id, title)}
                  onDuplicate={() => onDuplicateFilm(f.id)}
                  onDelete={() => onDeleteFilm(f.id)}
                />
              ))}
            </ul>
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
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
              {(kits ?? []).map((k) => (
                <li key={k.id}>
                  <KitCard kit={k} onOpen={() => onOpenKit(k.id)} />
                </li>
              ))}
            </ul>
            {kits === null ? <p className="px-1 text-[12px] text-white/40">Loading kits…</p> : null}
          </section>
          {error ? <p className="px-1 text-[12px] text-[#ff9592] leading-relaxed">{error}</p> : null}
        </div>
      </div>

      {/* Top: the studio's name. */}
      <div className={cn(CARD, "pointer-events-auto absolute top-4 left-4 flex h-11 items-center gap-2 rounded-[14px] px-4")}>
        <h1 className="font-medium text-[12.5px] text-white/90">Motion studio</h1>
      </div>

      {overlay ? (
        <div className="absolute inset-0 z-10 bg-black/55 backdrop-blur-[2px]">
          {overlay === "film" ? (
            <FirstFilm busy={busy} error={error} onStart={onStartFilm} onStartVideo={onStartVideo} />
          ) : (
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
          )}
          {overlay === "film" ? (
            <Hint label="Close">
              <button type="button" onClick={() => setOverlay(null)} className={cn(CARD, ICON_BUTTON, "absolute top-4 right-4 size-11 rounded-[14px]")} aria-label="Close">
                <MultipleCrossCancelIcon aria-hidden="true" />
              </button>
            </Hint>
          ) : null}
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
      <span className="flex aspect-[16/9] w-full flex-col overflow-hidden rounded-[10px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]" style={{ background: surface }}>
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

const ITEM =
  "flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-[9px] px-2 text-left text-[12.5px] text-white/80 outline-none transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:bg-white/[0.07] disabled:cursor-default disabled:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-white/50";

// One film on the front page: its still (or its shape until it has one),
// its name and length. The ••• menu, shown on hover, renames, duplicates
// or deletes it; deleting asks first.
function FilmCard({
  film: f,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
}: {
  film: FilmSummary;
  onOpen: () => void;
  onRename: (title: string) => Promise<void>;
  onDuplicate: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [menu, setMenu] = useState(false);
  const [view, setView] = useState<"list" | "delete">("list");
  const [renaming, setRenaming] = useState(false);
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

  return (
    <li className="group/card relative">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${f.title}`}
        className="flex w-full cursor-pointer flex-col gap-2 rounded-[14px] p-1.5 text-left outline-none transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-[10px] bg-[#141414] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
          {f.poster ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local still of the film
            <img src={f.poster} alt="" className="max-h-full max-w-full object-contain" />
          ) : (
            <span
              className="rounded-[3px] bg-white/[0.06] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
              style={{ width: f.width >= f.height ? "56%" : `${(f.width / f.height) * 56}%`, aspectRatio: `${f.width} / ${f.height}`, maxHeight: "70%" }}
            />
          )}
        </span>
        <span className="flex flex-col gap-0.5 px-1 pb-0.5">
          <span className={cn("truncate text-[12.5px] text-white/90", renaming && "invisible")}>{f.title}</span>
          <span className="text-[11.5px] text-white/40">
            {f.kind === "video" ? "Video edit" : "Motion graphics"} ·{" "}
            <span className="font-mono tabular-nums">{f.duration.toFixed(1)} s</span>
          </span>
        </span>
      </button>

      {renaming ? (
        // Over the card's own name, so typing doesn't open the film.
        <RenameField
          value={f.title}
          className="absolute right-2 bottom-[30px] left-2 h-6 text-[12.5px]"
          onDone={(next) => {
            setRenaming(false);
            if (next) void onRename(next);
          }}
        />
      ) : null}

      <Popover.Root
        open={menu}
        onOpenChange={(open) => {
          setMenu(open);
          if (open) setView("list");
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
            <Popover.Popup
              className={cn(
                SURFACE,
                "flex w-[232px] origin-(--transform-origin) flex-col p-1 outline-none transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0",
              )}
            >
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
                  <button
                    type="button"
                    className={cn(ITEM, "text-[#ff9592] hover:bg-[#e5484d]/12 hover:text-[#ffaaa8] [&>svg]:text-[#ff9592]")}
                    onClick={() => setView("delete")}
                  >
                    <DeleteDustbin01Icon aria-hidden="true" />
                    Delete
                  </button>
                </>
              ) : (
                <div className="flex flex-col gap-2 p-2">
                  <p className="font-medium text-[13px] text-white/90">Delete “{f.title}”?</p>
                  <p className="text-[12px] text-white/50 leading-relaxed">
                    This removes the film, its chat with Claude and its videos. You can’t undo this.
                  </p>
                  <div className="mt-1 flex gap-1.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(onDelete)}
                      className="inline-flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[9px] bg-[#e5484d] font-medium text-[12px] text-white outline-none transition-colors hover:bg-[#ec5d5e] focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                    >
                      {busy ? <Spinner className="size-3" /> : null}
                      Delete film
                    </button>
                    <button
                      type="button"
                      onClick={() => setView("list")}
                      className="inline-flex h-8 flex-1 cursor-pointer items-center justify-center rounded-[9px] bg-white/[0.08] font-medium text-[12px] text-white/80 outline-none transition-colors hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Keep it
                    </button>
                  </div>
                </div>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </li>
  );
}
