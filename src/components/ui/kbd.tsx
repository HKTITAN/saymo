import type * as React from "react";
import { cn } from "@/lib/utils";

// A key, drawn as a little key cap in the system font: a face on a darker
// lip, so it reads as something you press. The lip is a shadow, not a lit
// edge; the glyph sits a pixel up, on the face.
export function Kbd({
  className,
  ...props
}: React.ComponentProps<"kbd">): React.ReactElement {
  return (
    <kbd
      className={cn(
        "pointer-events-none inline-flex h-[19px] min-w-[19px] select-none items-center justify-center gap-1 rounded-[6px] bg-[#2c2c2c] px-[5px] pb-px font-medium font-sans text-[10.5px] text-white/75 leading-none shadow-[inset_0_-2px_0_rgba(0,0,0,0.4),0_1px_1.5px_rgba(0,0,0,0.45)] [&_svg:not([class*='size-'])]:size-3",
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
