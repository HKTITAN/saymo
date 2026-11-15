"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";
import { cn } from "@/lib/utils";

// Status chips in the DialKit language: small quiet fills with compact
// system type. Colour is kept for what needs attention.
export const badgeVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[6px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [button&,a&]:cursor-pointer",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-5 min-w-5 px-1.5 text-[11px]",
        lg: "h-6 min-w-6 px-2 text-[12px]",
        sm: "h-4.5 min-w-4.5 px-1 text-[10.5px]",
      },
      variant: {
        default: "bg-white/90 text-neutral-900 [button&,a&]:hover:bg-white",
        destructive: "bg-[#e5484d] text-white [button&,a&]:hover:bg-[#ec5d62]",
        error: "bg-[#e5484d]/15 text-danger",
        info: "bg-white/[0.08] text-white/80",
        outline:
          "border border-white/[0.10] text-white/65 [button&,a&]:hover:bg-white/[0.05]",
        secondary:
          "bg-white/[0.06] text-white/60 [button&,a&]:hover:bg-white/[0.09]",
        success: "bg-[#4cc38a]/15 text-[#6fd6a3]",
        warning: "bg-[#f1a10d]/15 text-[#f5b94a]",
      },
    },
  },
);

export interface BadgeProps extends useRender.ComponentProps<"span"> {
  variant?: VariantProps<typeof badgeVariants>["variant"];
  size?: VariantProps<typeof badgeVariants>["size"];
}

export function Badge({
  className,
  variant,
  size,
  render,
  ...props
}: BadgeProps): React.ReactElement {
  const defaultProps = {
    className: cn(badgeVariants({ className, size, variant })),
    "data-slot": "badge",
  };

  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(defaultProps, props),
    render,
  });
}
