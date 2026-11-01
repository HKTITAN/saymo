"use client";

import { Popover } from "@base-ui/react/popover";
import { useState } from "react";
import {
  CheckTickCircleIcon,
  CopyIcon,
  DeleteDustbin01Icon,
  GridDashboard02Icon,
  PlusIcon,
} from "@/components/icons";
import { Spinner } from "@/components/ui/spinner";
import { SURFACE } from "@/components/tool/dial";
import { type Film, type FilmSummary, SIZES } from "@/lib/studio/contract";
import { cn } from "@/lib/utils";
import { CARD, Hint, ICON_BUTTON, PANEL_MOTION } from "./panel";

// Top left: the film's name, which you can rename in place, and the menu
// of films: open another, make a new one, duplicate or delete this one.

const POPUP =
  "origin-(--transform-origin) outline-none transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0";

const ITEM =
  "flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-[9px] px-2 text-left text-[12.5px] text-white/80 outline-none transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:bg-white/[0.07] disabled:cursor-default disabled:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-white/50";

export function FilmsMenu({
  film,
  films,
  hidden,
  onOpen,
  onCreate,
  onDuplicate,
  onDelete,
  onRename,
  onRefresh,
}: {
  film: Film | null;
  films: FilmSummary[];
  hidden: boolean;
  onOpen: (id: string) => void;
  onCreate: (width: number, height: number) => Promise<void>;
  onDuplicate: () => Promise<void>;
  onDelete: () => Promise<void>;
  onRename: (title: string) => void;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"list" | "new" | "delete">("list");
  const [busy, setBusy] = useState(false);

  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    try {
      await job();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      inert={hidden}
      className={cn(
        CARD,
        PANEL_MOTION,
        "pointer-events-auto absolute top-4 left-4 flex h-11 max-w-[340px] items-center gap-1 rounded-[14px] ps-1.5 pe-3",
        hidden && "pointer-events-none -translate-y-1 opacity-0",
      )}
    >
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setView("list");
            onRefresh();
          }
        }}
      >
        <Hint label="Films">
          <Popover.Trigger className={cn(ICON_BUTTON, "size-8 data-popup-open:bg-white/[0.08] data-popup-open:text-white")} aria-label="Films">
            <GridDashboard02Icon aria-hidden="true" />
          </Popover.Trigger>
        </Hint>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="start" sideOffset={10} collisionPadding={12} className="z-50">
            <Popover.Popup className={cn(SURFACE, POPUP, "flex w-[300px] flex-col gap-0.5 p-1.5")}>
              {view === "list" ? (
                <>
                  <p className="px-2 pt-1.5 pb-1 font-medium text-[11.5px] text-white/40">Films</p>
                  <div className="flex max-h-[min(360px,50dvh)] flex-col gap-0.5 overflow-y-auto">
                    {films.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className={ITEM}
                        onClick={() => {
                          onOpen(f.id);
                          setOpen(false);
                        }}
                      >
                        <Poster summary={f} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{f.title}</span>
                          <span className="font-mono text-[10.5px] text-white/35 tabular-nums">
                            {f.duration.toFixed(1)} s · {f.width}×{f.height}
                          </span>
                        </span>
                        {f.id === film?.id ? <CheckTickCircleIcon aria-label="Open now" className="text-white/70" /> : null}
                      </button>
                    ))}
                  </div>
                  <div className="my-1 h-px bg-white/[0.07]" />
                  <button type="button" className={ITEM} onClick={() => setView("new")}>
                    <PlusIcon aria-hidden="true" />
                    New film
                  </button>
                  {film ? (
                    <>
                      <button type="button" className={ITEM} disabled={busy} onClick={() => run(onDuplicate)}>
                        <CopyIcon aria-hidden="true" />
                        Duplicate this film
                      </button>
                      <button
                        type="button"
                        className={cn(ITEM, "text-[#ff9592] hover:bg-[#e5484d]/12 hover:text-[#ffaaa8] [&>svg]:text-[#ff9592]")}
                        onClick={() => setView("delete")}
                      >
                        <DeleteDustbin01Icon aria-hidden="true" />
                        Delete this film
                      </button>
                    </>
                  ) : null}
                </>
              ) : view === "new" ? (
                <>
                  <p className="px-2 pt-1.5 pb-1 font-medium text-[11.5px] text-white/40">New film: pick a size</p>
                  {SIZES.map((s) => (
                    <button key={s.label} type="button" className={ITEM} disabled={busy} onClick={() => run(() => onCreate(s.width, s.height))}>
                      <span
                        className="shrink-0 rounded-[3px] bg-white/[0.12] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]"
                        style={{ width: (s.width / Math.max(s.width, s.height)) * 22, height: (s.height / Math.max(s.width, s.height)) * 22 }}
                        aria-hidden="true"
                      />
                      <span className="flex-1">{s.label}</span>
                      <span className="font-mono text-[10.5px] text-white/35 tabular-nums">
                        {s.width}×{s.height}
                      </span>
                    </button>
                  ))}
                  <button type="button" className={cn(ITEM, "justify-center text-white/50")} onClick={() => setView("list")}>
                    Back to films
                  </button>
                </>
              ) : (
                <div className="flex flex-col gap-2 p-2">
                  <p className="font-medium text-[13px] text-white/90">Delete “{film?.title}”?</p>
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
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {film ? <Title key={`${film.id}:${film.title}`} title={film.title} onRename={onRename} /> : <span className="ps-1 text-white/55">Studio</span>}
    </div>
  );
}

function Title({ title, onRename }: { title: string; onRename: (title: string) => void }) {
  const [text, setText] = useState(title);
  const commit = () => {
    const next = text.trim();
    if (next && next !== title) onRename(next);
    else setText(title);
  };
  return (
    <Hint label="Rename">
      <input
        value={text}
        aria-label="Film name"
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setText(title);
            requestAnimationFrame(() => (document.activeElement as HTMLElement | null)?.blur());
          }
        }}
        size={Math.max(6, Math.min(32, text.length + 1))}
        className="h-8 min-w-0 rounded-[8px] bg-transparent px-1.5 font-medium text-[13px] text-white/90 outline-none transition-colors hover:bg-white/[0.05] focus:bg-white/[0.07]"
      />
    </Hint>
  );
}

function Poster({ summary }: { summary: FilmSummary }) {
  const tall = summary.height > summary.width;
  const w = tall ? (summary.width / summary.height) * 30 : 40;
  const h = tall ? 30 : (summary.height / summary.width) * 40;
  return (
    <span className="flex size-10 shrink-0 items-center justify-center" aria-hidden="true">
      {summary.poster ? (
        // eslint-disable-next-line @next/next/no-img-element -- a small local still
        <img src={summary.poster} alt="" className="rounded-[4px] object-cover" style={{ width: w, height: h }} />
      ) : (
        <span className="rounded-[4px] bg-white/[0.08] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" style={{ width: w, height: h }} />
      )}
    </span>
  );
}
