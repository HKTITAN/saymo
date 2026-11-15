"use client";

import { BorderBeam } from "border-beam";
import { useCallback, useState, useSyncExternalStore } from "react";

// A light that rides a box's edge (border-beam, MIT, libraries.dev/beam).
// Two moods:
//   "work"  a pink light while Claude makes the film
//   "drop"  a pink light while something is held over a
//           place that takes it
// It sits on top of its box as an overlay (absolute, inset 0, no pointer
// events), so the box never changes size or moves when it turns on. The
// box needs `position: relative` (or any positioning) and its own rounded
// corners, which the light copies. Off, nothing is mounted; it fades out
// before it goes. With reduced motion, a still hairline shows instead.

type Tone = "work" | "drop";


// The library's own layers, recoloured: the stroke (::after), the soft
// inner glow (::before) and the bloom. both pink, the studio's accent.
const tint = (rgb: string, hot: string, deep: string) => `
[data-beam="{id}"][data-active]::after,
[data-beam="{id}"][data-fading]::after {
  background: conic-gradient(
    from var(--beam-angle-{id}),
    transparent 0%, transparent 38%,
    rgba(${deep}, 0.12) 46%,
    rgba(${deep}, 0.35) 54%,
    rgba(${rgb}, 0.7) 61%,
    rgba(${hot}, 1) 66%,
    rgba(${rgb}, 0.5) 70%,
    transparent 76%, transparent 100%
  );
}
[data-beam="{id}"][data-active]::before,
[data-beam="{id}"][data-fading]::before {
  background: rgba(${rgb}, 0.045);
  box-shadow: inset 0 0 10px 1px rgba(${rgb}, 0.28);
}
[data-beam="{id}"] [data-beam-bloom] {
  background: conic-gradient(
    from var(--beam-angle-{id}),
    transparent 0%, transparent 52%,
    rgba(${deep}, 0.18) 58%,
    rgba(${rgb}, 0.55) 64%,
    rgba(${hot}, 0.7) 67%,
    rgba(${rgb}, 0.2) 71%,
    transparent 76%
  );
}
`;
const PINK = "236, 121, 169";
// Pink all the way along, never white: a long tail that deepens to
// magenta, the studio's pink in the middle and a lighter pink at the head.
const CSS: Record<Tone, string> = {
  work: tint(PINK, "255, 163, 200", "177, 69, 118"),
  drop: tint(PINK, "255, 163, 200", "177, 69, 118"),
};

// The library's md preset keeps its stroke faint (it leans on a coloured
// inner glow); on these dark greys that reads as nothing, so the stroke
// and bloom are lifted through the library's own opacity variables.
const LAYERS: Record<Tone, Record<string, number>> = {
  work: { "--beam-stroke-opacity": 5, "--beam-inner-opacity": 1.2, "--beam-bloom-opacity": 2.2 },
  drop: { "--beam-stroke-opacity": 5, "--beam-inner-opacity": 1, "--beam-bloom-opacity": 2 },
};

const STILL: Record<Tone, string> = {
  work: "shadow-[inset_0_0_0_1px_rgba(236,121,169,0.55)]",
  drop: "shadow-[inset_0_0_0_1px_rgba(236,121,169,0.7)]",
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
        colorVariant="candy"
        staticColors
        glowSize={tone === "work" ? 1.4 : 1}
        strength={0.85}
        duration={tone === "work" ? 4.8 : 2.6}
        borderRadius={radius}
        css={CSS[tone]}
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
