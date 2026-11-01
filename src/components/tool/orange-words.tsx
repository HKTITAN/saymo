"use client";

import type { CSSProperties } from "react";
import { PALETTE } from "@/components/post/palette";
import { WORD } from "@/components/post/post";
import { Toggle } from "@/components/ui/toggle";

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
    <div className="flex flex-col gap-2">
      <p className="font-medium text-sm" id="orange-words">
        Words in orange
      </p>
      {words.length > 0 ? (
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-labelledby="orange-words"
          style={{ "--orange": PALETTE.orange, "--ink": PALETTE.ink } as CSSProperties}
        >
          {words.map((word) => {
            const on = kept.some((w) => same(w, word));
            return (
              <Toggle
                key={word}
                variant="outline"
                size="sm"
                pressed={on}
                onPressedChange={(pressed) =>
                  onChange(pressed ? [...kept, word] : kept.filter((w) => !same(w, word)))
                }
                className="font-normal data-pressed:border-(--orange) data-pressed:bg-(--orange) data-pressed:text-(--ink) dark:data-pressed:bg-(--orange)"
              >
                {word}
              </Toggle>
            );
          })}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">Type the location above first.</p>
      )}
      <p className="text-muted-foreground text-xs">Tap words to set them in orange on the post, like the city.</p>
    </div>
  );
}
