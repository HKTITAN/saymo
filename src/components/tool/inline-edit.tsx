"use client";

import {
  createContext,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { PALETTE } from "@/components/post/palette";
import { type PostPart, WORD } from "@/components/post/post";
import { orangeOf, type PostDoc } from "@/lib/tool/doc";
import { cn } from "@/lib/utils";
import { SURFACE } from "../ui/dial";
import { fitHeadline } from "./fit";

// The post's words, edited where they stand. Clicking any text on the post
// puts a transparent input exactly over it: the caret and the selection are
// the browser's own, and the words you see as you type are the post's own
// type, orange words and raised ordinals included.

export type TextPart = Exclude<PostPart, "date.icon">;
type Group = "title" | "date" | "location" | "name" | "role" | "company";
type Select = { start: number; end: number } | "all" | "end";
type Active = { part: TextPart; select: Select; seq: number };
type Edit = (change: (d: PostDoc) => PostDoc) => void;

const groupOf = (part: TextPart) => part.split(".")[0] as Group;
const lineOf = (part: TextPart) => Number(part.split(".")[1] ?? 0);

// The headline as shown: always at least one line, so there is one to click.
export const titleLines = (d: PostDoc) => (d.title.length ? d.title : [""]);

const withTitle = (d: PostDoc, title: string[]): PostDoc => ({ ...d, title, titleSize: fitHeadline(title) });

function read(d: PostDoc, part: TextPart) {
  const group = groupOf(part);
  const i = lineOf(part);
  if (group === "title") return titleLines(d)[i] ?? "";
  if (group === "date" || group === "location") return d[group].lines[i] ?? "";
  return d.speaker[group];
}

function write(d: PostDoc, part: TextPart, text: string): PostDoc {
  const group = groupOf(part);
  const i = lineOf(part);
  if (group === "title") {
    const title = [...titleLines(d)];
    title[i] = text;
    return withTitle(d, title);
  }
  if (group === "date" || group === "location") {
    const lines = [...d[group].lines] as [string, string];
    lines[i] = text;
    return group === "date" ? { ...d, date: { ...d.date, lines } } : { ...d, location: { ...d.location, lines } };
  }
  return { ...d, speaker: { ...d.speaker, [group]: text } };
}

// Every field in the order Tab takes them.
const partsOf = (d: PostDoc): TextPart[] => [
  ...titleLines(d).map((_, i) => `title.${i}` as const),
  "date.0",
  "date.1",
  "location.0",
  "location.1",
  "name",
  "role",
  "company",
];

// As saved: no empty headline lines and no spaces at either end of a line.
export function tidy(d: PostDoc): PostDoc {
  const trim = (s: string) => s.trim();
  const title = d.title.map(trim).filter(Boolean);
  const speaker = { name: trim(d.speaker.name), role: trim(d.speaker.role), company: trim(d.speaker.company) };
  const dates = d.date.lines.map(trim) as [string, string];
  const places = d.location.lines.map(trim) as [string, string];
  const titleChanged = title.length !== d.title.length || title.some((line, i) => line !== d.title[i]);
  const changed =
    titleChanged ||
    speaker.name !== d.speaker.name ||
    speaker.role !== d.speaker.role ||
    speaker.company !== d.speaker.company ||
    dates.some((line, i) => line !== d.date.lines[i]) ||
    places.some((line, i) => line !== d.location.lines[i]);
  if (!changed) return d;
  return {
    ...(titleChanged ? withTitle(d, title) : d),
    speaker,
    date: { ...d.date, lines: dates },
    location: { ...d.location, lines: places },
  };
}

// Escape puts back what a field had when its editing began.
function restore(d: PostDoc, from: PostDoc, group: Group): PostDoc {
  switch (group) {
    case "title":
      return { ...d, title: from.title, titleSize: from.titleSize };
    case "date":
      return { ...d, date: { ...d.date, lines: from.date.lines } };
    case "location":
      return { ...d, location: { ...d.location, lines: from.location.lines, orange: orangeOf(from) } };
    default:
      return { ...d, speaker: { ...d.speaker, [group]: from.speaker[group] } };
  }
}

const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
const wordsOf = (text: string) => text.split(WORD).filter((_, i) => i % 2 === 1);

// The whole words a selection touches, each once.
function wordsIn(text: string, start: number, end: number) {
  const found: string[] = [];
  for (const m of text.matchAll(new RegExp(WORD.source, "gu"))) {
    const from = m.index ?? 0;
    if (from < end && from + m[0].length > start && !found.some((w) => same(w, m[0]))) found.push(m[0]);
  }
  return found;
}

// Sets the words in orange, or back to black when they all are already.
// Picks of words no longer in the location are let go at the same time.
function toggled(d: PostDoc, words: string[]) {
  const there = d.location.lines.flatMap(wordsOf);
  const kept = orangeOf(d).filter((o) => there.some((w) => same(w, o)));
  if (words.every((w) => kept.some((o) => same(o, w)))) return kept.filter((o) => !words.some((w) => same(w, o)));
  return [...kept, ...words.filter((w) => !kept.some((o) => same(o, w)))];
}

export function useInlineEditing(doc: PostDoc, edit: Edit) {
  const [active, setActive] = useState<Active | null>(null);
  const current = useRef<Active | null>(null);
  const session = useRef<{ group: Group; from: PostDoc } | null>(null);
  const seq = useRef(0);
  const latest = useRef(doc);
  useEffect(() => {
    latest.current = doc;
  });
  // Focus put back on the words by the editor itself, not by Tab.
  const quiet = useRef(false);
  const returnTo = useRef<TextPart | null>(null);

  const show = (next: Active | null) => {
    current.current = next;
    setActive(next);
  };
  const finish = () => {
    if (!session.current) return;
    session.current = null;
    edit(tidy);
  };
  const begin = (part: TextPart, select: Select) => {
    const group = groupOf(part);
    if (session.current?.group !== group) {
      finish();
      session.current = { group, from: latest.current };
    }
    seq.current += 1;
    show({ part, select, seq: seq.current });
  };
  const caret = (at: number): Select => ({ start: at, end: at });

  return {
    active,
    value: (part: TextPart) => read(doc, part),
    lines: titleLines(doc).length,
    orange: orangeOf(doc),
    isActive: (part: TextPart) => current.current?.part === part,
    isQuiet: () => quiet.current,
    focusQuietly: (el: HTMLElement | null) => {
      quiet.current = true;
      el?.focus({ preventScroll: true });
      quiet.current = false;
    },
    takeReturn: (part: TextPart) => {
      if (returnTo.current !== part) return false;
      returnTo.current = null;
      return true;
    },
    begin,
    change: (part: TextPart, text: string) => edit((d) => write(d, part, text)),
    // Enter on a one-line field, or a click elsewhere.
    commit: (part: TextPart, refocus = false) => {
      if (current.current?.part !== part) return;
      finish();
      if (refocus) returnTo.current = part;
      show(null);
    },
    cancel: (part: TextPart) => {
      const s = session.current;
      if (current.current?.part !== part) return;
      if (s) edit((d) => restore(d, s.from, s.group));
      session.current = null;
      returnTo.current = part;
      show(null);
    },
    // Tab and Shift+Tab: false when there is no field that way.
    move: (part: TextPart, by: 1 | -1) => {
      const parts = partsOf(latest.current);
      const next = parts[parts.indexOf(part) + by];
      if (!next) return false;
      begin(next, "all");
      return true;
    },
    // The headline behaves as one block of lines.
    split: (i: number, start: number, end: number) => {
      edit((d) => {
        const title = [...titleLines(d)];
        const line = title[i] ?? "";
        title.splice(i, 1, line.slice(0, start), line.slice(end));
        return withTitle(d, title);
      });
      begin(`title.${i + 1}`, caret(0));
    },
    joinUp: (i: number) => {
      const above = titleLines(latest.current)[i - 1] ?? "";
      edit((d) => {
        const title = [...titleLines(d)];
        title.splice(i - 1, 2, (title[i - 1] ?? "") + (title[i] ?? ""));
        return withTitle(d, title);
      });
      begin(`title.${i - 1}`, caret(above.length));
    },
    joinDown: (i: number) => {
      const here = titleLines(latest.current)[i] ?? "";
      edit((d) => {
        const title = [...titleLines(d)];
        title.splice(i, 2, (title[i] ?? "") + (title[i + 1] ?? ""));
        return withTitle(d, title);
      });
      begin(`title.${i}`, caret(here.length));
    },
    dropFirst: () => {
      edit((d) => withTitle(d, titleLines(d).slice(1)));
      begin("title.0", caret(0));
    },
    toggleOrange: (words: string[]) =>
      edit((d) => ({ ...d, location: { ...d.location, orange: toggled(d, words) } })),
  };
}

type Editing = ReturnType<typeof useInlineEditing>;
export const EditingContext = createContext<Editing | null>(null);
// The preview's own box, unscaled, for things drawn over the post.
export const StageContext = createContext<HTMLElement | null>(null);

function useEditing() {
  const editing = useContext(EditingContext);
  if (!editing) throw new Error("InlineField needs an EditingContext");
  return editing;
}

function labelOf(part: TextPart) {
  const n = lineOf(part) + 1;
  switch (groupOf(part)) {
    case "title":
      return `Headline, line ${n}`;
    case "date":
      return `Date, line ${n}`;
    case "location":
      return `Location, line ${n}`;
    case "name":
      return "Speaker name";
    case "role":
      return "Role";
    case "company":
      return "Company";
  }
}

// Shown faintly on the post, in the tool only, where a field is empty.
function placeholderOf(part: TextPart) {
  switch (part) {
    case "date.0":
      return "Day and time";
    case "date.1":
      return "Date";
    case "location.0":
      return "Venue";
    case "location.1":
      return "City";
    case "name":
      return "Speaker name";
    case "role":
      return "Role";
    case "company":
      return "Company";
    default:
      return "Headline";
  }
}

// Where a click or a drag landed in the words, as character offsets.
function pickedIn(root: HTMLElement, length: number, x: number, y: number): Select {
  const at = (node: Node | null, offset: number) => {
    if (!node) return length;
    if (!root.contains(node)) {
      return root.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING ? length : 0;
    }
    const range = document.createRange();
    range.selectNodeContents(root);
    range.setEnd(node, offset);
    return Math.min(length, range.toString().length);
  };
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && (root.contains(sel.anchorNode) || root.contains(sel.focusNode))) {
    const a = at(sel.anchorNode, sel.anchorOffset);
    const b = at(sel.focusNode, sel.focusOffset);
    return { start: Math.min(a, b), end: Math.max(a, b) };
  }
  const hit = document.caretRangeFromPoint?.(x, y);
  if (hit && root.contains(hit.startContainer)) {
    const k = at(hit.startContainer, hit.startOffset);
    return { start: k, end: k };
  }
  return "end";
}

// A text node and offset for a character offset in the words.
function pointAt(root: Node, offset: number): [Node, number] | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let left = offset;
  let last: Text | null = null;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (left <= node.length) return [node, left];
    left -= node.length;
    last = node;
  }
  return last ? [last, last.length] : null;
}

// The ring around words is one line tall (1lh), not the taller box the type
// sits in, so it never cuts through the line above or below. Post pixels
// are scaled down in the preview; --px is one screen pixel.
const RING =
  "relative outline-none before:pointer-events-none before:absolute before:-inset-x-[calc(var(--px)*5)] before:top-1/2 before:h-[calc(1lh_+_var(--px)*2)] before:-translate-y-1/2 before:rounded-[calc(var(--px)*5)] before:transition-colors before:duration-150";
const IDLE = `${RING} cursor-text before:border-[length:var(--px)] before:border-transparent hover:before:border-black/25 focus-visible:before:border-[length:calc(var(--px)*2)] focus-visible:before:border-black/55`;
const EDITING = `${RING} before:border-[length:calc(var(--px)*1.5)] before:border-black/45`;

export function InlineField({ part, children }: { part: TextPart; children: ReactNode }) {
  const editing = useEditing();
  const stage = useContext(StageContext);
  const value = editing.value(part);
  const active = editing.active?.part === part ? editing.active : null;
  const shell = useRef<HTMLSpanElement>(null);
  const words = useRef<HTMLSpanElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const orangeButton = useRef<HTMLButtonElement>(null);
  const placeholder = placeholderOf(part);
  const label = labelOf(part);
  const group = groupOf(part);
  const line = lineOf(part);

  // The selection, as last reported by the input; until then, the one the
  // field was opened with.
  const [tracked, setTracked] = useState<{ seq: number; start: number; end: number } | null>(null);
  const opened = active?.select ?? "end";
  const [start, end] =
    active && tracked?.seq === active.seq
      ? [tracked.start, tracked.end]
      : opened === "all"
        ? [0, value.length]
        : opened === "end"
          ? [value.length, value.length]
          : [opened.start, opened.end];
  const chosen = active && group === "location" && start !== end ? wordsIn(value, start, end) : [];
  const allOrange = chosen.length > 0 && chosen.every((w) => editing.orange.some((o) => same(o, w)));
  // A raised ordinal (20th) is narrower than the input's own letters, so a
  // line with one is shown plain while it is edited, keeping the caret true.
  const plain = active && /\d(?:st|nd|rd|th)\b/.test(value);

  // Opening: the caret where the click landed, or the dragged words selected.
  useLayoutEffect(() => {
    const el = input.current;
    if (!active || !el) return;
    el.focus({ preventScroll: true });
    const n = el.value.length;
    el.setSelectionRange(Math.min(start, n), Math.min(end, n));
    // Only when the field opens, or is opened again at a new place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.seq]);

  // The input never scrolls, so its text stays exactly over the words.
  useLayoutEffect(() => {
    if (input.current) input.current.scrollLeft = 0;
  });

  // Escape or Enter hand the focus back to the words, ready for Tab.
  useLayoutEffect(() => {
    if (!active && editing.takeReturn(part)) editing.focusQuietly(shell.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // The toolbar floats over the middle of the selected words.
  useLayoutEffect(() => {
    const bar = toolbar.current;
    const root = words.current;
    if (!bar || !root || !stage) return;
    const a = pointAt(root, start);
    const b = pointAt(root, end);
    if (!a || !b) return;
    const range = document.createRange();
    range.setStart(...a);
    range.setEnd(...b);
    const r = range.getBoundingClientRect();
    const box = stage.getBoundingClientRect();
    bar.style.left = `${r.left + r.width / 2 - box.left}px`;
    bar.style.top = `${r.top - box.top}px`;
    bar.style.visibility = "visible";
  });

  const track = () => {
    const el = input.current;
    if (el && active) setTracked({ seq: active.seq, start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 });
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    const s = el.selectionStart ?? 0;
    const t = el.selectionEnd ?? 0;
    const title = group === "title";
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        editing.cancel(part);
        return;
      case "Enter":
        e.preventDefault();
        if (title) editing.split(line, s, t);
        else editing.commit(part, true);
        return;
      case "Tab":
        if (chosen.length > 0 && !e.shiftKey) {
          e.preventDefault();
          orangeButton.current?.focus();
        } else if (editing.move(part, e.shiftKey ? -1 : 1)) {
          e.preventDefault();
        }
        return;
      case "Backspace":
        if (!title || s !== 0 || t !== 0) return;
        if (line > 0) {
          e.preventDefault();
          editing.joinUp(line);
        } else if (value === "" && editing.lines > 1) {
          e.preventDefault();
          editing.dropFirst();
        }
        return;
      case "Delete":
        if (title && s === t && s === value.length && line < editing.lines - 1) {
          e.preventDefault();
          editing.joinDown(line);
        }
        return;
      case "ArrowUp":
      case "ArrowDown": {
        const to = line + (e.key === "ArrowUp" ? -1 : 1);
        if (!title || e.shiftKey || to < 0 || to >= editing.lines) return;
        e.preventDefault();
        editing.begin(`title.${to}`, { start: s, end: s });
        return;
      }
    }
  };

  const onBlur = (e: FocusEvent<HTMLInputElement>) => {
    if (!editing.isActive(part)) return;
    if (toolbar.current?.contains(e.relatedTarget as Node | null)) return;
    // Another window took the focus; editing carries on when it comes back.
    if (!document.hasFocus()) return;
    editing.commit(part);
  };

  // Resting, the words are a button: click, Enter or Tab opens them.
  const resting = active
    ? {}
    : {
        role: "button",
        tabIndex: 0,
        "aria-label": `Edit ${label.toLowerCase()}`,
        onClick: (e: MouseEvent<HTMLSpanElement>) => {
          if (words.current) editing.begin(part, pickedIn(words.current, value.length, e.clientX, e.clientY));
        },
        onFocus: (e: FocusEvent<HTMLSpanElement>) => {
          if (!editing.isQuiet() && e.currentTarget.matches(":focus-visible")) editing.begin(part, "all");
        },
        onKeyDown: (e: KeyboardEvent<HTMLSpanElement>) => {
          if (e.key !== "Enter" && e.key !== " " && e.key !== "F2") return;
          e.preventDefault();
          editing.begin(part, "end");
        },
      };

  return (
    <span ref={shell} className={active ? EDITING : IDLE} data-field={part} {...resting}>
      <span ref={words} aria-hidden={active ? true : undefined}>
        {value ? (plain ? value : children) : <span className={active ? "invisible" : "opacity-30"}>{placeholder}</span>}
      </span>
      {active && (
        <input
          ref={input}
          value={value}
          placeholder={placeholder}
          aria-label={label}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          enterKeyHint={group === "title" ? "enter" : "done"}
          className="absolute inset-y-0 left-0 text-transparent outline-none selection:bg-black/15 selection:text-transparent placeholder:text-black/30"
          style={{ width: "calc(100% + 0.3em)", caretColor: PALETTE.ink }}
          onChange={(e) => editing.change(part, e.target.value)}
          onKeyDown={onKey}
          onBlur={onBlur}
          onSelect={track}
          onScroll={(e) => {
            e.currentTarget.scrollLeft = 0;
          }}
        />
      )}
      {chosen.length > 0 &&
        stage &&
        createPortal(
          <div
            ref={toolbar}
            role="toolbar"
            aria-label="Selected words"
            className={cn(
              SURFACE,
              "pointer-events-auto absolute z-30 -translate-x-1/2 -translate-y-[calc(100%_+_10px)] p-1 shadow-lg shadow-shade/25",
            )}
            style={{ visibility: "hidden" }}
          >
            <button
              ref={orangeButton}
              type="button"
              aria-pressed={allOrange}
              className="flex h-7 cursor-pointer items-center gap-2 rounded-[9px] px-2.5 text-white/80 outline-none transition-colors hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-ring aria-pressed:text-white"
              // Keeps the words selected and the field open.
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => editing.toggleOrange(chosen)}
              onKeyDown={(e) => {
                if (e.key === "Escape" || (e.key === "Tab" && e.shiftKey)) {
                  e.preventDefault();
                  input.current?.focus({ preventScroll: true });
                } else if (e.key === "Tab") {
                  if (editing.move(part, 1)) e.preventDefault();
                  else editing.commit(part);
                }
              }}
              onBlur={(e) => {
                if (e.relatedTarget !== input.current && document.hasFocus()) editing.commit(part);
              }}
            >
              <span
                aria-hidden="true"
                className="size-2.5 rounded-full transition-colors"
                style={{
                  background: allOrange ? PALETTE.orange : "transparent",
                  boxShadow: `inset 0 0 0 1.5px ${PALETTE.orange}`,
                }}
              />
              Orange
            </button>
          </div>,
          stage,
        )}
    </span>
  );
}
