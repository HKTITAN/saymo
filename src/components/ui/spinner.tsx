import type React from "react";
import { cn } from "@/lib/utils";

// A thin ring turning in the current text colour, sized like an icon.
export function Spinner({
  className,
  ...props
}: React.ComponentProps<"span">): React.ReactElement {
  return (
    <span
      aria-label="Loading"
      className={cn(
        "inline-block size-4 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent opacity-80",
        className,
      )}
      role="status"
      {...props}
    />
  );
}
