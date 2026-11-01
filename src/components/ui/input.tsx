"use client";

import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = Omit<
  InputPrimitive.Props & React.RefAttributes<HTMLInputElement>,
  "size"
> & {
  size?: "sm" | "default" | "lg" | number;
  unstyled?: boolean;
  nativeInput?: boolean;
};

// A text field as a DialKit row: a quiet rounded fill that brightens on
// hover and focus, with no border box.
export function Input({
  className,
  size = "default",
  unstyled = false,
  nativeInput = false,
  style,
  ...props
}: InputProps): React.ReactElement {
  const inputClassName = cn(
    "h-9 w-full min-w-0 rounded-[inherit] bg-transparent px-3 text-[12.5px] text-white/90 leading-9 outline-none [color-scheme:dark] [transition:background-color_5000000s_ease-in-out_0s] placeholder:text-white/30 autofill:[-webkit-text-fill-color:rgb(255_255_255/0.9)]",
    size === "sm" && "h-8 px-2.5 text-[12px] leading-8",
    size === "lg" && "h-10 text-[13px] leading-10",
    props.type === "search" &&
      "[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none",
    props.type === "file" &&
      "text-white/55 file:me-3 file:rounded-[6px] file:border-0 file:bg-white/[0.08] file:px-2 file:py-0.5 file:font-medium file:text-[12px] file:text-white/85",
  );

  return (
    <span
      className={
        cn(
          !unstyled &&
            "relative inline-flex w-full rounded-[10px] bg-white/[0.05] transition-colors hover:bg-white/[0.07] has-focus-visible:bg-white/[0.08] has-focus-visible:ring-2 has-focus-visible:ring-ring has-aria-invalid:ring-1 has-aria-invalid:ring-[#e5484d]/60 has-focus-visible:has-aria-invalid:ring-2 has-disabled:opacity-50",
          className,
        ) || undefined
      }
      data-size={size}
      data-slot="input-control"
    >
      {nativeInput ? (
        <input
          className={inputClassName}
          data-slot="input"
          size={typeof size === "number" ? size : undefined}
          style={typeof style === "function" ? undefined : style}
          {...props}
        />
      ) : (
        <InputPrimitive
          className={inputClassName}
          data-slot="input"
          size={typeof size === "number" ? size : undefined}
          style={style}
          {...props}
        />
      )}
    </span>
  );
}

export { InputPrimitive };
