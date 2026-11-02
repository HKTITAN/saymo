"use client";

import { Popover } from "@base-ui/react/popover";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { DeleteDustbin01Icon, GridDashboard02Icon, PencilEditIcon, ThreeDotsMenuHorizontalIcon } from "@/components/icons";
import { SURFACE } from "@/components/tool/dial";
import { RenameField } from "@/components/tool/rename";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { TinyFolder } from "./doodles";
import { Hint, ICON_BUTTON } from "./panel";

// Pieces the studio's home page shares between its films and its library:
// folders (as cards and as a row of chips), menus, the confirm step, empty
// places and "3 hours ago".

// "3 hours ago", "yesterday": when something last changed. The clock moves
// on once a minute.
// Held over a folder for a moment while dragging something it doesn't take
// (a library item over a films folder), the folder opens, so the thing can
// be dropped on what's inside, as in Finder.
export function useSpringOpen(onSpring: (() => void) | undefined) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disarm = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => disarm, []);
  return {
    arm: () => {
      if (!onSpring || timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        onSpring();
      }, 550);
    },
    disarm,
  };
}

export const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];
export const ago = (iso: string, now: number) => {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  for (const [unit, size] of UNITS) if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  return "just now";
};
export const everyMinute = (cb: () => void) => {
  const t = setInterval(cb, 30_000);
  return () => clearInterval(t);
};
export const thisMinute = () => Math.floor(Date.now() / 60_000) * 60_000;

// An empty place, said plainly, with a drawing and the way forward.
export function Empty({ doodle, title, note, children }: { doodle: ReactNode; title: string; note: string; children?: ReactNode }) {
  return (
    <div className="group/doodle flex flex-col items-center gap-1.5 rounded-[16px] px-6 py-12 text-center ring-1 ring-white/[0.05]">
      {doodle}
      <p className="mt-3 font-medium text-[13px] text-white/90">{title}</p>
      <p className="max-w-[360px] text-[12px] text-white/45 leading-relaxed">{note}</p>
      {children}
    </div>
  );
}

// A folder in the grid, the size of a card: what's inside peeks out as a
// small fanned stack. Drop a film (or a library item) on it to file it; the
// stack spreads to make room while one is dragged over. The ••• menu
// renames or deletes it.
export function FolderCard({
  folder,
  pages,
  detail,
  deleteBody,
  dragType,
  springType,
  dragging,
  onOpen,
  onDrop,
  onRename,
  onDelete,
}: {
  folder: { id: string; name: string };
  pages: Page[]; // newest first
  detail: string; // "3 films · 2 hours ago"
  deleteBody: string; // what happens to what's inside
  dragType: string; // what may be dropped on it
  springType?: string; // what, held over it, opens it
  dragging: boolean;
  onOpen: () => void;
  onDrop: (id: string) => void;
  onRename: (name: string) => void;
  onDelete: () => Promise<void>;
}) {
  const [over, setOver] = useState(false);
  const [hovered, setHovered] = useState(false);
  const spring = useSpringOpen(springType ? onOpen : undefined);
  const [renaming, setRenaming] = useState(false);
  const [landed, setLanded] = useState(0); // bumps when a film lands, for a small nod
  return (
    <li
      className="group/card group/doodle relative"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onDragOver={(e) => {
        if (springType && e.dataTransfer.types.includes(springType)) spring.arm();
        if (!e.dataTransfer.types.includes(dragType)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOver(false);
        spring.disarm();
      }}
      onDrop={(e) => {
        spring.disarm();
        const id = e.dataTransfer.getData(dragType);
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
          <FolderArt pages={pages} state={over ? "over" : hovered ? "hover" : "rest"} />
        </span>
        <span className="flex flex-col gap-0.5 px-1 pb-0.5">
          <span className={cn("truncate pe-8 text-[12.5px] text-white/90", renaming && "invisible")}>{folder.name}</span>
          <span className="truncate text-[11.5px] text-white/40" suppressHydrationWarning>
            {over ? "Drop to add it here" : detail}
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
        <FolderMenu folder={folder} deleteBody={deleteBody} onRename={() => setRenaming(true)} onDelete={onDelete} />
      </div>
    </li>
  );
}

// A folder drawn the Windows way, standing up and seen from the side: the
// back with a small tab low on its right, the cover swung open on the left,
// and the films inside standing in it like pages held in the spine.
//
// Three states, one motion: at rest the folder is a little open, the cover
// ajar and the pages just starting to fan; on hover the cover
// swings open and the pages fan out one after another; with a film dragged
// over it, it opens wide to take it.
type FolderState = "rest" | "hover" | "over";
const PAGE = { w: 58, h: 80 };
const PAGES: Record<FolderState, { skew: number; scale: number; y: number }[]> = {
  rest: [
    { skew: 0, scale: 1, y: 0 },
    { skew: 4, scale: 0.94, y: 1.5 },
    { skew: 8, scale: 0.88, y: 3 },
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
// The cover hinges on the spine: shut it lies flat over the back; open, it
// leans toward you, foreshortened.
const COVER: Record<FolderState, { skew: number; scale: number }> = {
  rest: { skew: 15, scale: 0.78 },
  hover: { skew: 36, scale: 0.4 },
  over: { skew: 40, scale: 0.3 },
};
const PAGE_FILL = ["#3a3a3a", "#454545", "#505050"];
const SPRING = "cubic-bezier(0.23, 1, 0.32, 1)";
export type Page = { id: string; poster: string | null };
function FolderArt({ pages, state }: { pages: Page[]; state: FolderState }) {
  const id = useId();
  // Newest in front; an empty folder holds one blank page.
  const inside: (Page | null)[] = pages.length ? pages.slice(0, 3).reverse() : [null];
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
            transformOrigin: "0 0",
            transform: `translate(14px, 6.6px) skewY(${COVER[state].skew}deg) scaleX(${COVER[state].scale})`,
            ...move(0),
          }}
        >
          <rect width={64.7} height={89} rx={5} fill={`url(#${id}-cover)`} stroke="rgb(255 255 255 / 0.07)" strokeWidth={0.6} />
        </g>
      </g>
    </svg>
  );
}

// A folder in the row: opens it, and takes films (or library items)
// dropped on it.
export function FolderChip({
  label,
  count,
  current,
  folder = false,
  icon,
  dragType,
  springType,
  onOpen,
  onDrop,
}: {
  label: string;
  count: number | null; // null while the list loads
  current: boolean;
  folder?: boolean;
  icon?: ReactNode; // in place of the grid, for a chip that isn't a folder
  dragType: string | null; // null: nothing can be dropped on it
  springType?: string; // what, held over it, opens it
  onOpen: () => void;
  onDrop: (id: string) => void;
}) {
  const [over, setOver] = useState(false);
  const spring = useSpringOpen(springType ? onOpen : undefined);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={current ? "true" : undefined}
      onDragOver={(e) => {
        if (springType && !current && e.dataTransfer.types.includes(springType)) spring.arm();
        if (!dragType || !e.dataTransfer.types.includes(dragType)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOver(false);
        spring.disarm();
      }}
      onDrop={(e) => {
        spring.disarm();
        const id = dragType ? e.dataTransfer.getData(dragType) : "";
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
        (icon ?? <GridDashboard02Icon className="size-3.5 opacity-70" aria-hidden="true" />)
      )}
      <span className="max-w-[180px] truncate">{label}</span>
      {count === null ? null : <span className="font-mono text-[11px] text-white/35 tabular-nums">{count}</span>}
    </button>
  );
}

export const MENU_POPUP =
  "flex origin-(--transform-origin) flex-col p-1 outline-none transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0";

export const ITEM =
  "flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-[9px] px-2 pe-3 text-left text-[12.5px] text-white/80 outline-none transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:bg-white/[0.07] disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-white/50";
export const DANGER_ITEM = "text-[#ff9592] hover:bg-[#e5484d]/12 hover:text-[#ffaaa8] [&>svg]:text-[#ff9592]";

// Asks before something can't be undone: what goes, what stays, two answers.
export function Confirm({
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

// The open folder's ••• menu: rename it, or delete it (what's inside stays).
export function FolderMenu({
  folder,
  deleteBody,
  onRename,
  onDelete,
}: {
  folder: { id: string; name: string };
  deleteBody: string;
  onRename: () => void;
  onDelete: () => Promise<void>;
}) {
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
                body={deleteBody}
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
