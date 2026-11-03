"use client";

import { type CSSProperties, type PointerEvent, useEffect, useRef, useState } from "react";
import { type AiChoice, type AiStatus, choiceShort, OFFERED_PROVIDERS, type ProviderId, type ProviderStatus } from "@/lib/studio/ai-types";
import { cn } from "@/lib/utils";
import { aiApi } from "./ai-api";
import { stateWords } from "./ai-connections";

// "Bring your own AI", as a wallet: each AI the studio can use is a brushed
// silver card, the chosen one in front and the others peeking out behind.
// Click a card to bring it forward (that's the choice for every prompt).
// The front card tilts a little and catches the light under the pointer,
// unless Reduce Motion is on.

const CARD_W = 340;
const CARD_H = Math.round(CARD_W / 1.586); // a bank card's shape
const PEEK = 26; // how much of each card behind shows above the one in front

const NAMES: Record<ProviderId, { name: string; via: string }> = {
  claude: { name: "Claude", via: "Your Claude plan" },
  codex: { name: "Codex", via: "Your ChatGPT plan" },
  "api-key": { name: "Claude", via: "Your API key" },
};

export function AiWallet({ choice, onPick }: { choice: AiChoice; onPick: (provider: ProviderId) => void }) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  useEffect(() => {
    let live = true;
    void aiApi
      .status()
      .then((s) => live && setStatus(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [choice.provider]);

  // The chosen card in front; the others behind it, in their usual order.
  const order = [choice.provider, ...OFFERED_PROVIDERS.filter((p) => p !== choice.provider)];
  const behind = order.length - 1;
  return (
    <div
      role="radiogroup"
      aria-label="Prompts go to"
      className="relative mx-auto"
      style={{ width: CARD_W, height: CARD_H + behind * PEEK }}
    >
      {OFFERED_PROVIDERS.map((id) => {
        const rank = order.indexOf(id); // 0 in front
        return (
          <Card
            key={id}
            id={id}
            rank={rank}
            behind={behind}
            front={rank === 0}
            status={status?.providers.find((p) => p.id === id) ?? null}
            choice={choice}
            onPick={() => onPick(id)}
          />
        );
      })}
    </div>
  );
}

function Card({
  id,
  rank,
  behind,
  front,
  status,
  choice,
  onPick,
}: {
  id: ProviderId;
  rank: number;
  behind: number;
  front: boolean;
  status: ProviderStatus | null;
  choice: AiChoice;
  onPick: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [light, setLight] = useState<{ x: number; y: number } | null>(null);
  const still = useReducedMotion();
  const ready = status?.state === "ready";

  // Cards behind sit higher and a touch smaller, so their top edges show.
  const lift = (behind - rank) * PEEK;
  const shrink = 1 - rank * 0.04;
  const tilt = front && light && !still ? { x: (0.5 - light.y) * 7, y: (light.x - 0.5) * 9 } : { x: 0, y: 0 };

  const move = (e: PointerEvent<HTMLButtonElement>) => {
    if (!front) return;
    const r = e.currentTarget.getBoundingClientRect();
    setLight({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
  };

  const number =
    id === "api-key"
      ? `•••• •••• •••• ${status?.keyEnding ?? "····"}`
      : id === "codex"
        ? "Its own model"
        : choiceShort(choice);
  // The plan's own name when it's known; never the "via" line again.
  const holder = id === "api-key" ? "Billed to your key" : (status?.plan ?? (ready ? "Signed in" : "Not signed in"));

  return (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={front}
      aria-label={`${NAMES[id].name}, ${NAMES[id].via}${status ? `, ${stateWords(status)}` : ""}`}
      onClick={front ? undefined : onPick}
      onPointerMove={move}
      onPointerLeave={() => setLight(null)}
      className={cn(
        "absolute left-0 cursor-pointer rounded-[16px] text-left outline-none [transform-style:preserve-3d] focus-visible:ring-2 focus-visible:ring-white/60",
        "transition-[transform,top,filter] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
        front ? "cursor-default" : "hover:brightness-110",
      )}
      style={{
        width: CARD_W,
        height: CARD_H,
        top: lift,
        zIndex: 10 - rank,
        transform: `perspective(900px) scale(${shrink}) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
        transformOrigin: "50% 0%",
        filter: front ? undefined : `brightness(${0.78 - rank * 0.08})`,
      }}
    >
      <span className="absolute inset-0 overflow-hidden rounded-[16px]" style={silver(light, front && !still)} />
      {/* Behind: only the strip that shows, with the name and its line. */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-x-0 top-0 flex items-center justify-between px-5 text-[#2e3135] transition-opacity duration-300 motion-reduce:transition-none",
          front ? "opacity-0" : "opacity-100",
        )}
        style={{ ...EMBOSS, height: PEEK }}
      >
        <span className="font-semibold text-[12.5px]">{NAMES[id].name}</span>
        <span className="text-[9.5px] text-[#2e3135]/60 uppercase tracking-[0.12em]">{NAMES[id].via}</span>
      </span>
      {/* In front: name and maker's line, chip, number, holder, status. */}
      <span
        className={cn(
          "relative flex h-full flex-col justify-between p-5 text-[#2e3135] transition-opacity duration-300 motion-reduce:transition-none",
          front ? "opacity-100" : "opacity-0",
        )}
        style={EMBOSS}
      >
        <span className="flex items-start justify-between">
          <span className="flex flex-col leading-tight">
            <span className="font-semibold text-[17px] tracking-[-0.01em]">{NAMES[id].name}</span>
            <span className="text-[10.5px] text-[#2e3135]/60 uppercase tracking-[0.12em]">{NAMES[id].via}</span>
          </span>
          <span className="pt-1 font-medium text-[10px] text-[#2e3135]/55 uppercase tracking-[0.16em]">Motion Studio</span>
        </span>
        <Chip />
        <span className="font-medium text-[17px] tabular-nums tracking-[0.14em]">{number}</span>
        <span className="flex items-end justify-between">
          <span className="flex flex-col leading-tight">
            <span className="text-[8.5px] text-[#2e3135]/50 uppercase tracking-[0.18em]">Plan</span>
            <span className="font-medium text-[12px] uppercase tracking-[0.1em]">{holder}</span>
          </span>
          <span className="flex items-center gap-1.5 rounded-full bg-[#1b1d20]/80 px-2 py-0.5 text-[10.5px] text-white/85 [text-shadow:none]">
            <span aria-hidden="true" className={cn("size-1.5 rounded-full", !status ? "bg-white/40" : ready ? "bg-[#3dd68c]" : "bg-[#ff9a5c]")} />
            {status ? stateWords(status) : "Checking"}
          </span>
        </span>
      </span>
    </button>
  );
}

// Brushed silver: a cool metal ramp, fine horizontal grain, a bevelled edge,
// and a soft highlight that follows the pointer on the front card.
function silver(light: { x: number; y: number } | null, lit: boolean): CSSProperties {
  const x = `${Math.round((light?.x ?? 0.28) * 100)}%`;
  const y = `${Math.round((light?.y ?? 0.18) * 100)}%`;
  return {
    background: [
      `radial-gradient(90% 70% at ${x} ${y}, rgba(255,255,255,${lit && light ? 0.55 : 0.32}), rgba(255,255,255,0) 60%)`,
      "repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 1px, rgba(0,0,0,0.035) 1px 2px)",
      "linear-gradient(118deg, #f1f2f4 0%, #c7cace 24%, #eceef0 41%, #a9adb3 63%, #dadde0 80%, #b4b8be 100%)",
    ].join(","),
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 0 rgba(0,0,0,0.28), inset 1px 0 0 rgba(255,255,255,0.4), inset -1px 0 0 rgba(0,0,0,0.15), 0 22px 44px -16px rgba(0,0,0,0.85), 0 3px 8px rgba(0,0,0,0.45)",
    transition: "background-position 120ms linear",
  };
}

// Letters pressed into the metal: light below, shade above.
const EMBOSS: CSSProperties = { textShadow: "0 1px 0 rgba(255,255,255,0.65), 0 -1px 0 rgba(0,0,0,0.22)" };

// The contact chip: soft gold with its pads.
function Chip() {
  return (
    <span
      aria-hidden="true"
      className="relative block h-[30px] w-[42px] overflow-hidden rounded-[7px]"
      style={{
        background: "linear-gradient(135deg, #e9d9a6 0%, #c9b072 45%, #f0e2b4 70%, #b89c5c 100%)",
        boxShadow: "inset 0 0 0 1px rgba(90,70,30,0.35), inset 0 1px 0 rgba(255,255,255,0.5)",
      }}
    >
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[#7a6230]/45" />
      <span className="absolute inset-y-0 left-1/3 w-px bg-[#7a6230]/45" />
      <span className="absolute inset-y-0 left-2/3 w-px bg-[#7a6230]/45" />
      <span className="absolute top-1/2 left-1/2 h-[12px] w-[14px] -translate-x-1/2 -translate-y-1/2 rounded-[3px] border border-[#7a6230]/45" />
    </span>
  );
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const set = () => setReduced(q.matches);
    set();
    q.addEventListener("change", set);
    return () => q.removeEventListener("change", set);
  }, []);
  return reduced;
}
