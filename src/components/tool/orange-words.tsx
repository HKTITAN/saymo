"use client";

import type { CSSProperties } from "react";
import { PALETTE } from "@/components/post/palette";
import { WORD } from "@/components/post/post";
import { TogglePrimitive } from "@/components/ui/toggle";
import { DialNote } from "./dial";

// The location's own words, each a switch: on, it is set in orange on the
// post. Only words that are there can be picked, so a pick always shows.
export function OrangeWords({
  lines,
  value,
  onChange,
}: {
  lines: readonly string[];
  value: string[];
  onChange: (words: string[]) => void;
}) {
  const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
  const words: string[] = [];
  for (const line of lines) {
    for (const word of line.split(WORD).filter((_, i) => i % 2 === 1)) {
      if (!words.some((w) => same(w, word))) words.push(word);
    }
  }
  // Picks of words no longer in the lines are let go at the next tap.
  const kept = value.filter((w) => words.some((word) => same(word, w)));

  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <p className="px-1 text-[12px] text-white/65" id="orange-words">
        Words in orange
      </p>
      {words.length > 0 ? (
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-labelledby="orange-words"
          style={{ "--orange": PALETTE.orange, "--ink": PALETTE.ink } as CSSProperties}
        >
          {words.map((word) => (
            <TogglePrimitive
              key={word}
              pressed={kept.some((w) => same(w, word))}
              onPressedChange={(pressed) =>
                onChange(pressed ? [...kept, word] : kept.filter((w) => !same(w, word)))
              }
              className="h-7 cursor-pointer rounded-[8px] bg-white/[0.05] px-2.5 text-[12px] text-white/80 outline-none transition-colors hover:bg-white/[0.09] focus-visible:ring-2 focus-visible:ring-ring data-pressed:bg-(--orange) data-pressed:text-(--ink) data-pressed:hover:bg-(--orange)"
            >
              {word}
            </TogglePrimitive>
          ))}
        </div>
      ) : (
        <DialNote>Type the location above first.</DialNote>
      )}
      <DialNote>Tap words to set them in orange on the post, like the city.</DialNote>
    </div>
  );
}
