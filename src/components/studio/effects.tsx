"use client";

import { Popover } from "@base-ui/react/popover";
import { useRef, useState } from "react";
import { SURFACE } from "@/components/tool/dial";
import { EFFECTS, type Effect } from "@/lib/studio/effects";
import { cn } from "@/lib/utils";
import { ITEM, MENU_POPUP } from "./home-parts";
import { PILL_BUTTON } from "./panel";

// The ready-made effects (effects.ts): a page of tiles, each a live preview
// that plays while the pointer is over it and starts a film with the effect
// when clicked, and a menu in a film's chat that asks Claude to add one.

export function EffectsPage({ onUse }: { onUse: (prompt: string) => void }) {
  return (
    <section aria-labelledby="effects-heading" className="mx-auto flex max-w-[1180px] flex-col gap-5 px-8 pt-10 pb-20">
      <header className="flex flex-col gap-1.5 px-1">
        <h1 id="effects-heading" className="font-medium text-[20px] text-white/95 tracking-[-0.01em]">
          Effects
        </h1>
        <p className="text-[12.5px] text-white/50">Pick a ready-made move to start a film.</p>
      </header>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
        {EFFECTS.map((e) => (
          <li key={e.id}>
            <EffectTile effect={e} onUse={() => onUse(e.start)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// A tile: the preview runs in its own frame, still until the pointer (or
// keyboard focus) arrives, then from the start.
function EffectTile({ effect, onUse }: { effect: Effect; onUse: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const say = (preview: "play" | "stop") => frame.current?.contentWindow?.postMessage({ preview }, "*");
  return (
    <div className="group/effect relative flex flex-col gap-2 rounded-[14px] p-1.5 transition-[background-color] duration-200 ease-out has-[button:hover]:bg-white/[0.04]">
      <span className="relative block aspect-video w-full overflow-hidden rounded-[10px] bg-[#141414] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
        <iframe
          ref={frame}
          title={`${effect.name}, a preview`}
          src={`/api/studio/effects/${effect.id}`}
          sandbox="allow-scripts"
          loading="lazy"
          tabIndex={-1}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 size-full border-0"
        />
      </span>
      <span className="flex flex-col gap-0.5 px-1 pb-0.5">
        <span className="text-[12.5px] text-white/90">{effect.name}</span>
        <span className="text-[11.5px] text-white/40 leading-snug">{effect.note}</span>
      </span>
      <button
        type="button"
        aria-label={`Start a film with ${effect.name.toLowerCase()}`}
        onClick={onUse}
        onPointerEnter={() => say("play")}
        onPointerLeave={() => say("stop")}
        onFocus={() => say("play")}
        onBlur={() => say("stop")}
        className="absolute inset-0 cursor-pointer rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}

// In a film's chat: pick an effect and its ask lands in the prompt, to
// change before sending.
export function EffectsMenu({ onPick }: { onPick: (prompt: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={cn(
          PILL_BUTTON,
          "h-7 px-2.5 text-white/60 hover:bg-white/[0.08] hover:text-white data-popup-open:bg-white/[0.08] data-popup-open:text-white",
        )}
      >
        Effects
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8} collisionPadding={12} className="z-50">
          <Popover.Popup className={cn(SURFACE, MENU_POPUP, "flex max-h-[min(420px,70vh)] w-[288px] flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden")}>
            <p className="px-2 pt-1 pb-1 text-[11px] text-white/35">Add an effect</p>
            {EFFECTS.map((e) => (
              <button
                key={e.id}
                type="button"
                className={cn(ITEM, "flex-col items-start gap-0.5 py-2")}
                onClick={() => {
                  onPick(e.add);
                  setOpen(false);
                }}
              >
                <span className="text-white/90">{e.name}</span>
                <span className="text-[11.5px] text-white/40 leading-snug">{e.note}</span>
              </button>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
