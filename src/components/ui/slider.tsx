"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import * as React from "react";
import { cn } from "@/lib/utils";

// A slider as a DialKit row: the row itself fills up to the value and is
// dragged anywhere along its length. Children, such as a label and a
// <SliderValue />, sit inside the row: label left, value right.
export function Slider({
  className,
  getAriaLabel,
  children,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: SliderPrimitive.Root.Props &
  Pick<SliderPrimitive.Thumb.Props, "getAriaLabel">): React.ReactElement {
  const _values = React.useMemo(() => {
    if (value !== undefined) {
      return Array.isArray(value) ? value : [value];
    }
    if (defaultValue !== undefined) {
      return Array.isArray(defaultValue) ? defaultValue : [defaultValue];
    }
    return [min];
  }, [value, defaultValue, min]);

  return (
    <SliderPrimitive.Root
      className={cn("group/slider data-[orientation=horizontal]:w-full", className)}
      defaultValue={defaultValue}
      max={max}
      min={min}
      value={value}
      {...props}
    >
      <SliderPrimitive.Control
        className="relative flex h-9 w-full cursor-ew-resize touch-none select-none items-center overflow-hidden rounded-[10px] bg-white/[0.05] text-[12px] transition-colors hover:bg-white/[0.07] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring data-disabled:pointer-events-none data-disabled:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-9 data-[orientation=vertical]:cursor-ns-resize"
        data-slot="slider-control"
      >
        {/* The track sets its own `position: relative`, so a layer under
            the words spans the row for it; the fill takes its size from it. */}
        <div className="absolute inset-0">
          <SliderPrimitive.Track className="size-full" data-slot="slider-track">
            <SliderPrimitive.Indicator
              className="bg-white/[0.10] transition-colors group-data-[dragging]/slider:bg-white/[0.14]"
              data-slot="slider-indicator"
            />
            {Array.from({ length: _values.length }, (_, index) => (
              <SliderPrimitive.Thumb
                className="block h-full w-0.5 bg-white/45 opacity-0 outline-none transition-opacity group-hover/slider:opacity-100 group-data-[dragging]/slider:opacity-100 data-[orientation=vertical]:h-0.5 data-[orientation=vertical]:w-full"
                data-slot="slider-thumb"
                getAriaLabel={getAriaLabel}
                index={index}
                key={String(index)}
              />
            ))}
          </SliderPrimitive.Track>
        </div>
        {children && (
          <div className="pointer-events-none relative flex w-full items-center justify-between gap-3 px-3 text-white/65">
            {children}
          </div>
        )}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export function SliderValue({
  className,
  ...props
}: SliderPrimitive.Value.Props): React.ReactElement {
  return (
    <SliderPrimitive.Value
      className={cn("ms-auto text-white/90 tabular-nums", className)}
      data-slot="slider-value"
      {...props}
    />
  );
}

export { SliderPrimitive };
