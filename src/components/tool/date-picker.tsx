"use client";

import { Popover } from "@base-ui/react/popover";
import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import type { DatePick } from "@/lib/tool/doc";
import { cn } from "@/lib/utils";
import { DialButton, DialNote, LABEL, ROW_BUTTON, SURFACE, VALUE } from "./dial";

// The date and the time, picked from our own calendar and time lists. What
// is picked writes the post's two date lines (see dates.ts), which can
// still be typed over on the post.

export type PickerHandle = Popover.Handle<unknown>;
// One calendar, opened from its row in the panel or from the date's icon
// on the post.
export const createPickerHandle = () => Popover.createHandle<unknown>();

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// "2026-10-20" as a local date, so the weekday never slips a day.
function parse(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
function addMonths(d: Date, n: number) {
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), days));
}
const fromMonday = (d: Date) => (d.getDay() + 6) % 7;
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);

const MONTH = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });
const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const FULL = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

// "20 Oct 2026", "20 to 21 Oct 2026", "30 Oct to 2 Nov 2026"
function dateSummary(pick: DatePick) {
  const a = parse(pick.start);
  if (!a) return null;
  const b = parse(pick.end);
  if (!b || b <= a) return FULL.format(a);
  if (a.getFullYear() !== b.getFullYear()) return `${FULL.format(a)} to ${FULL.format(b)}`;
  if (a.getMonth() !== b.getMonth()) return `${DAY_MONTH.format(a)} to ${FULL.format(b)}`;
  return `${a.getDate()} to ${FULL.format(b)}`;
}

// "14:30" as "2:30 PM"
function clock(value: string) {
  const m = /^(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

const POPUP =
  "origin-(--transform-origin) outline-none transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0";

function Picker({
  handle,
  trigger,
  initialFocus,
  children,
}: {
  handle?: PickerHandle;
  trigger: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  return (
    <Popover.Root handle={handle}>
      <Popover.Trigger handle={handle} className={ROW_BUTTON}>
        {trigger}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={8} collisionPadding={12} className="z-50">
          <Popover.Popup initialFocus={initialFocus} className={cn(SURFACE, POPUP, "flex w-[288px] flex-col gap-1.5")}>
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function DatePicker({
  handle,
  pick,
  onPick,
}: {
  handle: PickerHandle;
  pick: DatePick;
  onPick: (change: Partial<DatePick>) => void;
}) {
  const summary = dateSummary(pick);
  const day = useRef<HTMLButtonElement>(null);
  return (
    <Picker
      handle={handle}
      initialFocus={day}
      trigger={
        <>
          <span className={LABEL}>Date</span>
          <span className={cn(VALUE, "ms-auto truncate", !summary && "font-sans text-white/40")}>{summary ?? "Pick a date"}</span>
        </>
      }
    >
      <Calendar
        start={pick.start}
        end={pick.end}
        dayRef={day}
        onPick={(start, end) => onPick({ start, end })}
        onDone={() => handle.close()}
      />
    </Picker>
  );
}

// The date's icon on the post opens the same calendar.
export function DateIconTrigger({ handle, children }: { handle: PickerHandle; children: ReactNode }) {
  return (
    <Popover.Trigger
      handle={handle}
      nativeButton={false}
      render={<span />}
      aria-label="Pick the date"
      className="block shrink-0 cursor-pointer rounded-[14px] outline-solid outline-[length:var(--px)] outline-offset-[calc(var(--px)*5)] outline-transparent transition-[outline-color] duration-150 hover:outline-black/25 focus-visible:outline-[length:calc(var(--px)*2)] focus-visible:outline-black/55 data-popup-open:outline-black/45"
    >
      {children}
    </Popover.Trigger>
  );
}

// A month at a time. The first day picked starts the event; a later day
// picked next ends it. Arrow keys move by day and week, Page Up and Page
// Down by month.
function Calendar({
  start,
  end,
  dayRef,
  onPick,
  onDone,
}: {
  start: string;
  end: string;
  dayRef: RefObject<HTMLButtonElement | null>;
  onPick: (start: string, end: string) => void;
  onDone: () => void;
}) {
  const [today] = useState(() => iso(new Date()));
  const [focus, setFocus] = useState(start || today);
  const [hover, setHover] = useState<string | null>(null);
  const moved = useRef(false);
  const title = useId();
  const shown = parse(focus) ?? new Date();
  const first = new Date(shown.getFullYear(), shown.getMonth(), 1);
  const lead = fromMonday(first);
  const weeks = Array.from({ length: 6 }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d - lead)),
  );

  // The keyboard moves the focus; the focused day follows it on screen.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    dayRef.current?.focus();
  }, [focus, dayRef]);

  // While the last day is still to pick, the days up to the one under the
  // pointer, or the one in focus, show as the event would run.
  const reach = start && !end ? (hover ?? focus) : end;
  const pickDay = (value: string) => {
    setFocus(value);
    if (!start || end || value <= start) onPick(value, "");
    else onPick(start, value);
  };
  const go = (to: Date) => {
    moved.current = true;
    setFocus(iso(to));
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const d = parse(focus);
    if (!d) return;
    const to = {
      ArrowLeft: addDays(d, -1),
      ArrowRight: addDays(d, 1),
      ArrowUp: addDays(d, -7),
      ArrowDown: addDays(d, 7),
      Home: addDays(d, -fromMonday(d)),
      End: addDays(d, 6 - fromMonday(d)),
      PageUp: addMonths(d, e.shiftKey ? -12 : -1),
      PageDown: addMonths(d, e.shiftKey ? 12 : 1),
    }[e.key];
    if (!to) return;
    e.preventDefault();
    setHover(null);
    go(to);
  };

  const a = parse(start);
  const b = parse(end);
  const hint = !a
    ? "Pick the day of the event."
    : !b
      ? "For several days, pick the last day too."
      : `${daysBetween(a, b) + 1} days. Pick another day to start again.`;

  return (
    <>
      <div className="flex h-9 items-center gap-1 ps-2.5">
        <p id={title} className="font-medium text-white/90" aria-live="polite">
          {MONTH.format(shown)}
        </p>
        <MonthButton label="Previous month" onClick={() => setFocus(iso(addMonths(shown, -1)))} className="ms-auto">
          <ChevronLeftIcon aria-hidden="true" />
        </MonthButton>
        <MonthButton label="Next month" onClick={() => setFocus(iso(addMonths(shown, 1)))}>
          <ChevronRightIcon aria-hidden="true" />
        </MonthButton>
      </div>
      <div role="grid" aria-labelledby={title} className="flex flex-col gap-0.5" onPointerLeave={() => setHover(null)}>
        <div role="row" className="grid grid-cols-7">
          {WEEKDAYS.map((w) => (
            <span key={w} role="columnheader" className="flex h-7 items-center justify-center text-[11px] text-white/40">
              {w}
            </span>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={iso(week[0])} role="row" className="grid grid-cols-7">
            {week.map((day) => {
              const value = iso(day);
              const outside = day.getMonth() !== shown.getMonth();
              const ends = value === start || value === end;
              const within = Boolean(start && reach && value > start && value < reach);
              return (
                <span key={value} role="gridcell" aria-selected={ends || (Boolean(end) && within)}>
                  <button
                    ref={value === focus ? dayRef : undefined}
                    type="button"
                    tabIndex={value === focus ? 0 : -1}
                    aria-label={DAY.format(day)}
                    aria-current={value === today ? "date" : undefined}
                    onClick={() => pickDay(value)}
                    onKeyDown={onKey}
                    onFocus={() => setFocus(value)}
                    onPointerEnter={() => setHover(value)}
                    className={cn(
                      "relative flex h-9 w-full cursor-pointer items-center justify-center rounded-[9px] text-[12px] tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                      ends
                        ? "bg-white text-black"
                        : within
                          ? "bg-white/[0.10] text-white"
                          : outside
                            ? "text-white/25 hover:bg-white/[0.06]"
                            : "text-white/80 hover:bg-white/[0.08]",
                    )}
                  >
                    {day.getDate()}
                    {value === today && !ends && (
                      <span aria-hidden="true" className="absolute bottom-1.5 size-1 rounded-full bg-current opacity-60" />
                    )}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <DialNote>{hint}</DialNote>
      <div className="grid grid-cols-2 gap-1.5">
        <DialButton className="h-8" disabled={!start} onClick={() => onPick("", "")}>
          Clear dates
        </DialButton>
        <DialButton className="h-8" onClick={onDone}>
          Done
        </DialButton>
      </div>
    </>
  );
}

function MonthButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex size-8 cursor-pointer items-center justify-center rounded-[9px] text-white/60 outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4",
        className,
      )}
    >
      {children}
    </button>
  );
}

// Every quarter of an hour, "00:00" to "23:45".
const QUARTERS = Array.from({ length: 96 }, (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`);

export function TimePicker({ pick, onPick }: { pick: DatePick; onPick: (change: Partial<DatePick>) => void }) {
  const starts = clock(pick.time);
  const ends = clock(pick.endTime);
  const summary = starts && ends ? `${starts} to ${ends}` : starts;
  return (
    <Picker
      trigger={
        <>
          <span className={LABEL}>Time</span>
          <span className={cn(VALUE, "ms-auto truncate", !summary && "font-sans text-white/40")}>{summary ?? "Add a time"}</span>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-1.5">
        <TimeList
          label="Starts"
          none="No time"
          value={pick.time}
          onChange={(time) => onPick({ time, endTime: time && pick.endTime > time ? pick.endTime : "" })}
        />
        <TimeList
          label="Ends"
          none="No end time"
          value={pick.endTime}
          after={pick.time}
          onChange={(endTime) => onPick({ endTime })}
        />
      </div>
      <DialNote>
        {pick.start
          ? "Shown on the post after the day."
          : "Pick a date too, the time shows with it."}
      </DialNote>
    </Picker>
  );
}

// A column of times to pick from: arrow keys move, Enter picks.
function TimeList({
  label,
  none,
  value,
  after,
  onChange,
}: {
  label: string;
  none: string;
  value: string;
  // Ends: only times after the start, and none until there is a start.
  after?: string;
  onChange: (time: string) => void;
}) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const off = after !== undefined && !after;
  const times = QUARTERS.filter((t) => after === undefined || t > after);
  // A time set to the minute stays in the list, in its place.
  if (value && !times.includes(value)) times.push(value);
  times.sort();
  const options = ["", ...times];
  const [focus, setFocus] = useState(value);
  const tabbable = options.includes(focus) ? focus : value;

  // Opens with the picked time in the middle of the list.
  useLayoutEffect(() => {
    const box = list.current;
    const picked = box?.querySelector<HTMLElement>("[aria-selected=true]");
    if (box && picked) box.scrollTop = picked.offsetTop - box.clientHeight / 2 + picked.offsetHeight / 2;
  }, []);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>("[role=option]") ?? [])];
    const at = items.indexOf(e.currentTarget);
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1, PageDown: at + 6, PageUp: at - 6 }[
      e.key
    ];
    if (to === undefined) return;
    e.preventDefault();
    items[Math.max(0, Math.min(items.length - 1, to))]?.focus();
  };

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p id={id} className="px-1.5 pt-1 text-white/65">
        {label}
      </p>
      <div
        ref={list}
        role="listbox"
        aria-labelledby={id}
        aria-disabled={off || undefined}
        className="relative flex h-60 flex-col gap-0.5 overflow-y-auto overscroll-contain rounded-[10px] bg-white/[0.04] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {options.map((t) => (
          <button
            key={t || "none"}
            type="button"
            role="option"
            aria-selected={t === value}
            tabIndex={t === tabbable ? 0 : -1}
            disabled={off && t !== ""}
            onClick={() => onChange(t)}
            onKeyDown={onKey}
            onFocus={() => setFocus(t)}
            className={cn(
              "flex h-8 shrink-0 cursor-pointer items-center rounded-[8px] px-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-35",
              t ? "tabular-nums" : "",
              t === value ? "bg-white text-black" : "text-white/75 hover:bg-white/[0.08]",
            )}
          >
            {t ? clock(t) : none}
          </button>
        ))}
      </div>
    </div>
  );
}
