"use client";

import { type KeyboardEvent, type ReactNode, type RefObject, useLayoutEffect, useRef } from "react";
import { ArrowUpIcon, MultipleCrossCancelIcon } from "@/components/icons";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { Hint } from "./panel";

// Where a prompt is typed: in the chat panel and in the bubble on the film.
// Enter sends, Shift+Enter starts a new line. Grows with its words.

export function PromptBox({
  value,
  onChange,
  onSend,
  onStop,
  running,
  placeholder,
  chip,
  onClearChip,
  tools,
  inputRef,
  autoFocus,
  onEscape,
  maxRows = 6,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop?: () => void;
  running: boolean;
  placeholder: string;
  chip?: string | null;
  onClearChip?: () => void;
  tools?: ReactNode;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  autoFocus?: boolean;
  onEscape?: () => void;
  maxRows?: number;
  className?: string;
}) {
  const own = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? own;

  // Fit the box to its lines, up to maxRows.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const line = 19;
    el.style.height = `${Math.min(el.scrollHeight, line * maxRows + 12)}px`;
  }, [value, maxRows, ref]);

  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!running && value.trim()) onSend();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onEscape?.();
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-[12px] bg-white/[0.06] p-1.5 transition-colors has-[:focus-visible]:bg-white/[0.08] has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-white/15",
        className,
      )}
    >
      {chip ? (
        <span className="flex h-6 max-w-full items-center gap-1 self-start rounded-[7px] bg-[#F55A00]/15 ps-2 pe-1 text-[11.5px] text-[#ff9a5c]">
          <span className="truncate">{chip}</span>
          {onClearChip ? (
            <button
              type="button"
              onClick={onClearChip}
              aria-label="Stop pointing at this"
              className="inline-flex size-4 cursor-pointer items-center justify-center rounded-[4px] text-[#ff9a5c]/70 outline-none hover:bg-[#F55A00]/20 hover:text-[#ffb27f] focus-visible:ring-1 focus-visible:ring-[#F55A00] [&_svg]:size-3"
            >
              <MultipleCrossCancelIcon aria-hidden="true" />
            </button>
          ) : null}
        </span>
      ) : null}
      <textarea
        ref={ref}
        rows={1}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label="Prompt for Claude"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={keys}
        className="w-full resize-none bg-transparent px-1.5 py-1 text-[13px] text-white/90 leading-[19px] outline-none placeholder:text-white/30"
      />
      <div className="flex items-center gap-1">
        {tools}
        <span className="ms-auto" />
        {running && onStop ? (
          <Hint label="Stop Claude">
            <button
              type="button"
              onClick={onStop}
              className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[8px] bg-white/[0.1] px-2.5 font-medium text-[12px] text-white/85 outline-none transition-colors hover:bg-white/[0.15] focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Spinner className="size-3" />
              Stop
            </button>
          </Hint>
        ) : (
          <Hint label="Send" keys={["↵"]}>
            <button
              type="button"
              onClick={onSend}
              disabled={running || !value.trim()}
              aria-label="Send to Claude"
              className="inline-flex size-7 cursor-pointer items-center justify-center rounded-[8px] bg-white text-[#141414] outline-none transition-[background-color,opacity,scale] duration-150 hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.94] disabled:cursor-default disabled:bg-white/15 disabled:text-white/40 [&_svg]:size-4"
            >
              <ArrowUpIcon aria-hidden="true" />
            </button>
          </Hint>
        )}
      </div>
    </div>
  );
}
