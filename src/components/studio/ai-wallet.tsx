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

const W = 320; // the sleeve
const SLEEVE_H = 150;
const AREA_H = 240; // sleeve plus the cards above it
const CARD_W = 276;
const CARD_H = Math.round(CARD_W / 1.586);
const DOWN = 42; // a card's top while tucked in
const UP = 6; // the chosen card's top

type Look = { name: string; via: string; mark: (c: string) => ReactNode; metal: [string, string] };
const CARDS: Record<ProviderId, Look> = {
  claude: { name: "Claude", via: "Claude plan", mark: (c) => <ClaudeMark className={c} />, metal: ["#121214", "#2a2a2e"] },
  codex: { name: "Codex", via: "ChatGPT plan", mark: (c) => <CodexMark className={c} />, metal: ["#1d1f23", "#3b3e44"] },
  "api-key": { name: "Claude", via: "API key", mark: (c) => <ClaudeMark className={c} />, metal: ["#34363b", "#5b5f66"] },
};
// The two cards not chosen fan out behind it, one to each side.
const FAN = [
  { x: -32, r: -7 },
  { x: 32, r: 7 },
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

// The sleeve: soft padded leather. A raised grain that catches the light,
// a puffed edge (lit along the top, shaded underneath), a dark painted
// edge, tan stitching with its holes, and the chosen AI's mark pressed
// deep into it with "Motion Studio" under it.
function Sleeve({ mark }: { mark: (c: string) => ReactNode }) {
  const id = useId().replace(/:/g, "");
  const h = SLEEVE_H;
  const r = 26;
  const shape = (i: number) => {
    const L = i, T = i, R = W - i, B = h - i, rr = Math.max(4, r - i);
    const dip = 25 + i * 0.4;
    const a = W * 0.295 + i * 0.2, b = W * 0.375 + i * 0.3, c = W * 0.395 + i * 0.3;
    return `M${L} ${T + rr} Q${L} ${T} ${L + rr} ${T} L${a} ${T} C${b} ${T} ${c} ${dip} ${W / 2} ${dip} C${W - c} ${dip} ${W - b} ${T} ${W - a} ${T} L${R - rr} ${T} Q${R} ${T} ${R} ${T + rr} L${R} ${B - rr} Q${R} ${B} ${R - rr} ${B} L${L + rr} ${B} Q${L} ${B} ${L} ${B - rr} Z`;
  };
  const edge = shape(0);
  const stitch = shape(10);
  return (
    <div className="pointer-events-none absolute bottom-0 left-0 z-20" style={{ width: W, height: h }}>
      <svg width={W} height={h} viewBox={`0 0 ${W} ${h}`} className="absolute inset-0 overflow-visible" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-leather`} x1="0" y1="0" x2="0.3" y2="1">
            <stop offset="0" stopColor="#8a5236" />
            <stop offset="0.5" stopColor="#6a3a25" />
            <stop offset="1" stopColor="#47251a" />
          </linearGradient>
          <clipPath id={`${id}-clip`}>
            <path d={edge} />
          </clipPath>
          {/* raised grain: noise turned into a lit surface, laid over the leather */}
          <filter id={`${id}-grain`} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="3" seed="4" result="noise" />
            <feDiffuseLighting in="noise" surfaceScale="1.6" lightingColor="#ffffff" result="lit">
              <feDistantLight azimuth="235" elevation="58" />
            </feDiffuseLighting>
            <feComposite in="lit" in2="SourceGraphic" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" />
          </filter>
          <filter id={`${id}-soft`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
          <filter id={`${id}-lift`} x="-15%" y="-40%" width="130%" height="180%">
            <feDropShadow dx="0" dy="-5" stdDeviation="7" floodColor="#000" floodOpacity="0.5" />
            <feDropShadow dx="0" dy="16" stdDeviation="16" floodColor="#000" floodOpacity="0.6" />
            <feDropShadow dx="0" dy="3" stdDeviation="2" floodColor="#000" floodOpacity="0.5" />
          </filter>
        </defs>
        <g filter={`url(#${id}-lift)`}>
          <path d={edge} fill={`url(#${id}-leather)`} />
        </g>
        <g clipPath={`url(#${id}-clip)`}>
          {/* the grain, multiplied into the leather */}
          <path d={edge} fill={`url(#${id}-leather)`} filter={`url(#${id}-grain)`} style={{ mixBlendMode: "multiply" }} opacity="0.55" />
          {/* puffed: a soft light along the top, a soft shade along the bottom and sides */}
          <path d={edge} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth="22" filter={`url(#${id}-soft)`} transform="translate(0 6)" />
          <path d={edge} fill="none" stroke="rgba(255,214,186,0.35)" strokeWidth="10" filter={`url(#${id}-soft)`} transform="translate(0 4)" />
          <ellipse cx={W * 0.32} cy={h * 0.28} rx={W * 0.42} ry={h * 0.42} fill="rgba(255,222,200,0.1)" filter={`url(#${id}-soft)`} />
        </g>
        {/* the painted edge, and its lit lip */}
        <path d={edge} fill="none" stroke="#2b140c" strokeWidth="2" />
        <path d={edge} fill="none" stroke="rgba(255,206,178,0.28)" strokeWidth="1" transform="translate(0 1)" clipPath={`url(#${id}-clip)`} />
        {/* stitching: the holes, then the tan thread */}
        <path d={stitch} fill="none" stroke="rgba(30,10,5,0.55)" strokeWidth="2.6" strokeDasharray="6 5" strokeLinecap="round" transform="translate(0 0.8)" />
        <path d={stitch} fill="none" stroke="#c99a78" strokeWidth="1.7" strokeDasharray="6 5" strokeLinecap="round" />
      </svg>
      {/* the mark and the words, pressed in: shade above, light below */}
      <span
        className="absolute left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 text-[#3d1d11]"
        style={{ top: h / 2 - 10, filter: "drop-shadow(0 1px 0 rgba(255,210,180,0.24)) drop-shadow(0 -1px 0 rgba(0,0,0,0.5))" }}
      >
        {mark("size-8")}
        <span className="font-semibold text-[9px] uppercase tracking-[0.32em]">Motion Studio</span>
      </span>
    </div>
  );
}
