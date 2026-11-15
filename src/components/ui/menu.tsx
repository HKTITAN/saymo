"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import type * as React from "react";
import { CheckTickCircleIcon, ChevronRightIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

// Menus in the DialKit language: a dark rounded panel of quiet rows, each
// lit softly on hover, with small system type.

const ITEM =
  "flex min-h-8 cursor-default select-none items-center gap-2 rounded-[8px] px-2.5 py-1 text-[12.5px] text-white/80 outline-none transition-colors data-disabled:pointer-events-none data-highlighted:bg-white/[0.07] data-highlighted:text-white data-inset:ps-8 data-[variant=destructive]:text-danger data-[variant=destructive]:data-highlighted:bg-[#e5484d]/15 data-disabled:opacity-50 [&>svg:not([class*='size-'])]:size-4 [&>svg]:pointer-events-none [&>svg]:shrink-0 [&>svg]:text-white/55";

export const MenuCreateHandle: typeof MenuPrimitive.createHandle =
  MenuPrimitive.createHandle;

export const Menu: typeof MenuPrimitive.Root = MenuPrimitive.Root;

export const MenuPortal: typeof MenuPrimitive.Portal = MenuPrimitive.Portal;

export function MenuTrigger({
  className,
  children,
  ...props
}: MenuPrimitive.Trigger.Props): React.ReactElement {
  return (
    <MenuPrimitive.Trigger
      className={className}
      data-slot="menu-trigger"
      {...props}
    >
      {children}
    </MenuPrimitive.Trigger>
  );
}

export function MenuPopup({
  children,
  className,
  sideOffset = 6,
  align = "center",
  alignOffset,
  side = "bottom",
  anchor,
  portalProps,
  ...props
}: MenuPrimitive.Popup.Props & {
  align?: MenuPrimitive.Positioner.Props["align"];
  sideOffset?: MenuPrimitive.Positioner.Props["sideOffset"];
  alignOffset?: MenuPrimitive.Positioner.Props["alignOffset"];
  side?: MenuPrimitive.Positioner.Props["side"];
  anchor?: MenuPrimitive.Positioner.Props["anchor"];
  portalProps?: MenuPrimitive.Portal.Props;
}): React.ReactElement {
  return (
    <MenuPortal {...portalProps}>
      <MenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="z-50"
        data-slot="menu-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          className={cn(
            "relative flex not-[class*='w-']:min-w-40 origin-(--transform-origin) rounded-[14px] border border-white/[0.07] bg-menu shadow-2xl shadow-shade/50 outline-none transition-[scale,opacity] duration-150 focus:outline-none data-ending-style:scale-97 data-starting-style:scale-97 data-ending-style:opacity-0 data-starting-style:opacity-0",
            className,
          )}
          data-slot="menu-popup"
          {...props}
        >
          <div className="max-h-(--available-height) w-full overflow-y-auto p-1">
            {children}
          </div>
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPortal>
  );
}

export function MenuGroup(
  props: MenuPrimitive.Group.Props,
): React.ReactElement {
  return <MenuPrimitive.Group data-slot="menu-group" {...props} />;
}

export function MenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean;
  variant?: "default" | "destructive";
}): React.ReactElement {
  return (
    <MenuPrimitive.Item
      className={cn(ITEM, className)}
      data-inset={inset}
      data-slot="menu-item"
      data-variant={variant}
      {...props}
    />
  );
}

export function MenuLinkItem({
  className,
  inset,
  variant = "default",
  closeOnClick = true,
  ...props
}: MenuPrimitive.LinkItem.Props & {
  inset?: boolean;
  variant?: "default" | "destructive";
}): React.ReactElement {
  return (
    <MenuPrimitive.LinkItem
      className={cn(ITEM, className)}
      closeOnClick={closeOnClick}
      data-inset={inset}
      data-slot="menu-link-item"
      data-variant={variant}
      {...props}
    />
  );
}

export function MenuCheckboxItem({
  className,
  children,
  checked,
  variant = "default",
  ...props
}: MenuPrimitive.CheckboxItem.Props & {
  variant?: "default" | "switch";
}): React.ReactElement {
  return (
    <MenuPrimitive.CheckboxItem
      checked={checked}
      className={cn(
        ITEM,
        "grid",
        variant === "switch" ? "grid-cols-[1fr_auto] gap-4 pe-1.5" : "grid-cols-[1rem_1fr] pe-4",
        className,
      )}
      data-slot="menu-checkbox-item"
      {...props}
    >
      {variant === "switch" ? (
        <>
          <span className="col-start-1">{children}</span>
          {/* An "Off | On" pair, as the editor's switches. */}
          <span className="col-start-2 flex gap-0.5 rounded-[7px] bg-white/[0.05] p-0.5 text-[11px]">
            <span className="rounded-[5px] px-1.5 in-data-unchecked:bg-white/[0.12] in-data-unchecked:text-white in-data-checked:text-white/40">
              Off
            </span>
            <span className="rounded-[5px] px-1.5 in-data-checked:bg-white/[0.12] in-data-checked:text-white in-data-unchecked:text-white/40">
              On
            </span>
          </span>
        </>
      ) : (
        <>
          <MenuPrimitive.CheckboxItemIndicator className="col-start-1 -ms-0.5">
            <CheckTickCircleIcon aria-hidden="true" className="size-4" />
          </MenuPrimitive.CheckboxItemIndicator>
          <span className="col-start-2">{children}</span>
        </>
      )}
    </MenuPrimitive.CheckboxItem>
  );
}

export function MenuRadioGroup(
  props: MenuPrimitive.RadioGroup.Props,
): React.ReactElement {
  return <MenuPrimitive.RadioGroup data-slot="menu-radio-group" {...props} />;
}

export function MenuRadioItem({
  className,
  children,
  ...props
}: MenuPrimitive.RadioItem.Props): React.ReactElement {
  return (
    <MenuPrimitive.RadioItem
      className={cn(ITEM, "grid grid-cols-[1rem_1fr] pe-4", className)}
      data-slot="menu-radio-item"
      {...props}
    >
      <MenuPrimitive.RadioItemIndicator className="col-start-1 -ms-0.5 flex items-center justify-center">
        <span className="size-1.5 rounded-full bg-white/85" />
      </MenuPrimitive.RadioItemIndicator>
      <span className="col-start-2">{children}</span>
    </MenuPrimitive.RadioItem>
  );
}

export function MenuGroupLabel({
  className,
  inset,
  ...props
}: MenuPrimitive.GroupLabel.Props & {
  inset?: boolean;
}): React.ReactElement {
  return (
    <MenuPrimitive.GroupLabel
      className={cn(
        "px-2.5 pt-2 pb-1 text-[11px] text-white/40 data-inset:ps-8",
        className,
      )}
      data-inset={inset}
      data-slot="menu-label"
      {...props}
    />
  );
}

export function MenuSeparator({
  className,
  ...props
}: MenuPrimitive.Separator.Props): React.ReactElement {
  return (
    <MenuPrimitive.Separator
      className={cn("mx-2 my-1 h-px bg-white/[0.06]", className)}
      data-slot="menu-separator"
      {...props}
    />
  );
}

export function MenuShortcut({
  className,
  ...props
}: React.ComponentProps<"kbd">): React.ReactElement {
  return (
    <kbd
      className={cn(
        "ms-auto text-[11px] text-white/40 tabular-nums",
        className,
      )}
      data-slot="menu-shortcut"
      {...props}
    />
  );
}

export function MenuSub(
  props: MenuPrimitive.SubmenuRoot.Props,
): React.ReactElement {
  return <MenuPrimitive.SubmenuRoot data-slot="menu-sub" {...props} />;
}

export function MenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean;
}): React.ReactElement {
  return (
    <MenuPrimitive.SubmenuTrigger
      className={cn(ITEM, "data-popup-open:bg-white/[0.07] data-popup-open:text-white", className)}
      data-inset={inset}
      data-slot="menu-sub-trigger"
      {...props}
    >
      {children}
      <ChevronRightIcon aria-hidden="true" className="ms-auto -me-0.5 size-3.5 text-white/45" />
    </MenuPrimitive.SubmenuTrigger>
  );
}

export function MenuSubPopup({
  className,
  sideOffset = 0,
  alignOffset,
  align = "start",
  ...props
}: MenuPrimitive.Popup.Props & {
  align?: MenuPrimitive.Positioner.Props["align"];
  sideOffset?: MenuPrimitive.Positioner.Props["sideOffset"];
  alignOffset?: MenuPrimitive.Positioner.Props["alignOffset"];
}): React.ReactElement {
  const defaultAlignOffset = align !== "center" ? -5 : undefined;

  return (
    <MenuPopup
      align={align}
      alignOffset={alignOffset ?? defaultAlignOffset}
      className={className}
      data-slot="menu-sub-content"
      side="inline-end"
      sideOffset={sideOffset}
      {...props}
    />
  );
}

export {
  MenuPrimitive,
  MenuCreateHandle as DropdownMenuCreateHandle,
  Menu as DropdownMenu,
  MenuPortal as DropdownMenuPortal,
  MenuTrigger as DropdownMenuTrigger,
  MenuPopup as DropdownMenuContent,
  MenuGroup as DropdownMenuGroup,
  MenuItem as DropdownMenuItem,
  MenuCheckboxItem as DropdownMenuCheckboxItem,
  MenuRadioGroup as DropdownMenuRadioGroup,
  MenuRadioItem as DropdownMenuRadioItem,
  MenuGroupLabel as DropdownMenuLabel,
  MenuSeparator as DropdownMenuSeparator,
  MenuShortcut as DropdownMenuShortcut,
  MenuSub as DropdownMenuSub,
  MenuSubTrigger as DropdownMenuSubTrigger,
  MenuSubPopup as DropdownMenuSubContent,
};
