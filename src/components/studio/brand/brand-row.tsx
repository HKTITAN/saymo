"use client";

import { Popover } from "@base-ui/react/popover";
import { useEffect, useState } from "react";
import { CheckTickCircleIcon, ChevronDownIcon } from "@/components/icons";
import { LABEL, ROW_BUTTON, SURFACE } from "@/components/ui/dial";
import type { BrandSummary } from "@/lib/studio/brands/brand";
import { cn } from "@/lib/utils";
import { brandApi } from "../api/brand";

// The film's brand kit, as one DialKit row: its name and colours; the list
// of kits opens under it. Picking one redraws the film in that kit.

const POPUP =
  "origin-(--transform-origin) outline-none transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0";

export function Swatches({ colors, className }: { colors: string[]; className?: string }) {
  return (
    <span className={cn("flex shrink-0 overflow-hidden rounded-[4px] shadow-[0_0_0_1px_rgb(var(--hi)_/_0.12)]", className)} aria-hidden="true">
      {colors.map((c, i) => (
        <span key={`${c}-${i}`} className="h-full w-2.5" style={{ background: c }} />
      ))}
    </span>
  );
}

export function BrandRow({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [kits, setKits] = useState<BrandSummary[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    brandApi
      .list()
      .then((k) => live && setKits(k))
      .catch(() => live && setKits([]));
    return () => {
      live = false;
    };
  }, [open]);
  const current = kits?.find((k) => k.id === value);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={ROW_BUTTON}>
        <span className={LABEL}>Brand</span>
        <span className="ms-auto flex min-w-0 items-center gap-2 text-white/90">
          {current ? <Swatches colors={current.swatches} className="h-3.5" /> : null}
          <span className="truncate">{current?.name ?? (kits ? "Clean" : "…")}</span>
          <ChevronDownIcon className="size-3.5 shrink-0 text-white/40" aria-hidden="true" />
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={12} className="z-50">
          <Popover.Popup className={cn(SURFACE, POPUP, "flex w-[260px] flex-col gap-0.5 p-1.5")}>
            <p className="px-2 pt-1.5 pb-1 font-medium text-[11.5px] text-white/40">Brand kit</p>
            {(kits ?? []).map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (k.id !== value) onChange(k.id);
                }}
                className="flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-[9px] px-2 text-left text-[12.5px] text-white/80 outline-none transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:bg-white/[0.07]"
              >
                <Swatches colors={k.swatches} className="h-4" />
                <span className="min-w-0 flex-1 truncate">{k.name}</span>
                {k.id === value ? <CheckTickCircleIcon className="size-4 text-white/70" aria-label="In use" /> : null}
              </button>
            ))}
            {kits && !kits.length ? <p className="px-2 py-2 text-[12px] text-white/45">No kits yet. Choose New kit in Brand kits.</p> : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
