"use client";

import { type CSSProperties, type PointerEvent, useEffect, useState } from "react";
import { type AiChoice, type AiStatus, OFFERED_PROVIDERS, type ProviderId, type ProviderStatus } from "@/lib/studio/ai-types";
import { cn } from "@/lib/utils";
import { aiApi } from "./ai-api";
import { stateWords } from "./ai-connections";

// "Bring your own AI", as a wallet: each AI the studio can use is a brushed
// metal card, the chosen one in front and the others peeking out behind.
// Click a card to bring it forward (that's the choice for every prompt).
// The face is kept bare, like a real metal card: a chip, a small line for
// how it's paid, and the AI's name where a card's brand sits. Whether it's
// ready shows under the wallet (SelectedAi). The front card tilts a little
// and catches the light under the pointer, unless Reduce Motion is on.

const CARD_W = 296;
const CARD_H = Math.round(CARD_W / 1.586); // a bank card's shape
const PEEK = 24; // how much of each card behind shows above the one in front

const NAMES: Record<ProviderId, { name: string; via: string }> = {
  claude: { name: "Claude", via: "Claude plan" },
  codex: { name: "Codex", via: "ChatGPT plan" },
  "api-key": { name: "Claude", via: "API key" },
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

  // Cards behind sit higher and a touch smaller, so their top edges show.
  const lift = (behind - rank) * PEEK;
  const shrink = 1 - rank * 0.045;
  const tilt = front && light && !still ? { x: (0.5 - light.y) * 6, y: (light.x - 0.5) * 8 } : { x: 0, y: 0 };

  const move = (e: PointerEvent<HTMLButtonElement>) => {
    if (!front) return;
    const r = e.currentTarget.getBoundingClientRect();
    setLight({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
  };

  return (
    <button
      type="button"
      role="radio"
      aria-checked={front}
      aria-label={`${NAMES[id].name}, ${NAMES[id].via}${status ? `, ${stateWords(status)}` : ""}`}
      onClick={front ? undefined : onPick}
      onPointerMove={move}
      onPointerLeave={() => setLight(null)}
      className={cn(
        "absolute left-0 rounded-[14px] text-left outline-none [transform-style:preserve-3d] focus-visible:ring-2 focus-visible:ring-white/60",
        "transition-[transform,top,filter] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
        front ? "cursor-default" : "cursor-pointer hover:brightness-110",
      )}
      style={{
        width: CARD_W,
        height: CARD_H,
        top: lift,
        zIndex: 10 - rank,
        transform: `perspective(900px) scale(${shrink}) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
        transformOrigin: "50% 0%",
        filter: front ? undefined : `brightness(${0.72 - rank * 0.1})`,
      }}
    >
      <span className="absolute inset-0 overflow-hidden rounded-[14px]" style={metal(light, front && !still)} />
      {/* Behind: only the strip that shows. */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-x-0 top-0 flex items-center justify-between px-4 transition-opacity duration-300 motion-reduce:transition-none",
          front ? "opacity-0" : "opacity-100",
        )}
        style={{ ...ENGRAVE, height: PEEK }}
      >
        <span className="text-[10px] text-white/75 uppercase tracking-[0.14em]">{NAMES[id].via}</span>
        <span className="font-semibold text-[12px] text-white/90 tracking-[-0.01em]">{NAMES[id].name}</span>
      </span>
      {/* In front: how it's paid, the chip, and the AI's name. */}
      <span
        aria-hidden="true"
        className={cn(
          "relative flex h-full flex-col justify-between p-[18px] transition-opacity duration-300 motion-reduce:transition-none",
          front ? "opacity-100" : "opacity-0",
        )}
        style={ENGRAVE}
      >
        <span className="text-[10px] text-white/55 uppercase tracking-[0.14em]">{NAMES[id].via}</span>
        <span className="flex items-end justify-between">
          <Chip />
          <span className="font-bold text-[22px] text-white/90 italic leading-none tracking-[-0.03em]">{NAMES[id].name}</span>
        </span>
      </span>
    </button>
  );
}

// Brushed metal: vertical streaks of uneven width over a cool grey ramp,
// darker at the edges, with a soft highlight under the pointer on the
// front card.
function metal(light: { x: number; y: number } | null, lit: boolean): CSSProperties {
  const x = `${Math.round((light?.x ?? 0.3) * 100)}%`;
  const y = `${Math.round((light?.y ?? 0.2) * 100)}%`;
  return {
    background: [
      `radial-gradient(70% 90% at ${x} ${y}, rgba(255,255,255,${lit && light ? 0.22 : 0.1}), rgba(255,255,255,0) 70%)`,
      "repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 1px, rgba(0,0,0,0.05) 1px 2px, rgba(255,255,255,0.02) 2px 4px, rgba(0,0,0,0.04) 4px 5px)",
      "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.18) 9%, rgba(255,255,255,0) 14%, rgba(255,255,255,0.08) 31%, rgba(255,255,255,0) 38%, rgba(255,255,255,0.22) 55%, rgba(255,255,255,0.04) 63%, rgba(255,255,255,0.12) 78%, rgba(255,255,255,0) 86%)",
      "linear-gradient(90deg, #4a4d52 0%, #7d8086 18%, #6a6d72 36%, #8e9196 56%, #63666b 76%, #45484c 100%)",
    ].join(","),
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.35), inset 0 0 0 1px rgba(255,255,255,0.06), 0 24px 40px -18px rgba(0,0,0,0.9), 0 2px 6px rgba(0,0,0,0.4)",
  };
}

// Letters cut into the metal: shade above, light below.
const ENGRAVE: CSSProperties = { textShadow: "0 -1px 0 rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.12)" };

// The chip, drawn as an outline cut into the metal, like the card itself.
function Chip() {
  return (
    <span
      aria-hidden="true"
      className="relative block h-[26px] w-[34px] overflow-hidden rounded-[6px] bg-white/[0.06]"
      style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.42), 0 1px 0 rgba(0,0,0,0.25)" }}
    >
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/35" />
      <span className="absolute inset-y-0 left-1/3 w-px bg-white/35" />
      <span className="absolute inset-y-0 left-2/3 w-px bg-white/35" />
      <span className="absolute top-1/2 left-1/2 h-[10px] w-[12px] -translate-x-1/2 -translate-y-1/2 rounded-[3px] bg-[#6a6d72] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.42)]" />
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
