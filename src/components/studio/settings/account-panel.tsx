"use client";

import { Popover } from "@base-ui/react/popover";
import { useEffect, useState } from "react";
import { CheckTickCircleIcon, Settings01Icon } from "@/components/icons";
import { SURFACE } from "@/components/ui/dial";
import { type AiStatus, modelName, PROVIDERS, type ProviderId, type ProviderStatus } from "@/lib/studio/agent/ai-types";
import { cn } from "@/lib/utils";
import { aiApi, useAiChoice } from "../api/ai";
import { stateWords } from "./ai-connections";
import { ClaudeMark, CodexMark } from "./ai-marks";
import { ITEM, MENU_POPUP } from "../home/home-parts";

// The foot of the sidebar: who's here (the name set in Settings, or the one
// this Mac knows them by), their edition, and the AI in use, its mark with a
// dot that's green when it's ready. Open, it shows that AI (switching and
// setting up live in Settings, so pressing it goes there) and is the way to
// Settings. Only what's real: the plan has no buy button until licences are
// sold.

// Settings sends this when the name changes, so the panel shows it at once.
export const ME_CHANGED = "saymo:me";

type Me = { name: string; edition: "in-house" | "product"; version: string };

const dotFor = (s: ProviderStatus | undefined) =>
  !s || s.state === "unknown" ? "bg-white/25" : s.state === "ready" ? "bg-[#3ecf8e]" : "bg-[#febc2e]";

export function AccountRow({ on = false, onSettings }: { on?: boolean; onSettings: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [open, setOpen] = useState(false);
  const choice = useAiChoice();

  const check = () =>
    aiApi
      .status()
      .then(setAi)
      .catch(() => {});
  useEffect(() => {
    let live = true;
    const who = () =>
      fetch("/api/studio/me", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((m: Me | null) => live && m && setMe(m))
        .catch(() => {});
    void who();
    aiApi
      .status()
      .then((s) => live && setAi(s))
      .catch(() => {});
    window.addEventListener(ME_CHANGED, who);
    return () => {
      live = false;
      window.removeEventListener(ME_CHANGED, who);
    };
  }, []);

  const statusOf = (id: ProviderId) => ai?.providers.find((p) => p.id === id);
  const current = statusOf(choice.provider);
  const name = me?.name || "You";
  const product = me?.edition === "product";
  const plan = product ? "Free plan" : "Team edition";
  const aiSays = !current ? "checking" : current.state === "ready" ? "is ready" : "needs setting up";
  const settings = () => {
    setOpen(false);
    onSettings();
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // One may have been set up since it was last open.
        if (next) void check();
      }}
    >
      <Popover.Trigger
        aria-label={`${name}, ${plan}. ${PROVIDERS[choice.provider].name} ${aiSays}`}
        className={cn(
          "mt-1 flex w-full cursor-pointer items-center gap-2.5 rounded-[11px] px-2 py-1.5 text-left outline-none transition-colors hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-white/[0.07]",
          on && "bg-white/[0.08] hover:bg-white/[0.08]",
        )}
      >
        <Avatar name={name} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[12.5px] text-white/90">{name}</span>
          <span className="truncate text-[11px] text-white/40">{plan}</span>
        </span>
        {/* The AI in use, and whether it's ready. */}
        <span aria-hidden="true" className="relative flex size-6 shrink-0 items-center justify-center text-white/45">
          <AiMark id={choice.provider} className="size-3.5" />
          <span className={cn("absolute right-0 bottom-0.5 size-[7px] rounded-full ring-2 ring-app", dotFor(current))} />
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8} collisionPadding={12} className="z-50">
          <Popover.Popup className={cn(SURFACE, MENU_POPUP, "flex w-[284px] flex-col p-1.5")}>
            <div className="flex items-center gap-3 px-2 pt-2 pb-3">
              <Avatar name={name} big />
              <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                <span className="max-w-full truncate font-medium text-[13.5px] text-white">{name}</span>
                <span className={cn("rounded-full px-2 py-px font-medium text-[10.5px]", product ? "bg-white/[0.08] text-white/60" : "bg-[#a79dff]/15 text-[#cdc7ff]")}>
                  {plan}
                </span>
              </span>
            </div>

            <div className="flex flex-col rounded-[12px] bg-white/[0.035] p-1">
              <p className="px-2 pt-1 pb-1.5 text-[11px] text-white/40">Your AI, for every prompt</p>
              <AiInUse id={choice.provider} status={current} model={modelName(choice.model)} onOpen={settings} />
            </div>

            <button type="button" className={cn(ITEM, "mt-1.5")} onClick={settings}>
              <Settings01Icon aria-hidden="true" />
              Profile and settings
            </button>
            {me?.version ? <p className="px-2 pt-1.5 pb-1 text-[11px] text-white/30 tabular-nums">Saymo {me.version}</p> : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

// The AI in use: its maker's mark, its name, and how it's paid or what it
// still needs. Pressing it opens Settings, where AIs are switched and set up.
function AiInUse({ id, status, model, onOpen }: { id: ProviderId; status: ProviderStatus | undefined; model: string; onOpen: () => void }) {
  const ready = status?.state === "ready";
  const paid = id === "api-key" ? (status?.keyEnding ? `Key ending ${status.keyEnding}` : "Key saved") : (status?.plan ?? PROVIDERS[id].via);
  const line = !status ? "Checking" : ready ? (id !== "codex" ? `${paid} · ${model}` : paid) : stateWords(status);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${PROVIDERS[id].name}, ${line}. Change in Settings`}
      className="flex w-full cursor-pointer items-center gap-2.5 rounded-[9px] bg-white/[0.07] px-2 py-1.5 text-left outline-none transition-colors hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-white/[0.07]">
        <AiMark id={id} className={cn("size-3.5", id === "codex" ? "text-white/85" : "text-[#d97757]")} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[12.5px] text-white/90">{PROVIDERS[id].name}</span>
        <span className={cn("flex min-w-0 items-center gap-1.5 text-[11px]", status && !ready ? "text-warn/85" : "text-white/40")}>
          <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", dotFor(status))} />
          <span className="truncate">{line}</span>
        </span>
      </span>
      {status && !ready ? (
        <span className="shrink-0 text-[11px] text-white/50">Set up</span>
      ) : (
        <CheckTickCircleIcon aria-hidden="true" className="size-4 shrink-0 text-white/80" />
      )}
    </button>
  );
}

function AiMark({ id, className }: { id: ProviderId; className?: string }) {
  return id === "codex" ? <CodexMark className={className} /> : <ClaudeMark className={className} />;
}

// Their initial on a soft lavender disc.
function Avatar({ name, big = false }: { name: string; big?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn("flex shrink-0 items-center justify-center rounded-full bg-[#e9e6ff] font-semibold text-[#38358a]", big ? "size-10 text-[15px]" : "size-7 text-[12px]")}
    >
      {(name.trim()[0] ?? "Y").toUpperCase()}
    </span>
  );
}
