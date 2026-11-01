"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import type React from "react";
import { cn } from "@/lib/utils";

// On and off as DialKit's "Off | On" pair: one switch, its thumb the lit
// half that slides to the current side. Name it with a label, as before;
// the two words are only for the eye.
export function Switch({
  className,
  ...props
}: SwitchPrimitive.Root.Props): React.ReactElement {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "relative inline-grid h-7 shrink-0 cursor-pointer select-none grid-cols-2 items-center rounded-[8px] bg-white/[0.05] p-0.5 font-sans text-[11.5px] outline-none transition-colors hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-ring data-disabled:cursor-default data-disabled:opacity-50",
        className,
      )}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb
        className="pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-[6px] bg-white/[0.13] transition-[left] duration-150 ease-out data-checked:left-1/2"
        data-slot="switch-thumb"
      />
      <span
        aria-hidden="true"
        className="relative px-2 text-center text-white transition-colors in-data-checked:text-white/45"
      >
        Off
      </span>
      <span
        aria-hidden="true"
        className="relative px-2 text-center text-white/45 transition-colors in-data-checked:text-white"
      >
        On
      </span>
    </SwitchPrimitive.Root>
  );
}

export { SwitchPrimitive };
