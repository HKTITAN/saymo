"use client";

import { Popover } from "@base-ui/react/popover";
import { useEffect, useState } from "react";
import { ChevronDownIcon } from "@/components/icons";
import { SURFACE } from "@/components/tool/dial";
import { type AiStatus, choiceShort, DEFAULT_PROVIDER, OFFERED_PROVIDERS, PROVIDERS, type ProviderId } from "@/lib/studio/ai-types";
import { cn } from "@/lib/utils";
import { aiApi, useAiChoice } from "./ai-api";
import { stateWords } from "./ai-connections";
import { Hint, PILL_BUTTON } from "./panel";

// The small "Claude ⌄" in a prompt box: which AI this prompt goes to.
// Claude is the default; the last pick is kept per film (use-chat.ts). It
// lists only the AIs this edition offers: the API key alone in the product.
// Esc or a click outside closes it.

const POPUP =
  "origin-(--transform-origin) outline-none transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0";

export function ModelPicker({ provider, onChange }: { provider: ProviderId; onChange: (provider: ProviderId) => void }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AiStatus | null>(null);
  // "Opus 5.5 · High" as chosen in Settings; Codex keeps its own name.
  const choice = useAiChoice();
  const short = provider === "codex" ? PROVIDERS.codex.short : provider === "api-key" ? choiceShort(choice).replace(/ · .*$/, " · Key") : choiceShort(choice);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void aiApi
      .status()
      .then((s) => live && setStatus(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Hint label="Choose the AI for this prompt">
        <Popover.Trigger
          className={cn(PILL_BUTTON, "h-7 min-w-0 !shrink gap-1 px-1.5 text-white/60 hover:bg-white/[0.08] hover:text-white data-popup-open:bg-white/[0.08] data-popup-open:text-white [&_svg]:size-3 [&_svg]:shrink-0")}
          aria-label={`AI for this prompt: ${PROVIDERS[provider].name}`}
        >
          {/* "Opus 5.5 · High": when the row is tight, the effort shortens
              first and the model's name stays whole. */}
          <span className="flex min-w-0">
            <span className="shrink-0">{short.split(" · ")[0]}</span>
            {short.includes(" · ") ? (
              <span className="min-w-0 truncate whitespace-pre">{` · ${short.split(" · ").slice(1).join(" · ")}`}</span>
            ) : null}
          </span>
          <ChevronDownIcon aria-hidden="true" />
        </Popover.Trigger>
      </Hint>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8} collisionPadding={12} className="z-50">
          <Popover.Popup className={cn(SURFACE, POPUP, "flex w-[300px] flex-col gap-0.5 p-1")}>
            <div role="radiogroup" aria-label="AI for this prompt" className="flex flex-col gap-0.5">
              {OFFERED_PROVIDERS.map((id) => {
                const s = status?.providers.find((p) => p.id === id);
                const chosen = id === provider;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    onClick={() => {
                      onChange(id);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex min-h-11 w-full cursor-pointer flex-col justify-center gap-0.5 rounded-[9px] px-2.5 py-1.5 text-left outline-none transition-colors hover:bg-white/[0.07] focus-visible:bg-white/[0.07]",
                      chosen && "bg-white/[0.1] hover:bg-white/[0.1]",
                    )}
                  >
                    <span className="flex w-full items-center gap-2">
                      <span className={cn("text-[12.5px]", chosen ? "text-white" : "text-white/80")}>{PROVIDERS[id].name}</span>
                      {id === DEFAULT_PROVIDER && OFFERED_PROVIDERS.length > 1 ?<span className="text-[11px] text-white/35">Default</span> : null}
                      <span
                        className={cn(
                          "ms-auto shrink-0 text-[11px]",
                          !s ? "text-white/25" : s.state === "ready" ? "text-white/45" : "text-[#ff9a5c]",
                        )}
                      >
                        {s ? stateWords(s) : "Checking"}
                      </span>
                    </span>
                    <span className="text-[11px] text-white/40">
                      {s?.model ?? PROVIDERS[id].model}
                      <span className="text-white/25"> · {s?.plan ?? PROVIDERS[id].via}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="px-2.5 pt-1 pb-1.5 text-[11px] text-white/35 leading-relaxed">To set one up, open the link button in the top right.</p>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
