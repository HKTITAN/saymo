import type * as React from "react";
import { cn } from "@/lib/utils";

// A key, as a small quiet chip in the system font.
export function Kbd({
  className,
  ...props
}: React.ComponentProps<"kbd">): React.ReactElement {
  return (
    <kbd
      className={cn(
        "pointer-events-none inline-flex h-[18px] min-w-[18px] select-none items-center justify-center gap-1 rounded-[5px] bg-white/[0.08] px-1 font-medium font-sans text-[10.5px] text-white/55 [&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      data-slot="kbd"
      {...props}
    />
  );
}

export function KbdGroup({
  className,
  ...props
}: React.ComponentProps<"kbd">): React.ReactElement {
  return (
    <kbd
      className={cn("inline-flex items-center gap-1", className)}
      data-slot="kbd-group"
      {...props}
    />
  );
}
