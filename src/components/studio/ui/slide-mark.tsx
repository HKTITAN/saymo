"use client";

import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// How the studio's switches move. What's picked has one highlight that
// slides (and stretches) from the old choice to the new one: give each
// option `ref={slide.ref(i)}`, draw <SlideMark> first inside the group
// (which is `relative`, the options too), and keep each option's own
// highlight only for before the mark is measured (`slide.mark` is null).
// What a switch swaps in below it can sit in a <Glide>, whose height
// eases to the new content's instead of jumping.

export type Mark = { left: number; top: number; width: number; height: number };

const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";

export function useSlide(at: number) {
  const items = useRef<(HTMLElement | null)[]>([]);
  const [mark, setMark] = useState<Mark | null>(null);
  useLayoutEffect(() => {
    let live = true;
    const place = () => {
      const el = items.current[at];
      if (!live || !el) return;
      const next = { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
      setMark((m) => (m && m.left === next.left && m.top === next.top && m.width === next.width && m.height === next.height ? m : next));
    };
    place();
    // The words' widths settle once the font has loaded, and change with the window.
    void document.fonts?.ready.then(place);
    const watch = new ResizeObserver(place);
    for (const el of items.current) if (el) watch.observe(el);
    return () => {
      live = false;
      watch.disconnect();
    };
  }, [at]);
  const ref = (i: number) => (el: HTMLElement | null) => {
    items.current[i] = el;
  };
  return { mark, ref };
}

export function SlideMark({ mark, className }: { mark: Mark | null; className?: string }) {
  if (!mark) return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute top-0 left-0 transition-[transform,width,height] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
        className,
      )}
      style={{ width: mark.width, height: mark.height, transform: `translate(${mark.left}px, ${mark.top}px)` }}
    />
  );
}

// Eases its height from the old content's to the new one's when `at`
// changes (a switch swapping one form for another). Between switches it's
// left to size itself, so typing in a box inside never lags.
export function Glide({ at, children, className }: { at: string; children: ReactNode; className?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const last = useRef<number | null>(null);
  useLayoutEffect(() => {
    const content = inner.current;
    if (!content) return;
    const watch = new ResizeObserver(() => {
      last.current = content.offsetHeight;
    });
    watch.observe(content);
    return () => watch.disconnect();
  }, []);
  useLayoutEffect(() => {
    const box = outer.current;
    const content = inner.current;
    if (!box || !content) return;
    const from = last.current;
    const to = content.offsetHeight;
    last.current = to;
    if (from === null || from === to || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const done = () => {
      box.style.height = "";
      box.style.overflow = "";
      box.style.overflowClipMargin = "";
      box.style.transition = "";
    };
    box.style.height = `${from}px`;
    // Clipped while it moves, with room for focus rings at the edges.
    box.style.overflow = "clip";
    box.style.overflowClipMargin = "8px";
    box.getBoundingClientRect(); // the old height takes hold before the move
    box.style.transition = `height 300ms ${EASE}`;
    box.style.height = `${to}px`;
    const timer = setTimeout(done, 360);
    return () => {
      clearTimeout(timer);
      done();
    };
  }, [at]);
  return (
    <div ref={outer} className={className}>
      <div ref={inner}>{children}</div>
    </div>
  );
}
