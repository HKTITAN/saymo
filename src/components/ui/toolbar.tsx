"use client";

import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";
import type React from "react";
import { cn } from "@/lib/utils";

// A floating row of actions, in the same dark rounded panel as the menus.
export function Toolbar({
  className,
  ...props
}: ToolbarPrimitive.Root.Props): React.ReactElement {
  return (
    <ToolbarPrimitive.Root
      className={cn(
        "relative flex items-center gap-1 rounded-[12px] border border-white/[0.07] bg-menu p-1 text-white/85",
        className,
      )}
      data-slot="toolbar"
      {...props}
    />
  );
}

export function ToolbarButton({
  className,
  ...props
}: ToolbarPrimitive.Button.Props): React.ReactElement {
  return (
    <ToolbarPrimitive.Button
      className={cn(className)}
      data-slot="toolbar-button"
      {...props}
    />
  );
}

export function ToolbarLink({
  className,
  ...props
}: ToolbarPrimitive.Link.Props): React.ReactElement {
  return (
    <ToolbarPrimitive.Link
      className={cn(className)}
      data-slot="toolbar-link"
      {...props}
    />
  );
}

export function ToolbarInput({
  className,
  ...props
}: ToolbarPrimitive.Input.Props): React.ReactElement {
  return (
    <ToolbarPrimitive.Input
      className={cn(className)}
      data-slot="toolbar-input"
      {...props}
    />
  );
}

export function ToolbarGroup({
  className,
  ...props
}: ToolbarPrimitive.Group.Props): React.ReactElement {
  return (
    <ToolbarPrimitive.Group
      className={cn("flex items-center gap-1", className)}
      data-slot="toolbar-group"
      {...props}
    />
  );
}

export function ToolbarSeparator({
  className,
  ...props
}: ToolbarPrimitive.Separator.Props): React.ReactElement {
  return (
    <ToolbarPrimitive.Separator
      className={cn(
        "shrink-0 bg-white/[0.08] data-[orientation=horizontal]:my-0.5 data-[orientation=vertical]:my-2 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px data-[orientation=vertical]:not-[[class^='h-']]:not-[[class*='_h-']]:self-stretch",
        className,
      )}
      data-slot="toolbar-separator"
      {...props}
    />
  );
}

export { ToolbarPrimitive };
