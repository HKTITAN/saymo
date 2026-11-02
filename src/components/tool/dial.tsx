"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { type ReactNode, useId, useState } from "react";
import { ChevronDownIcon } from "@/components/icons";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

// The editor's controls, after Josh Puckett's DialKit: every control is one
// quiet rounded row, its label on the left and its value on the right, and
// a slider is the row itself, filled up to its value. Values are set in the
// system's monospace so numbers don't jitter as they change.

export const ROW = "flex h-9 w-full items-center rounded-[10px] bg-white/[0.05] text-[12px] transition-colors";
export const LABEL = "shrink-0 text-white/65";
export const VALUE = "font-mono text-white/90 tabular-nums";
// A row that opens something, such as a picker.
export const ROW_BUTTON = `${ROW} cursor-pointer gap-3 px-3 text-left outline-none hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-white/[0.08]`;
// A floating panel: a picker, or the toolbar over selected words.
export const SURFACE = "rounded-[14px] bg-popover p-1.5 text-[12px] text-white/90 shadow-2xl shadow-black/50 ring-1 ring-white/10";

// A titled group of rows that folds away.
export function DialGroup({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const body = useId();
  return (
    <section className="flex flex-col gap-1.5">
      <h2>
        <button
          type="button"
          className="flex h-8 w-full cursor-pointer items-center justify-between rounded-md px-1 text-left font-medium text-[12px] text-white/85 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={open}
          aria-controls={body}
          onClick={() => setOpen((o) => !o)}
        >
          {title}
          <ChevronDownIcon
            className={cn("size-3.5 text-white/40 transition-transform duration-200", !open && "-rotate-90")}
            aria-hidden="true"
          />
        </button>
      </h2>
      <div id={body} className={cn("flex flex-col gap-1.5", !open && "hidden")}>
        {children}
      </div>
    </section>
  );
}

// A number: drag anywhere along the row, or use the arrow keys.
// A number in the monospaced face with its unit (s, %, ×) in the normal
// face just after it: a space in a monospaced font is a full letter wide,
// which leaves the unit floating away from its number.
export function Reading({ text }: { text: string }) {
  const m = /^(-?[\d.,:]+)\s*(\S.*)?$/.exec(text);
  if (!m) return <>{text}</>;
  return (
    <>
      {m[1]}
      {m[2] ? <span className="ms-[0.18em] font-sans">{m[2]}</span> : null}
    </>
  );
}

export function DialSlider({
  label,
  value,
  min,
  max,
  step = 1,
  format = (v) => String(Math.round(v)),
  disabled,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  disabled?: boolean;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
}) {
  const one = (v: number | readonly number[]) => (Array.isArray(v) ? v[0] : v) as number;
  return (
    <SliderPrimitive.Root
      className="group/dial w-full"
      value={Math.min(max, Math.max(min, value))}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={(v) => onChange(one(v))}
      onValueCommitted={(v) => onCommit?.(one(v))}
    >
      <SliderPrimitive.Control
        className={cn(
          ROW,
          "relative cursor-ew-resize touch-none select-none overflow-hidden hover:bg-white/[0.07] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring data-disabled:cursor-default data-disabled:opacity-50",
        )}
      >
        {/* The track sets its own `position: relative`, so a layer under the
            words spans the row for it; the fill takes its height from it. */}
        <div className="absolute inset-0">
          <SliderPrimitive.Track className="size-full">
            <SliderPrimitive.Indicator className="bg-white/[0.10] transition-colors group-data-[dragging]/dial:bg-white/[0.14]" />
            <SliderPrimitive.Thumb
              className="block h-full w-0.5 bg-white/45 opacity-0 transition-opacity group-hover/dial:opacity-100 group-data-[dragging]/dial:opacity-100"
              getAriaLabel={() => label}
            />
          </SliderPrimitive.Track>
        </div>
        <span className={cn(LABEL, "pointer-events-none relative ps-3")}>{label}</span>
        <span className={cn(VALUE, "pointer-events-none relative ms-auto pe-3")}>
          <Reading text={format(value)} />
        </span>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

// Words, typed in place on the right of the row.
export function DialText({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        ROW,
        "cursor-text gap-3 px-3 hover:bg-white/[0.07] has-[:focus-visible]:bg-white/[0.08] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
      )}
    >
      <span className={LABEL}>{label}</span>
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-full min-w-0 flex-1 bg-transparent text-right text-white/90 outline-none placeholder:text-white/30"
      />
    </label>
  );
}

// On or off, as DialKit's "Off | On" pair.
export function DialToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className={cn(ROW, "ps-3 pe-1", disabled && "opacity-50")}>
      <span className={LABEL}>{label}</span>
      <div className="ms-auto flex gap-0.5" role="radiogroup" aria-label={label}>
        {[false, true].map((on) => (
          <button
            key={String(on)}
            type="button"
            role="radio"
            aria-checked={checked === on}
            disabled={disabled}
            onClick={() => onChange(on)}
            className={cn(
              "h-7 cursor-pointer rounded-[7px] px-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
              checked === on ? "bg-white/[0.13] text-white" : "text-white/45 hover:text-white/75",
            )}
          >
            {on ? "On" : "Off"}
          </button>
        ))}
      </div>
    </div>
  );
}

// An action, as a full row.
export function DialButton({
  children,
  type = "button",
  disabled,
  loading,
  onClick,
  className,
}: {
  children: ReactNode;
  type?: "button" | "submit";
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={cn(
        ROW,
        "cursor-pointer justify-center gap-2 px-3 text-white/80 outline-none hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50 [&_svg]:size-3.5",
        className,
      )}
    >
      {loading ? <Spinner className="size-3.5" /> : null}
      {children}
    </button>
  );
}

// A small note under a group of rows.
export function DialNote({ children }: { children: ReactNode }) {
  return <p className="px-1 text-[11.5px] text-white/40 leading-relaxed">{children}</p>;
}
