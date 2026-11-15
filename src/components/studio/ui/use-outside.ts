"use client";

import { type PointerEvent as ReactPointerEvent, type RefObject, useEffect, useRef } from "react";

// Pop-ups close when you press outside them, the same way everywhere (Base
// UI's popovers and menus already do; this is for the ones drawn by hand).
// A press counts when it starts outside: dragging a slider that began inside
// and letting go outside doesn't close, and neither does scrolling. A press
// in something the pop-up opened itself (a colour picker or a tooltip in a
// portal) still counts as inside: spread the returned props on the pop-up so
// its React children are seen wherever they're drawn. `ignore` names other
// places that don't count, such as the trigger. Presses on the film reach
// here too (see stage.tsx), though it's a page of its own.
export function useOutsideClose(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  { enabled = true, ignore }: { enabled?: boolean; ignore?: (target: Element) => boolean } = {},
) {
  const latest = useRef({ onClose, ignore });
  useEffect(() => {
    latest.current = { onClose, ignore };
  });
  // The last press that passed through the pop-up's own React tree.
  const inside = useRef<Event | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const el = ref.current;
      const target = e.target;
      if (!el || !(target instanceof Element) || el.contains(target)) return;
      if (latest.current.ignore?.(target)) return;
      // Decided once the press has passed through React, which marks it if
      // it landed in one of the pop-up's portals.
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (inside.current !== e) latest.current.onClose();
      }, 0);
    };
    document.addEventListener("pointerdown", down, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", down, true);
    };
  }, [ref, enabled]);

  return {
    onPointerDownCapture: (e: ReactPointerEvent) => {
      inside.current = e.nativeEvent;
    },
  };
}
