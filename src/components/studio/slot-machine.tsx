"use client";

import { useEffect, useRef, useState } from "react";
import { TextMorph } from "torph/react";
import { Kbd } from "@/components/ui/kbd";
import { TAKE_WAYS } from "@/lib/studio/takes-shared";
import { cn } from "@/lib/utils";

// The moment "Try 3" is pressed: a slot machine, drawn in code, in the
// middle of the screen. Its lever is pulled down and springs back, and that
// pull sets the three reels spinning while a playful line morphs above.
// The reels settle left to right on 1, 2 and 3, one per version, each with a
// small clunk and its label lighting up. They only settle once the three
// versions have really started (`ready`); then the marquee lights flash,
// the machine fades and hands over to the canvas (`onDone`). With reduced
// motion nothing swings or spins: the reels stand on their numbers and the
// labels and lights only fade.

const LINES = [
  "Haha, we're gambling now.",
  "Feeling lucky?",
  "Spinning up three versions.",
  "Pulling the lever.",
  "No refunds. Only versions.",
  "Three ideas walk into a film.",
  "Shuffling the ideas.",
  "Double or nothing? Triple.",
];
const JACKPOT = "Jackpot. Three versions, coming right up.";

// ─── The drawing ────────────────────────────────────────────────────────────
// One coordinate system for the SVG and the reels laid over it, 1 unit = 1 px.

const W = 460;
const H = 530;
const CX = 210;
const BODY = { x0: 30, x1: 390, dome: 154, bottom: 484 };
const CABINET = `M${BODY.x0},${BODY.dome} A180,130 0 0 1 ${BODY.x1},${BODY.dome} V${BODY.bottom - 24} A24,24 0 0 1 ${BODY.x1 - 24},${BODY.bottom} H${BODY.x0 + 24} A24,24 0 0 1 ${BODY.x0},${BODY.bottom - 24} Z`;
// The marquee: an arch inside the dome, its lights round the curve.
const MARQUEE = { base: 160, rx: 152, ry: 108 };
const BULBS = Array.from({ length: 15 }, (_, i) => {
  const a = Math.PI - 0.13 - (i / 14) * (Math.PI - 0.26);
  return { x: CX + (MARQUEE.rx - 14) * Math.cos(a), y: MARQUEE.base - (MARQUEE.ry - 14) * Math.sin(a) };
});
// A soft highlight along the upper left of the dome.
const SHEEN = (() => {
  const p = (a: number) => `${(CX + 172 * Math.cos(a)).toFixed(1)},${(BODY.dome - 122 * Math.sin(a)).toFixed(1)}`;
  return `M${p(Math.PI * 0.86)} A172,122 0 0 1 ${p(Math.PI * 0.56)}`;
})();

// The reel window and the reels inside it.
const REEL_W = 92;
const REEL_GAP = 7;
const REEL_X = 65;
const REEL_Y = 202;
const reelLeft = (i: number) => REEL_X + i * (REEL_W + REEL_GAP);
const PLATE_Y = 368;

// The lever: a chrome arm on a pivot at the cabinet's right side. Pulled,
// it swings towards you, so seen from the front the ball drops straight
// down past the pivot and grows a little as it comes closer.
const PIVOT = { x: 420, y: 272 };
const ARM = 168;
const PULL_MAX = 150; // degrees
const lever = (deg: number) => {
  const a = (deg * Math.PI) / 180;
  const y = PIVOT.y - ARM * Math.cos(a);
  const s = 1 + 0.16 * Math.sin(a);
  return {
    arm: `M${PIVOT.x - 5.5},${PIVOT.y} L${PIVOT.x - 3.5},${y.toFixed(2)} L${PIVOT.x + 3.5},${y.toFixed(2)} L${PIVOT.x + 5.5},${PIVOT.y} Z`,
    knob: `translate(${PIVOT.x} ${y.toFixed(2)}) scale(${s.toFixed(4)})`,
  };
};
const REST = lever(0);

// ─── The motion ─────────────────────────────────────────────────────────────

// A reel: a strip of digits seen through a window 1.5 digits tall.
const ITEM = 96;
const WINDOW = 144;
const SPEED = 40; // digits a second while spinning
const STRIP = Array.from({ length: 30 }, (_, i) => i % 10);
// What the reels show before the pull.
const START = [7, 4, 9];

// The pull, in ms from the machine appearing: a short beat, a quick yank
// down, a held moment at the bottom, then a spring back. The reels let go
// as the lever nears the bottom.
const PULL_AT = 360;
const PULL = 340;
const HOLD = 110;
const SPIN_AT = PULL_AT + PULL * 0.8;
const SPIN_UP = 300; // the reels come up to speed
// The spring back: how stiff, and how damped (a little overshoot).
const SPRING_W = 17;
const SPRING_Z = 0.55;
const SPRING_WD = SPRING_W * Math.sqrt(1 - SPRING_Z ** 2);

const easeOutCubic = (u: number) => 1 - (1 - u) ** 3;
const leverAt = (t: number) => {
  if (t < PULL_AT) return 0;
  const u = (t - PULL_AT) / PULL;
  if (u < 1) return PULL_MAX * easeOutCubic(u);
  const back = (t - PULL_AT - PULL - HOLD) / 1000;
  if (back < 0) return PULL_MAX;
  if (back > 1.4) return 0;
  const e = Math.exp(-SPRING_Z * SPRING_W * back);
  return PULL_MAX * e * (Math.cos(SPRING_WD * back) + ((SPRING_Z * SPRING_W) / SPRING_WD) * Math.sin(SPRING_WD * back));
};

// When the first reel starts to settle (after the spin starts), and how far
// through its settling the one before has to be before the next starts.
const FIRST_SETTLE = 1000;
const OVERLAP = 0.55;

type Reel = { p: number; v: number; mode: "rest" | "spin" | "settle" | "done"; from: number; dist: number; t0: number; d: number };

// Ease out with a small overshoot: the reel clunks into place.
const BACK = 0.6;
const easeOutBack = (u: number) => 1 + (BACK + 1) * (u - 1) ** 3 + BACK * (u - 1) ** 2;
// Its starting speed, as a multiple of distance over duration: matching it
// to the spin speed makes the hand-over seamless.
const BACK_START = 3 + BACK;

const wrap = (p: number) => ((p % 10) + 10) % 10;
const offset = (p: number) => WINDOW / 2 - (wrap(p) + 10 + 0.5) * ITEM;

// The machine shrinks to fit a short window, with room for the line above
// and the way back below.
const fitScale = () =>
  typeof window === "undefined" ? 1 : Math.max(0.55, Math.min(1, (window.innerHeight - 230) / H, (window.innerWidth - 32) / W));

export function SlotMachine({
  ready,
  reduced,
  onDone,
  onBack,
}: {
  prompt: string; // kept for callers; not shown (too much text)
  ready: boolean;
  reduced: boolean;
  onDone: () => void;
  onBack: () => void;
}) {
  const machine = useRef<HTMLDivElement>(null);
  const strips = useRef<(HTMLDivElement | null)[]>([]);
  const blurs = useRef<(SVGFEGaussianBlurElement | null)[]>([]);
  const arm = useRef<SVGPathElement>(null);
  const knob = useRef<SVGGElement>(null);
  const [settled, setSettled] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [line, setLine] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [scale, setScale] = useState(fitScale);
  const live = useRef({ ready, onDone });
  useEffect(() => {
    live.current = { ready, onDone };
  });

  useEffect(() => {
    const onResize = () => setScale(fitScale());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // The lever and the reels, drawn straight onto the page each frame.
  useEffect(() => {
    if (reduced) return;
    const start = performance.now();
    const reels: Reel[] = START.map((p) => ({ p, v: 0, mode: "rest", from: 0, dist: 0, t0: 0, d: 0 }));
    let last = start;
    let raf = 0;
    let count = 0;
    let spinAt = 0;
    const clunk = () =>
      machine.current?.animate(
        [{ transform: "translateY(0)" }, { transform: "translateY(2px)" }, { transform: "translateY(0)" }],
        { duration: 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
      );
    const tick = (now: number) => {
      const t = now - start;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const deg = leverAt(t);
      const pose = lever(deg);
      arm.current?.setAttribute("d", pose.arm);
      knob.current?.setAttribute("transform", pose.knob);

      if (!spinAt && t >= SPIN_AT) {
        spinAt = now;
        setSpinning(true);
        for (const r of reels) r.mode = "spin";
      }

      reels.forEach((r, i) => {
        const before = r.p;
        if (r.mode === "spin") {
          // A small kick back, then up to speed.
          const up = (now - spinAt) / SPIN_UP;
          const v = up < 0.2 ? -2.5 : SPEED * easeOutCubic(Math.min(1, (up - 0.2) / 0.8));
          r.p += v * dt;
          const prev = reels[i - 1];
          const prevFar = !prev || prev.mode === "done" || (prev.mode === "settle" && (now - prev.t0) / prev.d >= OVERLAP);
          if (live.current.ready && now - spinAt >= FIRST_SETTLE && prevFar) {
            // Land on this reel's number, at least ten digits on, at a
            // speed that starts where the spin is.
            const target = i + 1;
            let dist = wrap(target - r.p);
            while (dist < 10) dist += 10;
            r.mode = "settle";
            r.from = r.p;
            r.dist = dist;
            r.t0 = now;
            r.d = ((BACK_START * dist) / SPEED) * 1000;
          }
        } else if (r.mode === "settle") {
          const u = Math.min(1, (now - r.t0) / r.d);
          r.p = r.from + r.dist * easeOutBack(u);
          if (u >= 1) {
            r.mode = "done";
            r.p = i + 1;
            count++;
            setSettled(count);
            clunk();
          }
        }
        r.v = r.mode === "done" ? 0 : Math.abs(r.p - before) / Math.max(dt, 0.001);
        const strip = strips.current[i];
        if (strip) strip.style.transform = `translate3d(0, ${offset(r.p)}px, 0)`;
        // Blurred along the reel only, more the faster it goes.
        blurs.current[i]?.setAttribute("stdDeviation", `0 ${Math.min(14, r.v * 0.32).toFixed(2)}`);
      });
      if (count < 3 || deg !== 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  // Standing still: the labels light one by one once the versions start.
  useEffect(() => {
    if (!reduced || !ready) return;
    const ts = [500, 850, 1200].map((ms, i) => setTimeout(() => setSettled(i + 1), ms));
    return () => ts.forEach(clearTimeout);
  }, [reduced, ready]);

  // A new line every second or so while the reels spin.
  useEffect(() => {
    if (settled >= 3) return;
    const t = setInterval(() => setLine((l) => (l + 1) % LINES.length), reduced ? 2200 : 1150);
    return () => clearInterval(t);
  }, [settled, reduced]);

  // Jackpot: a beat to read it and see the lights, then over to the canvas.
  useEffect(() => {
    if (settled < 3) return;
    const out = setTimeout(() => setLeaving(true), reduced ? 1000 : 1150);
    const done = setTimeout(() => live.current.onDone(), reduced ? 1200 : 1430);
    return () => {
      clearTimeout(out);
      clearTimeout(done);
    };
  }, [settled, reduced]);

  const all = settled >= 3;
  const text = all ? JACKPOT : LINES[line];
  const lights = all ? "jackpot" : spinning ? "chase" : "idle";

  return (
    <div
      className={cn(
        "absolute inset-0 flex flex-col items-center justify-center gap-7 px-6 transition-[opacity,scale] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]",
        "starting:opacity-0 motion-safe:starting:scale-[0.96]",
        leaving && "opacity-0 motion-safe:scale-[1.03]",
      )}
    >
      <p role="status" aria-live="polite" className="flex h-9 items-center text-center font-medium text-[26px] text-white tracking-[-0.01em]">
        <TextMorph duration={480}>{text}</TextMorph>
      </p>

      {/* One blur per reel, along the reel only. */}
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <defs>
          {[0, 1, 2].map((i) => (
            <filter key={i} id={`slot-reel-blur-${i}`} x="0" y="-20%" width="100%" height="140%">
              <feGaussianBlur
                ref={(el) => {
                  blurs.current[i] = el;
                }}
                stdDeviation="0 0"
              />
            </filter>
          ))}
        </defs>
      </svg>

      <div style={{ zoom: scale }}>
        <div ref={machine} className="slot-machine relative" data-lights={lights} style={{ width: W, height: H }}>
          <Drawing all={all} />

          {/* The reels, laid into the window. */}
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="absolute overflow-hidden rounded-[7px] bg-[#e4e2dc]"
              style={{ left: reelLeft(i), top: REEL_Y, width: REEL_W, height: WINDOW }}
            >
              <div
                ref={(el) => {
                  strips.current[i] = el;
                }}
                className="absolute inset-x-0 top-0 will-change-transform"
                style={{
                  transform: `translate3d(0, ${offset(reduced ? i + 1 : START[i])}px, 0)`,
                  filter: reduced ? undefined : `url(#slot-reel-blur-${i})`,
                }}
                aria-hidden="true"
              >
                {STRIP.map((d, j) => (
                  <span
                    key={j}
                    className="flex items-center justify-center font-bold text-[#1a1a1c] text-[72px] tabular-nums leading-none tracking-[-0.02em]"
                    style={{ height: ITEM }}
                  >
                    {d}
                  </span>
                ))}
              </div>
              {/* The drum's curve: darker as it turns away, a soft light
                  across the middle, and the shadow of the window's edge. */}
              <div className="slot-drum pointer-events-none absolute inset-0" aria-hidden="true" />
            </div>
          ))}
          {/* Glass over the window. */}
          <div className="slot-glass pointer-events-none absolute rounded-[12px]" style={{ left: 60, top: 198, width: 300, height: 152 }} />

          {/* What each reel stands for, lit as it lands. */}
          {TAKE_WAYS.map((way, i) => (
            <p
              key={way.label}
              className={cn(
                "absolute flex items-center justify-center font-medium text-[11.5px] transition-colors duration-300 ease-out",
                settled > i ? "text-white/90" : "text-white/30",
              )}
              style={{ left: reelLeft(i), top: PLATE_Y, width: REEL_W, height: 24 }}
            >
              {way.label}
            </p>
          ))}

          {/* The marquee's lettering. */}
          <p
            aria-hidden="true"
            className={cn("slot-marquee absolute flex items-center justify-center font-bold text-[40px] tracking-[0.06em]", all && "is-lit")}
            style={{ left: CX - 120, top: 92, width: 240, height: 52 }}
          >
            TRY 3
          </p>

          {/* The lever goes over everything else. */}
          <svg className="pointer-events-none absolute inset-0 overflow-visible" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
            <path ref={arm} d={REST.arm} fill="url(#slot-chrome-arm)" stroke="rgba(0,0,0,0.5)" strokeWidth="0.75" />
            <circle cx={PIVOT.x} cy={PIVOT.y} r="16" fill="url(#slot-chrome-ball)" stroke="#0b0b0c" strokeWidth="1.5" />
            <circle cx={PIVOT.x} cy={PIVOT.y} r="7.5" fill="url(#slot-chrome-ball)" stroke="rgba(0,0,0,0.55)" strokeWidth="1" />
            <g ref={knob} transform={REST.knob}>
              <ellipse cx="0" cy="17" rx="9" ry="3.5" fill="rgba(0,0,0,0.35)" />
              <circle r="18" fill="url(#slot-knob)" stroke="rgba(0,0,0,0.45)" strokeWidth="1" />
              <ellipse cx="-6" cy="-7" rx="6" ry="3.6" fill="rgba(255,255,255,0.75)" transform="rotate(-32 -6 -7)" />
              <circle cx="7" cy="8" r="2" fill="#ffd6ea" opacity="0.35" />
            </g>
          </svg>
        </div>
      </div>

      <div className="flex max-w-[520px] flex-col items-center gap-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-[10px] px-3 text-[12px] text-white/45 outline-none transition-colors hover:bg-white/[0.06] hover:text-white/85 focus-visible:ring-2 focus-visible:ring-ring"
        >
          Back to the editor
          <Kbd>Esc</Kbd>
        </button>
      </div>
    </div>
  );
}

// The cabinet: still, so it never re-renders while the reels spin.
function Drawing({ all }: { all: boolean }) {
  return (
    <svg className="absolute inset-0 overflow-visible" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <defs>
        <filter id="slot-soft" x="-20%" y="-200%" width="140%" height="500%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        {/* Chrome: a bright sky, a dark horizon, a lighter ground. */}
        <linearGradient id="slot-chrome" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4f4f6" />
          <stop offset="0.22" stopColor="#b4b4b9" />
          <stop offset="0.48" stopColor="#5d5d62" />
          <stop offset="0.54" stopColor="#38383c" />
          <stop offset="0.74" stopColor="#8f8f95" />
          <stop offset="1" stopColor="#2c2c2f" />
        </linearGradient>
        <linearGradient id="slot-chrome-side" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#2e2e31" />
          <stop offset="0.35" stopColor="#cfcfd4" />
          <stop offset="0.5" stopColor="#ffffff" />
          <stop offset="0.68" stopColor="#8a8a90" />
          <stop offset="1" stopColor="#262628" />
        </linearGradient>
        <linearGradient id="slot-chrome-arm" gradientUnits="userSpaceOnUse" x1={PIVOT.x - 6} y1="0" x2={PIVOT.x + 6} y2="0">
          <stop offset="0" stopColor="#3a3a3e" />
          <stop offset="0.32" stopColor="#d6d6db" />
          <stop offset="0.46" stopColor="#ffffff" />
          <stop offset="0.7" stopColor="#7e7e84" />
          <stop offset="1" stopColor="#2a2a2d" />
        </linearGradient>
        <radialGradient id="slot-chrome-ball" cx="0.38" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.3" stopColor="#c4c4c9" />
          <stop offset="0.7" stopColor="#55555a" />
          <stop offset="1" stopColor="#1e1e20" />
        </radialGradient>
        {/* The one accent: the studio's pink (--color-studio). */}
        <radialGradient id="slot-knob" cx="0.36" cy="0.32" r="0.78">
          <stop offset="0" style={{ stopColor: "var(--slot-accent-soft)" }} />
          <stop offset="0.38" style={{ stopColor: "var(--slot-accent)" }} />
          <stop offset="0.8" stopColor="#a3165c" />
          <stop offset="1" stopColor="#4a0727" />
        </radialGradient>
        {/* Graphite, lit from the upper left. */}
        <linearGradient id="slot-body" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#1c1c1e" />
          <stop offset="0.16" stopColor="#323235" />
          <stop offset="0.5" stopColor="#252528" />
          <stop offset="1" stopColor="#141415" />
        </linearGradient>
        <linearGradient id="slot-body-top" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.07" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.85" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.35" />
        </linearGradient>
        <radialGradient id="slot-marquee" cx="0.5" cy="0.85" r="0.8">
          <stop offset="0" stopColor="#1d1d20" />
          <stop offset="1" stopColor="#09090a" />
        </radialGradient>
        <linearGradient id="slot-recess" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#020202" />
          <stop offset="1" stopColor="#111113" />
        </linearGradient>
        <linearGradient id="slot-tray" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000" />
          <stop offset="1" stopColor="#1e1e21" />
        </linearGradient>
        <linearGradient id="slot-plinth" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#202023" />
          <stop offset="1" stopColor="#0a0a0b" />
        </linearGradient>
        <radialGradient id="slot-bulb-lit">
          <stop offset="0" stopColor="#fff2f8" />
          <stop offset="0.35" style={{ stopColor: "var(--slot-accent-soft)" }} />
          <stop offset="0.7" style={{ stopColor: "var(--slot-accent)" }} />
          <stop offset="1" style={{ stopColor: "var(--slot-accent)" }} stopOpacity="0" />
        </radialGradient>
        <radialGradient id="slot-bulb-glow">
          <stop offset="0" style={{ stopColor: "var(--slot-accent)" }} stopOpacity="0.55" />
          <stop offset="1" style={{ stopColor: "var(--slot-accent)" }} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Its shadow on the ground. */}
      <ellipse cx={CX + 12} cy={BODY.bottom + 30} rx="216" ry="12" fill="#000" opacity="0.75" filter="url(#slot-soft)" />

      {/* The cabinet, in a chrome trim. */}
      <path d={CABINET} fill="none" stroke="#050505" strokeWidth="14" />
      <path d={CABINET} fill="none" stroke="url(#slot-chrome)" strokeWidth="10" />
      <path d={CABINET} fill="url(#slot-body)" />
      <path d={CABINET} fill="url(#slot-body-top)" />
      <path d={SHEEN} fill="none" stroke="#fff" strokeOpacity="0.16" strokeWidth="2" strokeLinecap="round" />

      {/* The marquee and its lights. */}
      <path
        d={`M${CX - MARQUEE.rx},${MARQUEE.base} A${MARQUEE.rx},${MARQUEE.ry} 0 0 1 ${CX + MARQUEE.rx},${MARQUEE.base} Z`}
        fill="url(#slot-marquee)"
        stroke="#000"
        strokeOpacity="0.8"
        strokeWidth="2"
      />
      <path
        d={`M${CX - MARQUEE.rx + 3},${MARQUEE.base - 1} A${MARQUEE.rx - 3},${MARQUEE.ry - 3} 0 0 1 ${CX + MARQUEE.rx - 3},${MARQUEE.base - 1}`}
        fill="none"
        stroke="#fff"
        strokeOpacity="0.08"
        strokeWidth="1"
      />
      {BULBS.map((b, i) => (
        <g key={i} transform={`translate(${b.x.toFixed(2)} ${b.y.toFixed(2)})`}>
          <circle r="5.5" fill="#1f1f22" stroke="#4a4a4f" strokeWidth="1" />
          <circle cx="-1.6" cy="-1.8" r="1.4" fill="#fff" opacity="0.18" />
          <g className="slot-bulb" style={{ "--i": i % 3, "--j": i % 2 } as React.CSSProperties}>
            <circle r="13" fill="url(#slot-bulb-glow)" />
            <circle r="5.2" fill="url(#slot-bulb-lit)" />
          </g>
        </g>
      ))}

      {/* The band under the marquee. */}
      <rect x={BODY.x0 - 4} y={MARQUEE.base} width={BODY.x1 - BODY.x0 + 8} height="14" rx="3" fill="url(#slot-chrome)" />
      <rect x={BODY.x0 - 4} y={MARQUEE.base + 14} width={BODY.x1 - BODY.x0 + 8} height="2" fill="#000" opacity="0.5" />

      {/* The reel window: a chrome bezel round a deep recess. */}
      <rect x="49" y="187" width="322" height="174" rx="20" fill="#000" opacity="0.6" />
      <rect x="52" y="190" width="316" height="168" rx="18" fill="url(#slot-chrome)" />
      <rect x="60" y="198" width="300" height="152" rx="12" fill="url(#slot-recess)" />
      {/* The pay line's two pointers, lit on the jackpot. */}
      <path d="M41,265 L41,283 L54,274 Z" className={cn("slot-pointer", all && "is-lit")} />
      <path d="M379,265 L379,283 L366,274 Z" className={cn("slot-pointer", all && "is-lit")} />

      {/* A plate under each reel for its label. */}
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x={reelLeft(i)} y={PLATE_Y} width={REEL_W} height="24" rx="7" fill="#0e0e10" />
          <rect x={reelLeft(i) + 0.5} y={PLATE_Y + 0.5} width={REEL_W - 1} height="23" rx="6.5" fill="none" stroke="#fff" strokeOpacity="0.07" />
        </g>
      ))}

      {/* A speaker grille and a coin slot. */}
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x="74" y={410 + i * 6} width="64" height="2.5" rx="1.25" fill="#050506" />
          <rect x="74" y={412.5 + i * 6} width="64" height="0.8" rx="0.4" fill="#fff" opacity="0.07" />
        </g>
      ))}
      <rect x="296" y="404" width="44" height="30" rx="7" fill="url(#slot-chrome)" />
      <rect x="315" y="409" width="6" height="20" rx="3" fill="#050506" />

      {/* The payout tray. */}
      <rect x="116" y="440" width="188" height="34" rx="13" fill="url(#slot-chrome)" />
      <rect x="123" y="446" width="174" height="24" rx="9" fill="url(#slot-tray)" />

      {/* The base it stands on. */}
      <rect x="18" y="480" width="384" height="26" rx="10" fill="url(#slot-plinth)" />
      <rect x="22" y="480" width="376" height="1.5" rx="0.75" fill="#fff" opacity="0.14" />

      {/* The lever's mount on the cabinet's side. */}
      <rect x="386" y="236" width="26" height="72" rx="8" fill="url(#slot-chrome-side)" stroke="#0b0b0c" strokeWidth="1.5" />
      <circle cx="399" cy="247" r="2.4" fill="#1b1b1d" />
      <circle cx="399" cy="297" r="2.4" fill="#1b1b1d" />
    </svg>
  );
}
