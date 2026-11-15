"use client";

import { Skeleton } from "@/components/skeleton";
import { ROW } from "@/components/ui/dial";
import { cn } from "@/lib/utils";
import { CARD } from "../ui/panel";

// While a film or a brand kit opens: its panels already in their places,
// with quiet shapes (skullet) where their rows will be, so nothing jumps
// when the real ones arrive. The cards are real; only what's inside them
// is drawn as shapes.

export function Opening({ what }: { what: "film" | "kit" }) {
  const label = what === "film" ? "Opening the film" : "Opening the kit";
  return (
    <div className="pointer-events-none absolute inset-0" aria-busy="true">
      <div className={cn(CARD, "absolute top-4 left-4 flex h-11 w-[300px] items-center gap-2 rounded-[14px] px-4")}>
        <Skeleton loading label={label}>
          <span className="text-[12.5px]">{what === "film" ? "Product launch teaser" : "Brand kit"}</span>
        </Skeleton>
      </div>

      {/* Claude, on the left. */}
      <div className={cn(CARD, "absolute top-[68px] left-4 flex w-[300px] flex-col gap-3 p-4")}>
        <Skeleton loading>
          <div className="flex flex-col gap-3">
            <p className="text-[12.5px]">Claude</p>
            <p className="text-[12.5px] leading-relaxed">Tell Claude what to change, or point at the film.</p>
            <div className="flex gap-1.5">
              <span className="h-7 w-[120px] rounded-[8px]" skullet-block="" />
              <span className="h-7 w-[136px] rounded-[8px]" skullet-block="" />
            </div>
            <div className="h-[92px] rounded-[12px]" skullet-block="" />
          </div>
        </Skeleton>
      </div>

      {/* The settings, on the right. */}
      <div className={cn(CARD, "absolute top-[68px] right-4 flex flex-col gap-2 p-3", "w-[300px]")}>
        <Skeleton loading>
          <div className="flex flex-col gap-2">
            <p className="px-1 py-1 text-[12px]">{what === "film" ? "Film" : "Kit"}</p>
            <p className="px-1 text-[12px]">{what === "film" ? "Frame" : "Colours"}</p>
            {[0, 1, 2].map((i) => (
              <div key={i} className={ROW} skullet-block="" />
            ))}
            <p className="px-1 pt-2 text-[12px]">{what === "film" ? "Settings" : "Type"}</p>
            {[0, 1].map((i) => (
              <div key={i} className={ROW} skullet-block="" />
            ))}
          </div>
        </Skeleton>
      </div>
    </div>
  );
}
