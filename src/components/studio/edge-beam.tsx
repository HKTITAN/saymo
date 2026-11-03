"use client";

import { BorderBeam } from "border-beam";
import { useCallback, useState, useSyncExternalStore } from "react";

// A light that rides a box's edge (border-beam, MIT, libraries.dev/beam).
// Two moods:
//   "work"  a calm grey light while Claude makes the film
//   "drop"  a warm Aerchain-orange light while something is held over a
//           place that takes it
// It sits on top of its box as an overlay (absolute, inset 0, no pointer
// events), so the box never changes size or moves when it turns on. The
// box needs `position: relative` (or any positioning) and its own rounded
// corners, which the light copies. Off, nothing is mounted; it fades out
// before it goes. With reduced motion, a still hairline shows instead.

type Tone = "work" | "drop";

const ORANGE = "245, 90, 0";

// The library's own layers, recoloured to Aerchain orange for "drop":
// the stroke (::after), the soft inner glow (::before) and the bloom.
const DROP_CSS = `
[data-beam="{id}"][data-active]::after,
[data-beam="{id}"][data-fading]::after {
  background: conic-gradient(
    from var(--beam-angle-{id}),
    transparent 0%, transparent 52%,
    rgba(${ORANGE}, 0.18) 56%,
    rgba(${ORANGE}, 0.6) 61%,
    rgba(255, 150, 90, 1) 66%,
    rgba(${ORANGE}, 0.6) 71%,
    rgba(${ORANGE}, 0.18) 76%,
    transparent 80%, transparent 100%
  );
}
[data-beam="{id}"][data-active]::before,
[data-beam="{id}"][data-fading]::before {
  background: rgba(${ORANGE}, 0.06);
  box-shadow: inset 0 0 6px 1px rgba(${ORANGE}, 0.45);
}
[data-beam="{id}"] [data-beam-bloom] {
  background: conic-gradient(
    from var(--beam-angle-{id}),
    transparent 0%, transparent 60%,
    rgba(${ORANGE}, 0.25) 66%,
    rgba(255, 140, 70, 0.9) 70%,
    rgba(${ORANGE}, 0.25) 74%,
    transparent 80%
  );
}
`;

// The library's md preset keeps its stroke faint (it leans on a coloured
// inner glow); on these dark greys that reads as nothing, so the stroke
// and bloom are lifted through the library's own opacity variables.
const LAYERS: Record<Tone, Record<string, number>> = {
  work: { "--beam-stroke-opacity": 4, "--beam-inner-opacity": 1, "--beam-bloom-opacity": 1.6 },
  drop: { "--beam-stroke-opacity": 5, "--beam-inner-opacity": 1, "--beam-bloom-opacity": 2 },
};

const STILL: Record<Tone, string> = {
  work: "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]",
  drop: "shadow-[inset_0_0_0_1px_rgba(245,90,0,0.6)]",
};

export function EdgeBeam({ on, tone = "work" }: { on: boolean; tone?: Tone }) {
  // Mounted while on, and until its fade-out ends.
  const [mounted, setMounted] = useState(on);
  if (on && !mounted) setMounted(true);
  const [radius, setRadius] = useState<number | undefined>(undefined);
  const still = useReducedMotion();

  // The box's own corner, read once the overlay is in it.
  const measure = useCallback((el: HTMLDivElement | null) => {
    const box = el?.parentElement?.parentElement;
    if (!box) return;
    const r = Number.parseFloat(getComputedStyle(box).borderTopLeftRadius);
    if (!Number.isNaN(r)) setRadius(r);
  }, []);

  if (still) {
    return on ? <span aria-hidden="true" className={`pointer-events-none absolute inset-0 rounded-[inherit] ${STILL[tone]}`} /> : null;
  }
  if (!mounted) return null;
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit]">
      <BorderBeam
        ref={measure}
        active={on}
        onDeactivate={() => setMounted(false)}
        size="md"
        theme="dark"
        colorVariant={tone === "work" ? "mono" : "sunset"}
        staticColors
        strength={tone === "work" ? 0.7 : 0.85}
        duration={tone === "work" ? 3.6 : 2.6}
        borderRadius={radius}
        css={tone === "drop" ? DROP_CSS : undefined}
        style={{ position: "absolute", inset: 0, ...LAYERS[tone] }}
      >
        <span />
      </BorderBeam>
    </span>
  );
}

const reduced = "(prefers-reduced-motion: reduce)";
const subscribe = (change: () => void) => {
  const q = window.matchMedia(reduced);
  q.addEventListener("change", change);
  return () => q.removeEventListener("change", change);
};
function useReducedMotion() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(reduced).matches,
    () => false,
  );
}
