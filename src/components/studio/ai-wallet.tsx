"use client";

import { type CSSProperties, type PointerEvent, type ReactNode, useEffect, useState } from "react";
import { type AiChoice, type AiStatus, OFFERED_PROVIDERS, type ProviderId, type ProviderStatus } from "@/lib/studio/ai-types";
import { cn } from "@/lib/utils";
import { aiApi } from "./ai-api";
import { stateWords } from "./ai-connections";
import { ClaudeMark, CodexMark } from "./ai-marks";

// "Bring your own AI", as a wallet of metal cards in the spirit of an Amex:
// dark brushed metal, the maker's logo in white at the top left, an
// engraved chip, and one small line saying how it's paid. Nothing else.
// The chosen card is in front; the others peek out behind with just their
// logo. Click one to bring it forward (that's the choice for every
// prompt). Whether it's ready shows under the wallet (SelectedAi). The
// front card tilts a little and catches the light under the pointer,
// unless Reduce Motion is on.

const CARD_W = 300;
const CARD_H = Math.round(CARD_W / 1.586); // a bank card's shape
const PEEK = 26; // how much of each card behind shows above the one in front

type Look = { name: string; via: string; mark: (c: string) => ReactNode; metal: [string, string, string] };

const CARDS: Record<ProviderId, Look> = {
  // Black, like a black card.
  claude: { name: "Claude", via: "Claude plan", mark: (c) => <ClaudeMark className={c} />, metal: ["#121214", "#26262a", "#17171a"] },
  // Graphite.
  codex: { name: "Codex", via: "ChatGPT plan", mark: (c) => <CodexMark className={c} />, metal: ["#25272b", "#41444a", "#2b2d32"] },
  // Titanium, the lightest that still carries a white logo.
  "api-key": { name: "Claude", via: "API key", mark: (c) => <ClaudeMark className={c} />, metal: ["#45484e", "#6c7077", "#4d5056"] },
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
            status={status?.providers.find((p) => p.id === id) ?? null}
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
  status,
  onPick,
}: {
  id: ProviderId;
  rank: number;
  behind: number;
  status: ProviderStatus | null;
  onPick: () => void;
}) {
  const [light, setLight] = useState<{ x: number; y: number } | null>(null);
  const still = useReducedMotion();
  const front = rank === 0;
  const look = CARDS[id];

  // Cards behind sit higher and a touch smaller, so their top edges show.
  const lift = (behind - rank) * PEEK;
  const shrink = 1 - rank * 0.045;
  const tilt = front && light && !still ? { x: (0.5 - light.y) * 6, y: (light.x - 0.5) * 8 } : { x: 0, y: 0 };

  const move = (e: PointerEvent<HTMLButtonElement>) => {
    if (!front) return;
    const r = e.currentTarget.getBoundingClientRect();
    setLight({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
  };

  const logo = (size: "small" | "large") => (
    <span className={cn("flex items-center text-white", size === "large" ? "gap-2" : "gap-1.5")}>
      {look.mark(size === "large" ? "size-[18px]" : "size-3")}
      <span className={cn("font-semibold tracking-[-0.01em]", size === "large" ? "text-[15px]" : "text-[11.5px]")}>{look.name}</span>
    </span>
  );

  return (
    <button
      type="button"
      role="radio"
      aria-checked={front}
      aria-label={`${look.name}, ${look.via}${status ? `, ${stateWords(status)}` : ""}`}
      onClick={front ? undefined : onPick}
      onPointerMove={move}
      onPointerLeave={() => setLight(null)}
      className={cn(
        "absolute left-0 rounded-[14px] text-left outline-none [transform-style:preserve-3d] focus-visible:ring-2 focus-visible:ring-white/60",
        "transition-[transform,top,filter] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
        front ? "cursor-default" : "cursor-pointer hover:brightness-125",
      )}
      style={{
        width: CARD_W,
        height: CARD_H,
        top: lift,
        zIndex: 10 - rank,
        transform: `perspective(900px) scale(${shrink}) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
        transformOrigin: "50% 0%",
        filter: front ? undefined : `brightness(${0.8 - rank * 0.1})`,
      }}
    >
      <span className="absolute inset-0 overflow-hidden rounded-[14px]" style={metal(look.metal, light, front && !still)} />
      {/* Behind: only the strip that shows, with the logo. */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-x-0 top-0 flex items-center justify-between px-[18px] transition-opacity duration-300 motion-reduce:transition-none",
          front ? "opacity-0" : "opacity-100",
        )}
        style={{ height: PEEK }}
      >
        {logo("small")}
        <span className="text-[9.5px] text-white/50 uppercase tracking-[0.16em]">{look.via}</span>
      </span>
      {/* In front: the logo, the chip, and how it's paid. */}
      <span
        aria-hidden="true"
        className={cn(
          "relative flex h-full flex-col justify-between p-[18px] transition-opacity duration-300 motion-reduce:transition-none",
          front ? "opacity-100" : "opacity-0",
        )}
      >
        {logo("large")}
        <Chip />
        <span className="text-[9.5px] text-white/50 uppercase tracking-[0.18em]">{look.via}</span>
      </span>
    </button>
  );
}

// Dark brushed metal: a fine horizontal grain, one long diagonal sheen,
// a hairline bevel, and a soft light under the pointer on the front card.
function metal([edge, sheen, base]: [string, string, string], light: { x: number; y: number } | null, lit: boolean): CSSProperties {
  const x = `${Math.round((light?.x ?? 0.25) * 100)}%`;
  const y = `${Math.round((light?.y ?? 0.1) * 100)}%`;
  return {
    background: [
      `radial-gradient(80% 110% at ${x} ${y}, rgba(255,255,255,${lit && light ? 0.1 : 0.05}), rgba(255,255,255,0) 70%)`,
      "repeating-linear-gradient(0deg, rgba(255,255,255,0.018) 0 1px, rgba(0,0,0,0.03) 1px 2px)",
      `linear-gradient(115deg, ${edge} 0%, ${base} 30%, ${sheen} 52%, ${base} 70%, ${edge} 100%)`,
    ].join(","),
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.14), inset 0 0 0 1px rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.4), 0 24px 40px -18px rgba(0,0,0,0.9), 0 2px 6px rgba(0,0,0,0.4)",
  };
}

// The chip, cut into the metal as a fine outline.
function Chip() {
  return (
    <span
      aria-hidden="true"
      className="relative block h-[24px] w-[32px] overflow-hidden rounded-[5px] bg-white/[0.04]"
      style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.28)" }}
    >
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/20" />
      <span className="absolute inset-y-0 left-1/3 w-px bg-white/20" />
      <span className="absolute inset-y-0 left-2/3 w-px bg-white/20" />
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
