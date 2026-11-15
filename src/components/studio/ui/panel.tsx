"use client";

import type { CSSProperties, ReactNode } from "react";
import { MinusIcon } from "@/components/icons";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Floating panels: rounded dark cards over the film, with a fine edge, a faint shadow and
// a little blur so the film shows faintly through. Each folds down to a
// pill with its name; H hides them all.

export const CARD =
  "rounded-[16px] bg-float/80 text-[12px] text-white/90 shadow-[0_4px_14px_-6px_rgb(0_0_0_/_calc(0.22*var(--shade))),0_0_0_1px_rgb(var(--hi)_/_0.08)] backdrop-blur-xl backdrop-saturate-150";

// Small round button used in panel headers and toolbars.
export const ICON_BUTTON =
  "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[8px] text-white/55 outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-40 [&_svg]:size-4";

// A pill-shaped button with words, for actions in the panels' corners.
export const PILL_BUTTON =
  "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-[10px] px-3 font-medium text-[12px] outline-none transition-[background-color,color] duration-150 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-45 [&_svg]:size-3.5";

// The motion every panel shares as it folds, hides and returns, and as it
// comes into place when a page opens (`studio-panel`, page-turn.ts).
export const PANEL_MOTION =
  "studio-panel transition-[opacity,translate,scale,filter] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]";

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

// Asked once, inside a pop-up, before closing it would throw away what was
// typed or attached. Discard is focused, as it's the choice being asked.
export function DiscardAsk({ what, onKeep, onDiscard }: { what: string; onKeep: () => void; onDiscard: () => void }) {
  return (
    <div
      role="alertdialog"
      aria-label={`Discard ${what}?`}
      className="flex items-center gap-2 rounded-[12px] bg-white/[0.06] py-1.5 ps-3 pe-1.5 animate-in fade-in-0 duration-150"
    >
      <p className="me-auto text-[12px] text-white/85">Discard {what}?</p>
      <button type="button" onClick={onKeep} className={cn(PILL_BUTTON, "h-7 px-2.5 text-white/70 hover:bg-white/[0.08] hover:text-white")}>
        Keep it
      </button>
      <button
        type="button"
        // biome-ignore lint/a11y/noAutofocus: the one choice that needs a decision
        autoFocus
        onClick={onDiscard}
        className={cn(PILL_BUTTON, "h-7 px-2.5 bg-danger/15 text-danger hover:bg-danger/25")}
      >
        Discard
      </button>
    </div>
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
  pillMark,
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
  pillMark?: ReactNode; // shown in the folded pill instead of its dot
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
        {pillMark ?? <span className="size-1.5 rounded-full bg-white/40" aria-hidden="true" />}
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
