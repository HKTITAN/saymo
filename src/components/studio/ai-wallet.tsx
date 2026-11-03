"use client";

import { Popover } from "@base-ui/react/popover";
import { type CSSProperties, type ReactNode, useEffect, useId, useState } from "react";
import { CheckTickCircleIcon, CreditCardIcon } from "@/components/icons";
import { SURFACE } from "@/components/tool/dial";
import { type AiChoice, OFFERED_PROVIDERS, type ProviderId } from "@/lib/studio/ai-types";
import { cn } from "@/lib/utils";
import { aiApi } from "./ai-api";
import { ClaudeMark, CodexMark } from "./ai-marks";
import { Foil } from "./foil";
import { ITEM, MENU_POPUP } from "./home-parts";
import { PILL_BUTTON } from "./panel";

// "Bring your own AI", as an open leather card wallet: the chosen AI's
// metal card sits in it, its top showing above the front pocket, and the
// AI's mark is pressed into the pocket. Below, a line saying which AI and
// how it's paid, and "Change AI". Changing slides the card down into the
// pocket and the new one up. Whether it's ready shows under it (SelectedAi).

const W = 340; // the wallet
const H = 236;
const R = 34; // its corners
const CARD_W = 296;
const CARD_H = Math.round(CARD_W / 1.586);
const CARD_TOP = 18;
const POCKET_TOP = 86; // the pocket's edge at the sides
const POCKET_DIP = 112; // and in the middle

type Look = { name: string; via: string; mark: (c: string) => ReactNode; metal: FoilColors };
// A foil: its deep corner, its middle, its light corner.
type FoilColors = [string, string, string];
const CARDS: Record<ProviderId, Look> = {
  claude: { name: "Claude", via: "Claude plan", mark: (c) => <ClaudeMark className={c} />, metal: ["#c2410f", "#ec6a2c", "#ffb27a"] },
  codex: { name: "Codex", via: "ChatGPT plan", mark: (c) => <CodexMark className={c} />, metal: ["#2f37d8", "#6670f0", "#c3b8f5"] },
  "api-key": { name: "Claude", via: "API key", mark: (c) => <ClaudeMark className={c} />, metal: ["#7a2e12", "#b8532a", "#e79a6e"] },
};

export function AiWallet({ choice, onPick }: { choice: AiChoice; onPick: (provider: ProviderId) => void }) {
  // The card in the wallet; on a change it goes down into the pocket, then
  // the new one comes up.
  const [shown, setShown] = useState<ProviderId>(choice.provider);
  const [down, setDown] = useState(false);
  useEffect(() => {
    if (choice.provider === shown) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- follows the saved choice
      setShown(choice.provider);
      return;
    }
    setDown(true);
    const swap = setTimeout(() => {
      setShown(choice.provider);
      setDown(false);
    }, 320);
    return () => clearTimeout(swap);
  }, [choice.provider, shown]);

  // The light on the metal follows the pointer over the wallet.
  const [light, setLight] = useState<{ x: number; y: number } | null>(null);
  const [open, setOpen] = useState(false);
  // Each AI's plan by name when the studio knows it ("Team plan").
  const [plans, setPlans] = useState<Partial<Record<ProviderId, string>>>({});
  useEffect(() => {
    let live = true;
    void aiApi
      .status()
      .then((s) => {
        if (!live) return;
        const named: Partial<Record<ProviderId, string>> = {};
        for (const p of s.providers) if (p.plan) named[p.id] = p.plan;
        setPlans(named);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [choice.provider]);
  const look = CARDS[shown];
  const current = CARDS[choice.provider];

  return (
    <div className="mx-auto flex flex-col gap-4" style={{ width: W }}>
      <div
        role="img"
        aria-label={`${current.name} card, ${current.via}`}
        className="relative"
        style={{ width: W, height: H }}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setLight({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: 1 - ((e.clientY - r.top) / r.height) * 2 });
        }}
        onPointerLeave={() => setLight(null)}
      >
        <Back />
        {/* the card, inside the wallet */}
        <div className="absolute overflow-hidden" style={{ left: 0, top: 0, width: W, height: H, borderRadius: R }}>
          <div
            className="absolute rounded-[20px] transition-[top] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
            style={{ width: CARD_W, height: CARD_H, left: (W - CARD_W) / 2, top: down ? H : CARD_TOP }}
          >
            <span className="absolute inset-0 overflow-hidden rounded-[20px]" style={metal(look.metal)}>
              <Foil colors={look.metal} light={light} drift />
            </span>
            {/* the card's bezel: a hairline inset from its edge, and its pale rim */}
            <span className="pointer-events-none absolute inset-[7px] rounded-[14px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18),0_0_0_1px_rgba(0,0,0,0.12)]" />
            <span className="pointer-events-none absolute inset-0 rounded-[20px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.3),inset_0_1px_0_rgba(255,255,255,0.45)]" />
            <span className="absolute inset-x-[20px] top-[18px] flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-white/95" style={ETCHED}>
                {look.mark("size-4")}
                <span className="font-bold text-[13px] uppercase tracking-[0.2em]">{look.name}</span>
              </span>
              <span
                className="truncate font-semibold text-[9.5px] text-white uppercase tracking-[0.18em]"
                style={{ filter: `${ETCHED.filter} drop-shadow(0 0 3px rgba(0,0,0,0.35))` }}
              >
                {plans[shown] ?? look.via}
              </span>
            </span>
          </div>
        </div>
        <Pocket mark={look.mark} />
      </div>

      <div className="flex items-center justify-between border-white/[0.06] border-t pt-3">
        <span className="font-medium text-[13px] text-white/55">
          {current.name} · {current.via}
        </span>
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger className={cn(PILL_BUTTON, "h-8 bg-white/[0.06] text-white/80 hover:bg-white/[0.1] hover:text-white data-popup-open:bg-white/[0.1]")}>
            <CreditCardIcon aria-hidden="true" />
            Change AI
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={12} className="z-50">
              <Popover.Popup className={cn(SURFACE, MENU_POPUP, "min-w-[220px]")}>
                {OFFERED_PROVIDERS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={ITEM}
                    onClick={() => {
                      setOpen(false);
                      if (id !== choice.provider) onPick(id);
                    }}
                  >
                    {CARDS[id].mark("")}
                    <span className="flex flex-col leading-tight">
                      {CARDS[id].name}
                      <span className="text-[11.5px] text-white/45">{CARDS[id].via}</span>
                    </span>
                    {id === choice.provider ? <CheckTickCircleIcon aria-label="Chosen" className="ms-auto text-white/70" /> : null}
                  </button>
                ))}
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </div>
  );
}

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
function metal([deep, mid, light]: FoilColors): CSSProperties {
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

// Leather, warm brown, a little lighter at the top.
function Leather({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`${id}-back`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#7b4330" />
        <stop offset="1" stopColor="#5f321f" />
      </linearGradient>
      <linearGradient id={`${id}-recess`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#3f2016" />
        <stop offset="1" stopColor="#4c281b" />
      </linearGradient>
      <linearGradient id={`${id}-pocket`} x1="0" y1="0" x2="0.2" y2="1">
        <stop offset="0" stopColor="#8b4d33" />
        <stop offset="0.35" stopColor="#7a4129" />
        <stop offset="1" stopColor="#5e301e" />
      </linearGradient>
      <linearGradient id={`${id}-lip`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#000" stopOpacity="0" />
        <stop offset="1" stopColor="#000" stopOpacity="0.35" />
      </linearGradient>
      <filter id={`${id}-grain`} x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="5" result="n" />
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.14 0" />
        <feComposite in2="SourceGraphic" operator="in" />
      </filter>
      <filter id={`${id}-cast`} x="-10%" y="-30%" width="120%" height="160%">
        <feDropShadow dx="0" dy="-3" stdDeviation="4" floodColor="#000" floodOpacity="0.45" />
      </filter>
      <filter id={`${id}-soft`} x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="6" />
      </filter>
      <filter id={`${id}-drop`} x="-10%" y="-10%" width="120%" height="140%">
        <feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="#000" floodOpacity="0.55" />
      </filter>
    </defs>
  );
}

// The wallet's back: a lighter leather rim round a darker recess the card
// sits in.
function Back() {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 overflow-visible" aria-hidden="true">
      <Leather id={id} />
      <rect width={W} height={H} rx={R} fill={`url(#${id}-back)`} filter={`url(#${id}-drop)`} />
      <rect width={W} height={H} rx={R} fill="#000" filter={`url(#${id}-grain)`} />
      <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={R - 0.5} fill="none" stroke="rgba(255,210,180,0.22)" />
      <rect x={10} y={10} width={W - 20} height={H - 20} rx={R - 10} fill={`url(#${id}-recess)`} />
      <rect x={10} y={10} width={W - 20} height={H - 20} rx={R - 10} fill="none" stroke="rgba(0,0,0,0.4)" strokeWidth="2" />
    </svg>
  );
}

// The front pocket: its top edge dips gently in the middle, a lit lip, a
// soft shade under it, tonal stitching, and the AI's mark pressed in.
function Pocket({ mark }: { mark: (c: string) => ReactNode }) {
  const id = useId().replace(/:/g, "");
  const a = W * 0.22, b = W * 0.36, c = W * 0.38;
  const t = POCKET_TOP, d = POCKET_DIP;
  const edge = `M0 ${t + 18} Q0 ${t} 18 ${t} L${a} ${t} C${b} ${t} ${c} ${d} ${W / 2} ${d} C${W - c} ${d} ${W - b} ${t} ${W - a} ${t} L${W - 18} ${t} Q${W} ${t} ${W} ${t + 18} L${W} ${H - R} Q${W} ${H} ${W - R} ${H} L${R} ${H} Q0 ${H} 0 ${H - R} Z`;
  const i = 9;
  const stitch = `M${i} ${H - R} L${i} ${t + i + 12} Q${i} ${t + i} ${i + 12} ${t + i} L${a - 2} ${t + i} C${b - 3} ${t + i} ${c - 3} ${d + i} ${W / 2} ${d + i} C${W - c + 3} ${d + i} ${W - b + 3} ${t + i} ${W - a + 2} ${t + i} L${W - i - 12} ${t + i} Q${W - i} ${t + i} ${W - i} ${t + i + 12} L${W - i} ${H - R}`;
  return (
    <div className="pointer-events-none absolute inset-0">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 overflow-visible" aria-hidden="true">
        <Leather id={id} />
        <clipPath id={`${id}-clip`}>
          <path d={edge} />
        </clipPath>
        <path d={edge} fill={`url(#${id}-pocket)`} filter={`url(#${id}-cast)`} />
        <g clipPath={`url(#${id}-clip)`}>
          <path d={edge} fill="#000" filter={`url(#${id}-grain)`} />
          {/* the lip: lit along the edge, shaded just under it */}
          <path d={edge} fill="none" stroke="rgba(255,214,186,0.36)" strokeWidth="2.2" />
          <path d={edge} fill="none" stroke="rgba(255,220,196,0.1)" strokeWidth="14" transform="translate(0 5)" filter={`url(#${id}-soft)`} />
          <path d={edge} fill="none" stroke="rgba(0,0,0,0.22)" strokeWidth="14" transform="translate(0 16)" filter={`url(#${id}-soft)`} />
          <rect x={0} y={H - 30} width={W} height={30} fill={`url(#${id}-lip)`} />
        </g>
        <Stitches path={stitch} thread="#9b6447" shine={0.22} />
      </svg>
      <span
        className="absolute left-1/2 -translate-x-1/2 text-[#4a2618]"
        style={{ top: (d + H) / 2 - 10, filter: "drop-shadow(0 1px 0 rgba(255,205,175,0.2)) drop-shadow(0 -1px 0 rgba(0,0,0,0.45))" }}
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
function Stitches({ path, thread = "#b98d66", shine = 0.45 }: { path: string; thread?: string; shine?: number }) {
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
          <rect x={-half} y={-0.85} width={STITCH_LEN} height={1.5} rx={0.75} fill={thread} />
          <rect x={-half + 0.7} y={-0.7} width={STITCH_LEN - 1.4} height={0.45} rx={0.22} fill={`rgba(255,236,214,${shine})`} />
        </g>
      ))}
    </g>
  );
}
