"use client";

import { Field as FieldPrimitive } from "@base-ui/react/field";
import { mergeProps } from "@base-ui/react/merge-props";
import type * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.ComponentPropsWithoutRef<"textarea"> &
  React.RefAttributes<HTMLTextAreaElement> & {
    size?: "sm" | "default" | "lg" | number;
    unstyled?: boolean;
  };

// Several lines of words in a DialKit block: the same quiet fill as a row,
// growing with what is typed.
export function Textarea({
  className,
  size = "default",
  unstyled = false,
  ref,
  ...props
}: TextareaProps): React.ReactElement {
  return (
    <span
      className={
        cn(
          !unstyled &&
            "relative inline-grid w-full rounded-[10px] bg-white/[0.05] transition-colors hover:bg-white/[0.07] has-focus-visible:bg-white/[0.08] has-focus-visible:ring-2 has-focus-visible:ring-ring has-aria-invalid:ring-1 has-aria-invalid:ring-[#e5484d]/60 has-focus-visible:has-aria-invalid:ring-2 has-disabled:opacity-50",
          className,
        ) || undefined
      }
      data-size={size}
      data-slot="textarea-control"
    >
      <FieldPrimitive.Control
        ref={ref}
        value={props.value}
        defaultValue={props.defaultValue}
        disabled={props.disabled}
        id={props.id}
        name={props.name}
        render={(defaultProps: React.ComponentProps<"textarea">) => (
          <textarea
            className={cn(
              "field-sizing-content min-h-20 w-full resize-none rounded-[inherit] bg-transparent px-3 py-2.5 text-[13px] text-white/90 leading-relaxed outline-none placeholder:text-white/30",
              size === "sm" && "min-h-16 px-2.5 py-2 text-[12px]",
              size === "lg" && "min-h-24 py-3",
            )}
            data-slot="textarea"
            {...mergeProps(defaultProps, props)}
          />
        )}
      />
    </span>
  );
}

export { FieldPrimitive };
