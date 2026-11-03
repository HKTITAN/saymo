"use client";

import { type CSSProperties, type ReactNode, useEffect, useId, useState } from "react";
import { type AiChoice, type AiStatus, OFFERED_PROVIDERS, type ProviderId, type ProviderStatus } from "@/lib/studio/ai-types";
import { cn } from "@/lib/utils";
import { aiApi } from "./ai-api";
import { stateWords } from "./ai-connections";
import { ClaudeMark, CodexMark } from "./ai-marks";
import { Foil } from "./foil";

// "Bring your own AI", as a leather card sleeve: each AI the studio can use
// is a black metal card tucked in it, fanned a little, the chosen one
// pulled up higher with its logo and name showing. Click a card to pull it
// up (that's the choice for every prompt). The chosen AI's mark is pressed
// into the leather. Whether it's ready shows under the sleeve (SelectedAi).

const W = 280; // the sleeve
const SLEEVE_H = 132;
const AREA_H = 212; // sleeve plus the cards above it
const CARD_W = 242;
const CARD_H = Math.round(CARD_W / 1.586);
const DOWN = 38; // a card's top while tucked in
const UP = 5; // the chosen card's top

type Look = { name: string; via: string; mark: (c: string) => ReactNode; metal: Foil };
// A foil: its deep corner, its middle, its light corner.
type Foil = [string, string, string];
const CARDS: Record<ProviderId, Look> = {
  claude: { name: "Claude", via: "Claude plan", mark: (c) => <ClaudeMark className={c} />, metal: ["#c2410f", "#ec6a2c", "#ffb27a"] },
  codex: { name: "Codex", via: "ChatGPT plan", mark: (c) => <CodexMark className={c} />, metal: ["#2f37d8", "#6670f0", "#c3b8f5"] },
  "api-key": { name: "Claude", via: "API key", mark: (c) => <ClaudeMark className={c} />, metal: ["#7a2e12", "#b8532a", "#e79a6e"] },
};
// The two cards not chosen fan out behind it, one to each side.
const FAN = [
  { x: -28, r: -7 },
  { x: 28, r: 7 },
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

  // The light on the metal follows the pointer over the sleeve.
  const [light, setLight] = useState<{ x: number; y: number } | null>(null);
  const chosen = CARDS[choice.provider];
  return (
    <div
      role="radiogroup"
      aria-label="Prompts go to"
      className="relative mx-auto"
      style={{ width: W, height: AREA_H }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setLight({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: 1 - ((e.clientY - r.top) / r.height) * 2 });
      }}
      onPointerLeave={() => setLight(null)}
    >
      {OFFERED_PROVIDERS.map((id) => (
        <Card
          key={id}
          id={id}
          up={id === choice.provider}
          light={light}
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
  light,
  fan,
  status,
  onPick,
}: {
  id: ProviderId;
  up: boolean;
  light: { x: number; y: number } | null;
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
      <span className="absolute inset-0 overflow-hidden rounded-[14px]" style={metal(look.metal)}>
        <Foil colors={look.metal} light={light} drift={up} />
      </span>
      {/* the pale edge and lit top lip, over the metal */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[14px]"
        style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.3), inset 0 1px 0 rgba(255,255,255,0.45)" }}
      />
      <span className="relative flex items-start justify-between px-[18px] pt-[16px]">
        <span className="flex items-center gap-2 text-white/95" style={ETCHED}>
          {look.mark("size-[18px]")}
          <span className="font-semibold text-[15px] tracking-[-0.01em]">{look.name}</span>
        </span>
        <span className="pt-0.5 text-[9.5px] text-white/85 uppercase tracking-[0.18em]" style={ETCHED}>{look.via}</span>
      </span>
    </button>
  );
}

// Black metal: a soft sheen across, a fine grain, a hairline bevel.
// Etched into the foil: the cut is shaded along its top edge and catches
// the light along its bottom edge (filter, so the logo's shape gets it too).
// The text keeps one steady colour whatever the light does on the metal.
const ETCHED: CSSProperties = {
  filter: "drop-shadow(0 -1px 0 rgba(0,0,0,0.4)) drop-shadow(0 1px 0 rgba(255,255,255,0.35)) drop-shadow(0 0 6px rgba(0,0,0,0.18))",
};

// Coloured foil: deep in one corner, light in the other, a soft band of
// light across, a fine embossed texture and a pale hairline edge. The
// texture is SVG noise, lit, laid over the colour.
const FOIL_TEXTURE = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='f'><feTurbulence type='fractalNoise' baseFrequency='1.1' numOctaves='2' seed='3'/><feDiffuseLighting lighting-color='#fff' surfaceScale='1.4'><feDistantLight azimuth='225' elevation='60'/></feDiffuseLighting></filter><rect width='100%' height='100%' filter='url(#f)' opacity='0.16'/></svg>",
)}")`;
function metal([deep, mid, light]: Foil): CSSProperties {
  return {
    background: [
      FOIL_TEXTURE,
      "linear-gradient(100deg, rgba(255,255,255,0) 18%, rgba(255,255,255,0.22) 30%, rgba(255,255,255,0) 44%)",
      `radial-gradient(120% 140% at 100% 0%, ${light} 0%, rgba(255,255,255,0) 60%)`,
      `linear-gradient(200deg, ${mid} 0%, ${mid} 40%, ${deep} 100%)`,
    ].join(","),
    backgroundBlendMode: "overlay, normal, normal, normal",
    boxShadow:
      "inset 0 0 0 1px rgba(255,255,255,0.28), inset 0 1px 0 rgba(255,255,255,0.35), 0 -2px 10px rgba(0,0,0,0.35)",
  };
}

// The sleeve: brown leather with a curved dip in its top edge, a stitched
// line inside its edge, fine grain, a lit top lip, and the chosen AI's
// mark pressed into it.
function Sleeve({ mark }: { mark: (c: string) => ReactNode }) {
  const id = useId().replace(/:/g, "");
  const h = SLEEVE_H;
  const a = W * 0.295, b = W * 0.375, c = W * 0.395;
  const edge = `M0 24 Q0 0 24 0 L${a} 0 C${b} 0 ${c} 22 ${W / 2} 22 C${W - c} 22 ${W - b} 0 ${W - a} 0 L${W - 24} 0 Q${W} 0 ${W} 24 L${W} ${h - 24} Q${W} ${h} ${W - 24} ${h} L24 ${h} Q0 ${h} 0 ${h - 24} Z`;
  const stitch = `M11 29 Q11 11 29 11 L${a - 2} 11 C${b - 3} 11 ${c - 3} 32 ${W / 2} 32 C${W - c + 3} 32 ${W - b + 3} 11 ${W - a + 2} 11 L${W - 29} 11 Q${W - 11} 11 ${W - 11} 29 L${W - 11} ${h - 29} Q${W - 11} ${h - 11} ${W - 29} ${h - 11} L29 ${h - 11} Q11 ${h - 11} 11 ${h - 29} Z`;
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
        <Stitches path={stitch} />
      </svg>
      {/* the mark, pressed into the leather: dark inside, a light lip below */}
      <span
        className="absolute left-1/2 -translate-x-1/2 text-[#3a1d12]"
        style={{ top: h / 2 + 2, filter: "drop-shadow(0 1px 0 rgba(255,205,175,0.2)) drop-shadow(0 -1px 0 rgba(0,0,0,0.45))" }}
      >
        {mark("size-8")}
      </span>
    </div>
  );
}

// Saddle stitching along a path, stitch by stitch: each one a short,
// slanted, rounded length of waxed tan thread with a shine along it, its
// shadow, and the two holes it goes in and out of. Worked out from the
// path once the page is in the browser.
type Stitch = { x: number; y: number; a: number };
const STITCH_GAP = 6.5;
const STITCH_LEN = 4;
function Stitches({ path }: { path: string }) {
  const [stitches, setStitches] = useState<Stitch[]>([]);
  useEffect(() => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
    el.setAttribute("d", path);
    const total = el.getTotalLength();
    const n = Math.floor(total / STITCH_GAP);
    const out: Stitch[] = [];
    for (let i = 0; i < n; i++) {
      const at = (i + 0.5) * (total / n);
      const p = el.getPointAtLength(at);
      const q = el.getPointAtLength(Math.min(total, at + 0.5));
      out.push({ x: p.x, y: p.y, a: (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI });
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- measured from the path in the browser
    setStitches(out);
  }, [path]);
  const half = STITCH_LEN / 2;
  return (
    <g>
      {stitches.map((s, i) => (
        <g key={i} transform={`translate(${s.x} ${s.y}) rotate(${s.a + 22})`}>
          <circle cx={-half - 0.6} cy={0.3} r={0.7} fill="rgba(20,8,3,0.6)" />
          <circle cx={half + 0.6} cy={0.3} r={0.7} fill="rgba(20,8,3,0.7)" />
          <rect x={-half} y={-0.25} width={STITCH_LEN} height={1.5} rx={0.75} fill="rgba(20,8,3,0.5)" />
          <rect x={-half} y={-0.85} width={STITCH_LEN} height={1.5} rx={0.75} fill="#b98d66" />
          <rect x={-half + 0.7} y={-0.7} width={STITCH_LEN - 1.4} height={0.45} rx={0.22} fill="rgba(255,236,214,0.45)" />
        </g>
      ))}
    </g>
  );
}
