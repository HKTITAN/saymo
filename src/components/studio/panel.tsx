"use client";

import type { CSSProperties, ReactNode } from "react";
import { MinusIcon } from "@/components/icons";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Floating panels: rounded dark cards over the film, with a soft shadow and
// a little blur so the film shows faintly through. Each folds down to a
// pill with its name; H hides them all.

export const CARD =
  "rounded-[16px] bg-[#161616]/80 text-[12px] text-white/90 shadow-[0_12px_40px_-8px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.07)] backdrop-blur-xl backdrop-saturate-150";

// Small round button used in panel headers and toolbars.
export const ICON_BUTTON =
  "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[8px] text-white/55 outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-40 [&_svg]:size-4";

// A pill-shaped button with words, for actions in the panels' corners.
export const PILL_BUTTON =
  "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-[10px] px-3 font-medium text-[12px] outline-none transition-[background-color,color,scale] duration-150 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] disabled:cursor-default disabled:opacity-45 [&_svg]:size-3.5";

// The motion every panel shares as it folds, hides and returns.
export const PANEL_MOTION = "transition-[opacity,translate,scale,filter] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]";

// A hint on hover, with the key that does the same thing.
export function Hint({ label, keys, children }: { label: string; keys?: string[]; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipPopup>
        <span className="flex items-center gap-2">
          {label}
          {keys?.length ? (
            <span className="flex gap-0.5">
              {keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
          ) : null}
        </span>
      </TooltipPopup>
    </Tooltip>
  );
}

export function Panel({
  title,
  folded,
  onFold,
  hidden,
  className,
  pillClassName,
  style,
  actions,
  children,
  bodyClassName,
}: {
  title: string;
  folded: boolean;
  onFold: (folded: boolean) => void;
  hidden: boolean;
  className?: string;
  pillClassName?: string; // where the folded pill sits
  style?: CSSProperties;
  actions?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
}) {
  if (folded) {
    return (
      <button
        type="button"
        onClick={() => onFold(false)}
        className={cn(
          CARD,
          PANEL_MOTION,
          "pointer-events-auto absolute flex h-9 cursor-pointer items-center gap-2 rounded-full px-3.5 font-medium text-white/75 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-ring",
          hidden && "pointer-events-none translate-y-1 scale-[0.98] opacity-0",
          pillClassName,
        )}
        aria-label={`Open ${title.toLowerCase()}`}
        tabIndex={hidden ? -1 : undefined}
      >
        <span className="size-1.5 rounded-full bg-white/40" aria-hidden="true" />
        {title}
      </button>
    );
  }
  return (
    <section
      aria-label={title}
      inert={hidden}
      className={cn(
        CARD,
        PANEL_MOTION,
        "pointer-events-auto absolute flex flex-col overflow-hidden",
        hidden && "pointer-events-none translate-y-1 scale-[0.98] opacity-0 blur-[2px]",
        className,
      )}
      style={style}
    >
      <header className="flex h-11 shrink-0 items-center gap-1 ps-4 pe-2">
        <h2 className="me-auto truncate font-medium text-[12px] text-white/85">{title}</h2>
        {actions}
        <Hint label="Fold">
          <button type="button" className={ICON_BUTTON} onClick={() => onFold(true)} aria-label={`Fold ${title.toLowerCase()}`}>
            <MinusIcon aria-hidden="true" />
          </button>
        </Hint>
      </header>
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}
