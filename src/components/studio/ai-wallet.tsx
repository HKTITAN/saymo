"use client";

import { type CSSProperties, type ReactNode, useEffect, useId, useState } from "react";
import { type AiChoice, type AiStatus, OFFERED_PROVIDERS, type ProviderId, type ProviderStatus } from "@/lib/studio/ai-types";
import { cn } from "@/lib/utils";
import { aiApi } from "./ai-api";
import { stateWords } from "./ai-connections";
import { ClaudeMark, CodexMark } from "./ai-marks";

// "Bring your own AI", as a leather card sleeve: each AI the studio can use
// is a black metal card tucked in it, fanned a little, the chosen one
// pulled up higher with its logo and name showing. Click a card to pull it
// up (that's the choice for every prompt). The chosen AI's mark is pressed
// into the leather. Whether it's ready shows under the sleeve (SelectedAi).

const W = 400; // the sleeve
const SLEEVE_H = 188;
const AREA_H = 300; // sleeve plus the cards above it
const CARD_W = 344;
const CARD_H = Math.round(CARD_W / 1.586);
const DOWN = 52; // a card's top while tucked in
const UP = 8; // the chosen card's top

type Look = { name: string; via: string; mark: (c: string) => ReactNode; metal: [string, string] };
const CARDS: Record<ProviderId, Look> = {
  claude: { name: "Claude", via: "Claude plan", mark: (c) => <ClaudeMark className={c} />, metal: ["#121214", "#2a2a2e"] },
  codex: { name: "Codex", via: "ChatGPT plan", mark: (c) => <CodexMark className={c} />, metal: ["#1d1f23", "#3b3e44"] },
  "api-key": { name: "Claude", via: "API key", mark: (c) => <ClaudeMark className={c} />, metal: ["#34363b", "#5b5f66"] },
};
// The two cards not chosen fan out behind it, one to each side.
const FAN = [
  { x: -40, r: -7 },
  { x: 40, r: 7 },
];

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

  const chosen = CARDS[choice.provider];
  return (
    <div role="radiogroup" aria-label="Prompts go to" className="relative mx-auto" style={{ width: W, height: AREA_H }}>
      {OFFERED_PROVIDERS.map((id) => (
        <Card
          key={id}
          id={id}
          up={id === choice.provider}
          fan={FAN[OFFERED_PROVIDERS.filter((p) => p !== choice.provider).indexOf(id)] ?? FAN[0]}
          status={status?.providers.find((p) => p.id === id) ?? null}
          onPick={() => onPick(id)}
        />
      ))}
      <Sleeve mark={chosen.mark} />
    </div>
  );
}

function Card({
  id,
  up,
  fan,
  status,
  onPick,
}: {
  id: ProviderId;
  up: boolean;
  fan: { x: number; r: number };
  status: ProviderStatus | null;
  onPick: () => void;
}) {
  const look = CARDS[id];
  return (
    <button
      type="button"
      role="radio"
      aria-checked={up}
      aria-label={`${look.name}, ${look.via}${status ? `, ${stateWords(status)}` : ""}`}
      onClick={up ? undefined : onPick}
      className={cn(
        "absolute flex flex-col justify-start rounded-[14px] text-left outline-none focus-visible:ring-2 focus-visible:ring-white/60",
        "transition-[top,transform,filter] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
        up ? "z-10 cursor-default" : "z-0 cursor-pointer brightness-75 hover:brightness-90",
      )}
      style={{
        width: CARD_W,
        height: CARD_H,
        left: (W - CARD_W) / 2,
        top: up ? UP : DOWN,
        transform: `translateX(${up ? 0 : fan.x}px) rotate(${up ? 0 : fan.r}deg)`,
        transformOrigin: "50% 130%",
      }}
    >
      <span className="absolute inset-0 rounded-[14px]" style={metal(look.metal)} />
      <span className="relative flex items-start justify-between px-[18px] pt-[16px]">
        <span className="flex items-center gap-2 text-white">
          {look.mark("size-[18px]")}
          <span className="font-semibold text-[15px] tracking-[-0.01em]">{look.name}</span>
        </span>
        <span className="pt-0.5 text-[9.5px] text-white/50 uppercase tracking-[0.18em]">{look.via}</span>
      </span>
    </button>
  );
}

// Black metal: a soft sheen across, a fine grain, a hairline bevel.
function metal([base, sheen]: [string, string]): CSSProperties {
  return {
    background: [
      "repeating-linear-gradient(0deg, rgba(255,255,255,0.018) 0 1px, rgba(0,0,0,0.03) 1px 2px)",
      `linear-gradient(120deg, ${base} 0%, ${base} 30%, ${sheen} 52%, ${base} 74%, ${base} 100%)`,
    ].join(","),
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.14), inset 0 0 0 1px rgba(255,255,255,0.06), 0 -2px 10px rgba(0,0,0,0.35)",
  };
}

// The sleeve: brown leather with a curved dip in its top edge, a stitched
// line inside its edge, fine grain, a lit top lip, and the chosen AI's
// mark pressed into it.
function Sleeve({ mark }: { mark: (c: string) => ReactNode }) {
  const id = useId().replace(/:/g, "");
  const h = SLEEVE_H;
  const edge = `M0 24 Q0 0 24 0 L118 0 C150 0 158 30 ${W / 2} 30 C${W - 158} 30 ${W - 150} 0 ${W - 118} 0 L${W - 24} 0 Q${W} 0 ${W} 24 L${W} ${h - 24} Q${W} ${h} ${W - 24} ${h} L24 ${h} Q0 ${h} 0 ${h - 24} Z`;
  const stitch = `M12 30 Q12 12 30 12 L116 12 C146 12 156 42 ${W / 2} 42 C${W - 156} 42 ${W - 146} 12 ${W - 116} 12 L${W - 30} 12 Q${W - 12} 12 ${W - 12} 30 L${W - 12} ${h - 30} Q${W - 12} ${h - 12} ${W - 30} ${h - 12} L30 ${h - 12} Q12 ${h - 12} 12 ${h - 30} Z`;
  return (
    <div className="pointer-events-none absolute bottom-0 left-0 z-20" style={{ width: W, height: h }}>
      <svg width={W} height={h} viewBox={`0 0 ${W} ${h}`} className="absolute inset-0 overflow-visible" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-leather`} x1="0" y1="0" x2="0.35" y2="1">
            <stop offset="0" stopColor="#6b3d2a" />
            <stop offset="0.45" stopColor="#58301f" />
            <stop offset="1" stopColor="#3f2116" />
          </linearGradient>
          <radialGradient id={`${id}-light`} cx="0.3" cy="0.15" r="0.9">
            <stop offset="0" stopColor="#ffd9c0" stopOpacity="0.12" />
            <stop offset="1" stopColor="#ffd9c0" stopOpacity="0" />
          </radialGradient>
          <filter id={`${id}-grain`} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n" />
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.22 0" />
            <feComposite in2="SourceGraphic" operator="in" />
          </filter>
          <filter id={`${id}-lift`} x="-10%" y="-30%" width="120%" height="160%">
            <feDropShadow dx="0" dy="-4" stdDeviation="6" floodColor="#000" floodOpacity="0.45" />
            <feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="#000" floodOpacity="0.55" />
          </filter>
        </defs>
        <g filter={`url(#${id}-lift)`}>
          <path d={edge} fill={`url(#${id}-leather)`} />
        </g>
        <path d={edge} fill={`url(#${id}-light)`} />
        <path d={edge} fill="#000" filter={`url(#${id}-grain)`} />
        {/* the lit lip along the top edge, and its shade just below */}
        <path d={edge} fill="none" stroke="rgba(255,214,190,0.22)" strokeWidth="1.2" />
        <path d={stitch} fill="none" stroke="rgba(255,214,190,0.26)" strokeWidth="1.2" strokeDasharray="5 4" strokeLinecap="round" />
      </svg>
      {/* the mark, pressed into the leather: dark inside, a light lip below */}
      <span
        className="absolute left-1/2 -translate-x-1/2 text-[#3a1d12]"
        style={{ top: h / 2 + 2, filter: "drop-shadow(0 1px 0 rgba(255,205,175,0.2)) drop-shadow(0 -1px 0 rgba(0,0,0,0.45))" }}
      >
        {mark("size-9")}
      </span>
    </div>
  );
}
