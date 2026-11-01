"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

// Buttons in the DialKit language: quiet rounded fills rather than outlined
// boxes, compact system type, and one light button for the main action.
export const buttonVariants = cva(
  "relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] font-medium text-[12.5px] outline-none transition-colors pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-loading:select-none data-loading:text-transparent [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-8 px-3",
        icon: "size-8",
        "icon-lg": "size-9",
        "icon-sm": "size-7 rounded-[8px]",
        "icon-xl": "size-10 [&_svg:not([class*='size-'])]:size-5",
        "icon-xs": "size-6 rounded-[7px] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 px-3.5",
        sm: "h-7 gap-1 rounded-[8px] px-2.5 text-[12px]",
        xl: "h-10 px-4 text-[13px] [&_svg:not([class*='size-'])]:size-4.5",
        xs: "h-6 gap-1 rounded-[7px] px-2 text-[11.5px] [&_svg:not([class*='size-'])]:size-3.5",
      },
      variant: {
        // The main action on a screen, such as Make 4K video.
        default:
          "bg-white/90 text-neutral-900 hover:bg-white data-pressed:bg-white *:data-[slot=button-loading-indicator]:text-neutral-900",
        destructive:
          "bg-[#e5484d] text-white hover:bg-[#ec5d62] data-pressed:bg-[#ec5d62] *:data-[slot=button-loading-indicator]:text-white",
        "destructive-outline":
          "bg-white/[0.05] text-[#ff9592] hover:bg-[#e5484d]/15 data-pressed:bg-[#e5484d]/15 *:data-[slot=button-loading-indicator]:text-white",
        ghost:
          "text-white/75 hover:bg-white/[0.06] hover:text-white data-pressed:bg-white/[0.06] *:data-[slot=button-loading-indicator]:text-white",
        link: "text-white/80 underline-offset-4 hover:text-white hover:underline *:data-[slot=button-loading-indicator]:text-white",
        // A DialKit row button: the everyday action.
        outline:
          "bg-white/[0.05] text-white/85 hover:bg-white/[0.08] data-pressed:bg-white/[0.08] *:data-[slot=button-loading-indicator]:text-white",
        secondary:
          "bg-white/[0.08] text-white/90 hover:bg-white/[0.11] data-pressed:bg-white/[0.11] *:data-[slot=button-loading-indicator]:text-white",
      },
    },
  },
);

export interface ButtonProps extends useRender.ComponentProps<"button"> {
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  render,
  children,
  loading = false,
  disabled: disabledProp,
  ...props
}: ButtonProps): React.ReactElement {
  const isDisabled: boolean = Boolean(loading || disabledProp);
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] =
    render ? undefined : "button";

  const defaultProps = {
    children: (
      <>
        {children}
        {loading && (
          <Spinner
            className="pointer-events-none absolute"
            data-slot="button-loading-indicator"
          />
        )}
      </>
    ),
    className: cn(buttonVariants({ className, size, variant })),
    "aria-disabled": loading || undefined,
    "data-loading": loading ? "" : undefined,
    "data-slot": "button",
    disabled: isDisabled,
    type: typeValue,
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}
