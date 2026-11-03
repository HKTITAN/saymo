"use client";

import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import type React from "react";
import { cn } from "@/lib/utils";

// Progress as a DialKit row: the row itself fills up to the value, with the
// label on the left and the percent on the right, like a slider you can't
// drag. With no children it is the bare filling row.
export function Progress({
  className,
  children,
  ...props
}: ProgressPrimitive.Root.Props): React.ReactElement {
  return (
    <ProgressPrimitive.Root
      className={cn(
        "relative flex h-9 w-full items-center overflow-hidden rounded-[10px] bg-white/[0.05] text-[12px]",
        className,
      )}
      data-slot="progress"
      {...props}
    >
      {children ? (
        children
      ) : (
        <ProgressTrack>
          <ProgressIndicator />
        </ProgressTrack>
      )}
    </ProgressPrimitive.Root>
  );
}

export function ProgressLabel({
  className,
  ...props
}: ProgressPrimitive.Label.Props): React.ReactElement {
  return (
    <ProgressPrimitive.Label
      className={cn("relative truncate ps-3 pe-2 text-white/65", className)}
      data-slot="progress-label"
      {...props}
    />
  );
}

// The track spans the whole row under the words. Its height is set so the
// indicator, which inherits it, fills the row from top to bottom.
export function ProgressTrack({
  className,
  ...props
}: ProgressPrimitive.Track.Props): React.ReactElement {
  return (
    <ProgressPrimitive.Track
      className={cn("absolute inset-0 h-full overflow-hidden", className)}
      data-slot="progress-track"
      {...props}
    />
  );
}

export function ProgressIndicator({
  className,
  ...props
}: ProgressPrimitive.Indicator.Props): React.ReactElement {
  return (
    <ProgressPrimitive.Indicator
      className={cn(
        "bg-white/[0.10] transition-[width] duration-500 ease-out",
        className,
      )}
      data-slot="progress-indicator"
      {...props}
    />
  );
}

export function ProgressValue({
  className,
  ...props
}: ProgressPrimitive.Value.Props): React.ReactElement {
  return (
    <ProgressPrimitive.Value
      className={cn(
        "relative ms-auto shrink-0 pe-3 text-white/90 tabular-nums",
        className,
      )}
      data-slot="progress-value"
      {...props}
    />
  );
}

export { ProgressPrimitive };
