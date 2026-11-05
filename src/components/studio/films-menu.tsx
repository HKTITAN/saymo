"use client";

import { Popover } from "@base-ui/react/popover";
import { useState } from "react";
import { ArrowLeftIcon, CopyIcon, DeleteDustbin01Icon, ThreeDotsMenuHorizontalIcon } from "@/components/icons";
import { Spinner } from "@/components/ui/spinner";
import { SURFACE } from "@/components/tool/dial";
import type { Film, FilmSummary } from "@/lib/studio/contract";
import { cn } from "@/lib/utils";
import { CARD, Hint, ICON_BUTTON, PANEL_MOTION } from "./panel";


const POPUP =
  "origin-(--transform-origin) outline-none transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0";

const ITEM =
  "flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-[9px] px-2 text-left text-[12.5px] text-white/80 outline-none transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:bg-white/[0.07] disabled:cursor-default disabled:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-white/50";

// The film's own bar, top left: back to every film and kit, the film's
// name (renamed in place), and its ••• menu to duplicate or delete it.
// Other films open from the home page, not from here.
export function FilmsMenu({
  film,
  hidden,
  onHome,
  onDuplicate,
  onDelete,
  onRename,
}: {
  film: Film | null;
  films?: FilmSummary[];
  hidden: boolean;
  onOpen?: (id: string) => void;
  onHome: () => void; // the home page: every film and brand kit
  onCreate?: (width: number, height: number, kind: "motion" | "video") => Promise<void>;
  onDuplicate: () => Promise<void>;
  onDelete: () => Promise<void>;
  onRename: (title: string) => void;
  onRefresh?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"list" | "delete">("list");
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
        "pointer-events-auto absolute top-4 left-4 flex h-11 w-[300px] items-center gap-0.5 rounded-[14px] ps-1.5 pe-1.5",
        hidden && "pointer-events-none -translate-y-1 opacity-0",
      )}
    >
      <Hint label="All films">
        <button type="button" className={cn(ICON_BUTTON, "size-8")} onClick={onHome} aria-label="Back to all films">
          <ArrowLeftIcon aria-hidden="true" />
        </button>
      </Hint>
      {film ? <Title key={`${film.id}:${film.title}`} title={film.title} onRename={onRename} /> : <span className="ps-1 text-white/55">Studio</span>}
      {film ? (
        <Popover.Root
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (next) setView("list");
          }}
        >
          <Hint label="More">
            <Popover.Trigger className={cn(ICON_BUTTON, "size-8 data-popup-open:bg-white/[0.08] data-popup-open:text-white")} aria-label="More for this film">
              <ThreeDotsMenuHorizontalIcon aria-hidden="true" />
            </Popover.Trigger>
          </Hint>
          <Popover.Portal>
            <Popover.Positioner side="bottom" align="start" sideOffset={10} collisionPadding={12} className="z-50">
              <Popover.Popup className={cn(SURFACE, POPUP, "flex flex-col gap-0.5 p-1", view === "list" ? "w-max min-w-[156px]" : "w-[260px]")}>
                {view === "list" ? (
                  <>
                    <button type="button" className={ITEM} disabled={busy} onClick={() => run(onDuplicate)}>
                      <CopyIcon aria-hidden="true" />
                      Duplicate film
                    </button>
                    <button
                      type="button"
                      className={cn(ITEM, "text-[#ff9592] hover:bg-[#e5484d]/12 hover:text-[#ffaaa8] [&>svg]:text-[#ff9592]")}
                      onClick={() => setView("delete")}
                    >
                      <DeleteDustbin01Icon aria-hidden="true" />
                      Delete film
                    </button>
                  </>
                ) : (
                  <div className="flex flex-col gap-2 p-2">
                    <p className="font-medium text-[13px] text-white/90">Delete “{film.title}”?</p>
                    <p className="text-[12px] text-white/50 leading-relaxed">
                      Its chat and videos go too. You can’t undo this.
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
      ) : null}
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
        className="h-8 min-w-0 flex-1 truncate rounded-[8px] bg-transparent px-1.5 font-medium text-[13px] text-white/90 outline-none transition-colors hover:bg-white/[0.05] focus:bg-white/[0.07]"
      />
    </Hint>
  );
}
