"use client";

import { useEffect, useRef, useState } from "react";
import { TextMorph } from "torph/react";
import { Kbd } from "@/components/ui/kbd";
import { TAKE_WAYS } from "@/lib/studio/takes-shared";
import { cn } from "@/lib/utils";

// The moment "Try 3" is pressed: a big, soft, clay-like slot machine,
// drawn in code, in the middle of the screen. Its lever is pulled down
// (three pink dashes pop by the ball, the SPIN button presses in and lights
// up) and springs back, and that pull sets the three reels spinning through
// cherries, bells and sevens while a playful line morphs above. The reels
// settle left to right on 1, 2 and 3, one per version, each with a small
// clunk. They only settle once the three versions have really started
// (`ready`); then the hood's pink panel glows, the dashes pop again, and the
// machine fades and hands over to the canvas (`onDone`). With reduced
// motion nothing swings or spins: the reels stand on their numbers and the
// rest only fades.

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
// One coordinate system for the SVG and the reels laid over it, 1 unit =
// 1 px before the fit. The view starts VY units down, where the hood is.

const W = 660;
const H = 484;
const VY = 40;
const VIEW = `0 ${VY} ${W} ${H}`;
const CX = 290; // the body's centre
const BODY = { x: 100, y: 174, w: 380, h: 250 };
// The hood: a rounded cap, narrower than the body, with a pink half-disc.
const HOOD = `M176,192 V150 A114,100 0 0 1 404,150 V192 Z`;
const DISC = { y: 170, r: 90 };
const DISC_PATH = `M${CX - DISC.r},${DISC.y} A${DISC.r},${DISC.r} 0 0 1 ${CX + DISC.r},${DISC.y} Z`;

// The reel window and the reels inside it.
const REEL_W = 86;
const DIVIDER = 2;
const REELS = { x: 159, y: 214, w: REEL_W * 3 + DIVIDER * 2 };

// The lever: a short, thick arm, angled up and a little outwards from a
// round hub at the body's right side. Pulled, it swings towards you, so
// seen from the front the ball drops past the hub and grows a little as it
// comes closer.
const PIVOT = { x: 492, y: 300 };
const ARM = 118;
const LEAN = (14 * Math.PI) / 180;
const BALL_R = 46;
const PULL_MAX = 150; // degrees
const lever = (deg: number) => {
  const a = (deg * Math.PI) / 180;
  const x = PIVOT.x + ARM * Math.sin(LEAN);
  const y = PIVOT.y - ARM * Math.cos(LEAN) * Math.cos(a);
  return { x, y, knob: `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${(1 + 0.14 * Math.sin(a)).toFixed(4)})` };
};
const REST = lever(0);
// Three short dashes that pop up and to the right of the ball.
const BURST = [64, 36, 8].map((d) => {
  const a = (d * Math.PI) / 180;
  const at = (r: number) => `${(REST.x + r * Math.cos(a)).toFixed(1)},${(REST.y - r * Math.sin(a)).toFixed(1)}`;
  return `M${at(60)} L${at(78)}`;
});

// ─── The reels ──────────────────────────────────────────────────────────────

// A reel: a strip of ten symbols, seen through a window 1.3 symbols tall.
// The three it lands on are the numbers; the rest are for the spin.
type Sym = "1" | "2" | "3" | "7" | "cherry" | "bell" | "heart" | "diamond";
const SYMBOLS: Sym[] = ["1", "cherry", "7", "2", "bell", "heart", "3", "diamond", "7", "cherry"];
const TARGET = [0, 3, 6]; // where "1", "2" and "3" sit on the strip
const START = [1, 2, 4]; // cherry, seven, bell before the pull
const ITEM = 96;
const WINDOW = 124;
const SPEED = 40; // symbols a second while spinning
const STRIP = Array.from({ length: 30 }, (_, i) => SYMBOLS[i % 10]);

// ─── The motion ─────────────────────────────────────────────────────────────

// The pull, in ms from the machine appearing: a beat, a quick yank down, a
// held moment at the bottom, then a spring back. The button goes in as the
// lever travels, and the reels let go as it nears the bottom.
const PULL_AT = 560;
const PULL = 340;
const HOLD = 110;
const PRESS_AT = PULL_AT + 120;
const PRESS_FOR = 260;
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

// The machine is drawn big, and shrinks to fit a short window with room
// for the line above and the way back below.
const fitScale = () =>
  typeof window === "undefined" ? 1 : Math.max(0.5, Math.min(1.12, (window.innerHeight - 190) / H, (window.innerWidth - 32) / W));

const MACHINE_LABEL = `A slot machine with three reels: ${TAKE_WAYS.map((w, i) => `${i + 1}, ${w.label}`).join("; ")}`;

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
  const arm = useRef<SVGLineElement>(null);
  const knob = useRef<SVGGElement>(null);
  const [settled, setSettled] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [pop, setPop] = useState(0);
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
    let stage = 0; // 1 pulled, 2 button in, 3 button out
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
      arm.current?.setAttribute("y2", pose.y.toFixed(2));
      knob.current?.setAttribute("transform", pose.knob);
      if (stage < 1 && t >= PULL_AT) {
        stage = 1;
        setPop(1);
      }
      if (stage < 2 && t >= PRESS_AT) {
        stage = 2;
        setPressed(true);
      }
      if (stage < 3 && t >= PRESS_AT + PRESS_FOR) {
        stage = 3;
        setPressed(false);
      }

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
            // Land on this reel's number, at least ten symbols on, at a
            // speed that starts where the spin is.
            let dist = wrap(TARGET[i] - r.p);
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
            r.p = TARGET[i];
            count++;
            setSettled(count);
            clunk();
          }
        }
        r.v = r.mode === "done" ? 0 : Math.abs(r.p - before) / Math.max(dt, 0.001);
        const strip = strips.current[i];
        if (strip) strip.style.transform = `translate3d(0, ${offset(r.p)}px, 0)`;
        // Blurred along the reel only, more the faster it goes.
        blurs.current[i]?.setAttribute("stdDeviation", `0 ${Math.min(12, r.v * 0.3).toFixed(2)}`);
      });
      if (count < 3 || deg !== 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  // Standing still: the versions count in one by one once they start.
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

  // Jackpot: the pop again, a beat to read it and see the glow, then over
  // to the canvas.
  useEffect(() => {
    if (settled < 3) return;
    const again = setTimeout(() => setPop((p) => p + 1), 60);
    const out = setTimeout(() => setLeaving(true), reduced ? 1000 : 1150);
    const done = setTimeout(() => live.current.onDone(), reduced ? 1200 : 1430);
    return () => {
      clearTimeout(again);
      clearTimeout(out);
      clearTimeout(done);
    };
  }, [settled, reduced]);

  const all = settled >= 3;
  const text = all ? JACKPOT : LINES[line];
  const lit = spinning || all;

  return (
    <div
      className={cn(
        "absolute inset-0 flex flex-col items-center justify-center gap-5 px-6 transition-[opacity,scale] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]",
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
        <div
          ref={machine}
          role="img"
          aria-label={MACHINE_LABEL}
          className="slot-machine relative"
          data-lit={lit || undefined}
          data-pressed={pressed || undefined}
          data-jackpot={all || undefined}
          style={{ width: W, height: H }}
        >
          <Drawing />

          {/* The reels: nearly white drums behind thin grey dividers. */}
          <div
            className="absolute flex overflow-hidden rounded-[16px] bg-[#a9a6ad]"
            style={{ left: REELS.x, top: REELS.y - VY, width: REELS.w, height: WINDOW, gap: DIVIDER }}
          >
            {[0, 1, 2].map((i) => (
              <div key={i} className="slot-drum relative h-full shrink-0 overflow-hidden" style={{ width: REEL_W }}>
                <div
                  ref={(el) => {
                    strips.current[i] = el;
                  }}
                  className="absolute inset-x-0 top-0 will-change-transform"
                  style={{
                    transform: `translate3d(0, ${offset(reduced ? TARGET[i] : START[i])}px, 0)`,
                    filter: reduced ? undefined : `url(#slot-reel-blur-${i})`,
                  }}
                >
                  {STRIP.map((s, j) => (
                    <div key={j} className="flex items-center justify-center" style={{ height: ITEM }}>
                      <Symbol s={s} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {/* The window's deep inset, over the drums. */}
            <div className="slot-screen-shade pointer-events-none absolute inset-0 rounded-[16px]" />
          </div>

          {/* The lever goes over everything else. */}
          <svg className="pointer-events-none absolute inset-0 overflow-visible" width={W} height={H} viewBox={VIEW}>
            <line
              ref={arm}
              x1={PIVOT.x}
              y1={PIVOT.y}
              x2={REST.x}
              y2={REST.y}
              stroke="url(#slot-arm)"
              strokeWidth="22"
              strokeLinecap="round"
            />
            <circle cx={PIVOT.x} cy={PIVOT.y} r="31" fill="url(#slot-hub)" filter="url(#slot-clay)" />
            <circle cx={PIVOT.x} cy={PIVOT.y} r="15" fill="#34343a" />
            <circle cx={PIVOT.x - 1.5} cy={PIVOT.y - 2} r="11" fill="#47474e" />
            <g ref={knob} transform={REST.knob}>
              <circle r={BALL_R} fill="url(#slot-ball)" />
              <ellipse cx="-14" cy="-18" rx="15" ry="9" fill="#fff" opacity="0.5" transform="rotate(-32 -14 -18)" filter="url(#slot-blur-3)" />
              <circle cx="-16" cy="-19" r="4.5" fill="#fff" opacity="0.85" />
            </g>
            {pop > 0 ? (
              <g key={pop} className="slot-burst">
                {BURST.map((d) => (
                  <path key={d} d={d} pathLength={1} />
                ))}
              </g>
            ) : null}
          </svg>
        </div>
      </div>

      <button
        type="button"
        onClick={onBack}
        className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-[10px] px-3 text-[12px] text-white/45 outline-none transition-colors hover:bg-white/[0.06] hover:text-white/85 focus-visible:ring-2 focus-visible:ring-ring"
      >
        Back to the editor
        <Kbd>Esc</Kbd>
      </button>
    </div>
  );
}

// One symbol on a reel, big, chunky and pink. Numbers are type; the rest
// are drawn, each lit from the upper left.
function Symbol({ s }: { s: Sym }) {
  if (s === "1" || s === "2" || s === "3" || s === "7")
    return <span className="slot-num font-black text-[84px] leading-none tracking-[-0.03em]">{s}</span>;
  return (
    <svg width="76" height="76" viewBox="0 0 64 64" aria-hidden="true">
      {s === "cherry" ? (
        <>
          <path d="M21 40 C23 26 30 16 40 9 M43 38 C43 26 42 17 40 9" fill="none" stroke="#4a4a50" strokeWidth="4.5" strokeLinecap="round" />
          <path d="M40 9 C46 4 55 6 57 13 C51 15 45 14 40 9 Z" fill="#4a4a50" />
          <circle cx="20" cy="45" r="13" fill="url(#slot-sym)" />
          <circle cx="44" cy="43" r="13" fill="url(#slot-sym)" />
          <circle cx="15" cy="40" r="3.4" fill="#fff" opacity="0.65" />
          <circle cx="39" cy="38" r="3.4" fill="#fff" opacity="0.65" />
        </>
      ) : s === "bell" ? (
        <>
          <path d="M32 7 C20 7 16 18 16 30 C16 38 12 42 8 46 H56 C52 42 48 38 48 30 C48 18 44 7 32 7 Z" fill="url(#slot-sym)" />
          <rect x="6" y="44" width="52" height="8" rx="4" fill="var(--slot-pink-deep)" />
          <circle cx="32" cy="56" r="5.5" fill="var(--slot-pink-deep)" />
          <path d="M23 17 C21 21 20 26 20 32" stroke="#fff" strokeOpacity="0.55" strokeWidth="4" strokeLinecap="round" fill="none" />
        </>
      ) : s === "heart" ? (
        <>
          <path d="M32 57 C14 45 5 35 5 23 C5 14 12 7 21 7 C26 7 30 10 32 14 C34 10 38 7 43 7 C52 7 59 14 59 23 C59 35 50 45 32 57 Z" fill="url(#slot-sym)" />
          <path d="M13 20 C14 16 17 13 21 13" stroke="#fff" strokeOpacity="0.6" strokeWidth="4" strokeLinecap="round" fill="none" />
        </>
      ) : (
        <>
          <path d="M32 5 L57 32 L32 59 L7 32 Z" fill="url(#slot-sym)" />
          <path d="M32 5 L7 32 L32 32 Z" fill="#fff" opacity="0.28" />
          <path d="M32 59 L57 32 L32 32 Z" fill="#000" opacity="0.12" />
        </>
      )}
    </svg>
  );
}

// A big, chunky coin lying flat: a bevelled graphite rim round an embossed
// ring.
function Coin({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <ellipse cx={x} cy={y + 11} rx="36" ry="13" fill="#2a2a2f" />
      <rect x={x - 36} y={y} width="72" height="11" fill="url(#slot-coin-side)" />
      <ellipse cx={x} cy={y} rx="36" ry="13" fill="url(#slot-coin)" />
      <ellipse cx={x} cy={y} rx="35" ry="12" fill="none" stroke="#fff" strokeOpacity="0.12" strokeWidth="1.2" />
      <ellipse cx={x} cy={y + 0.8} rx="24" ry="8" fill="none" stroke="#2f2f35" strokeWidth="3" />
      <ellipse cx={x} cy={y - 0.6} rx="24" ry="8" fill="none" stroke="#fff" strokeOpacity="0.12" strokeWidth="1.5" />
    </g>
  );
}

// The machine itself: still, so it never re-renders while the reels spin.
// Its few states (button in, lit, jackpot glow) are CSS on .slot-machine.
function Drawing() {
  return (
    <svg className="absolute inset-0 overflow-visible" width={W} height={H} viewBox={VIEW} aria-hidden="true">
      <defs>
        {/* Clay: a soft light along the top inside edge and a soft shade
            along the bottom, as if lit from above. */}
        <filter id="slot-clay" x="-10%" y="-10%" width="120%" height="120%">
          <feFlood floodColor="#fff" floodOpacity="0.2" />
          <feComposite in2="SourceAlpha" operator="out" />
          <feGaussianBlur stdDeviation="4" />
          <feOffset dx="2" dy="4" />
          <feComposite in2="SourceAlpha" operator="in" result="light" />
          <feFlood floodColor="#0d0d10" floodOpacity="0.5" />
          <feComposite in2="SourceAlpha" operator="out" />
          <feGaussianBlur stdDeviation="9" />
          <feOffset dx="-3" dy="-9" />
          <feComposite in2="SourceAlpha" operator="in" result="shade" />
          <feMerge>
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="light" />
            <feMergeNode in="shade" />
          </feMerge>
        </filter>
        {/* A deep recess: shadow falling in from the top edge. */}
        <filter id="slot-inset" x="-10%" y="-10%" width="120%" height="120%">
          <feFlood floodColor="#000" floodOpacity="0.75" />
          <feComposite in2="SourceAlpha" operator="out" />
          <feGaussianBlur stdDeviation="7" />
          <feOffset dy="6" />
          <feComposite in2="SourceAlpha" operator="in" result="in" />
          <feMerge>
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="in" />
          </feMerge>
        </filter>
        <filter id="slot-inset-pink" x="-10%" y="-10%" width="120%" height="120%">
          <feFlood floodColor="#7a0b42" floodOpacity="0.5" />
          <feComposite in2="SourceAlpha" operator="out" />
          <feGaussianBlur stdDeviation="7" />
          <feOffset dy="7" />
          <feComposite in2="SourceAlpha" operator="in" result="in" />
          <feMerge>
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="in" />
          </feMerge>
        </filter>
        <filter id="slot-blur-3" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <filter id="slot-ao" x="-30%" y="-100%" width="160%" height="300%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <filter id="slot-glow" x="-50%" y="-60%" width="200%" height="220%">
          <feGaussianBlur stdDeviation="18" />
        </filter>
        <filter id="slot-floor" x="-20%" y="-300%" width="140%" height="700%">
          <feGaussianBlur stdDeviation="12" />
        </filter>
        {/* Mid graphite, lit from the upper left. */}
        <linearGradient id="slot-body" x1="0.15" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor="#57575e" />
          <stop offset="0.55" stopColor="#45454c" />
          <stop offset="1" stopColor="#34343a" />
        </linearGradient>
        <linearGradient id="slot-bezel" x1="0.15" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor="#47474e" />
          <stop offset="1" stopColor="#303036" />
        </linearGradient>
        <linearGradient id="slot-base" x1="0.15" y1="0" x2="0.5" y2="1">
          <stop offset="0" stopColor="#5b5b62" />
          <stop offset="0.5" stopColor="#4a4a51" />
          <stop offset="1" stopColor="#36363c" />
        </linearGradient>
        <linearGradient id="slot-arm" gradientUnits="userSpaceOnUse" x1={PIVOT.x - 4} y1="0" x2={PIVOT.x + 34} y2="0">
          <stop offset="0" stopColor="#5a5a61" />
          <stop offset="0.5" stopColor="#45454c" />
          <stop offset="1" stopColor="#303036" />
        </linearGradient>
        <radialGradient id="slot-hub" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#5d5d64" />
          <stop offset="1" stopColor="#33333a" />
        </radialGradient>
        <radialGradient id="slot-ball" cx="0.36" cy="0.32" r="0.75">
          <stop offset="0" style={{ stopColor: "var(--slot-pink-light)" }} />
          <stop offset="0.45" style={{ stopColor: "var(--slot-pink)" }} />
          <stop offset="1" style={{ stopColor: "var(--slot-pink-deep)" }} />
        </radialGradient>
        <linearGradient id="slot-disc" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--slot-pink-light)" }} />
          <stop offset="0.55" style={{ stopColor: "var(--slot-pink)" }} />
          <stop offset="1" style={{ stopColor: "var(--slot-pink-dark)" }} />
        </linearGradient>
        <linearGradient id="slot-button" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--slot-pink-light)" }} />
          <stop offset="0.5" style={{ stopColor: "var(--slot-pink)" }} />
          <stop offset="1" style={{ stopColor: "var(--slot-pink-dark)" }} />
        </linearGradient>
        {/* The pink the reel symbols are shaded with. */}
        <linearGradient id="slot-sym" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" style={{ stopColor: "var(--slot-pink-light)" }} />
          <stop offset="0.5" style={{ stopColor: "var(--slot-pink)" }} />
          <stop offset="1" style={{ stopColor: "var(--slot-pink-dark)" }} />
        </linearGradient>
        <linearGradient id="slot-coin" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#5e5e65" />
          <stop offset="1" stopColor="#404047" />
        </linearGradient>
        <linearGradient id="slot-coin-side" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#3a3a40" />
          <stop offset="0.4" stopColor="#34343a" />
          <stop offset="1" stopColor="#25252a" />
        </linearGradient>
      </defs>

      {/* The soft, wide floor shadow. */}
      <ellipse cx={CX + 10} cy="498" rx="282" ry="20" fill="#000" opacity="0.85" filter="url(#slot-floor)" />

      {/* The hood, and its pink half-disc. */}
      <path d={HOOD} fill="url(#slot-body)" filter="url(#slot-clay)" />
      <path d={DISC_PATH} className="slot-disc-glow" fill="var(--slot-pink)" filter="url(#slot-glow)" />
      <path
        d={`M${CX - DISC.r - 6},${DISC.y + 2} A${DISC.r + 6},${DISC.r + 6} 0 0 1 ${CX + DISC.r + 6},${DISC.y + 2} Z`}
        fill="#2e2e34"
      />
      <path d={DISC_PATH} fill="url(#slot-disc)" filter="url(#slot-inset-pink)" />
      <path d={DISC_PATH} className="slot-disc-bright" fill="#fff" />
      <text x={CX} y="153" textAnchor="middle" className="slot-disc-text">
        3
      </text>

      {/* The body: soft, big radii, a little shade where the hood sits. */}
      <rect x={BODY.x} y={BODY.y} width={BODY.w} height={BODY.h} rx="30" fill="url(#slot-body)" filter="url(#slot-clay)" />
      <rect x="180" y="172" width="220" height="10" rx="5" fill="#000" opacity="0.35" filter="url(#slot-ao)" />

      {/* The reel window: a thick rounded bezel round a deep inset. */}
      <rect x="140" y="194" width="300" height="164" rx="32" fill="#000" opacity="0.3" filter="url(#slot-ao)" />
      <rect x="140" y="194" width="300" height="164" rx="32" fill="url(#slot-bezel)" filter="url(#slot-clay)" />
      <rect x="153" y="207" width="274" height="138" rx="21" fill="#202024" filter="url(#slot-inset)" />

      {/* The base: wider than the body, with a soft bevel and a little
          shade where it meets the body. */}
      <rect x="110" y="374" width="360" height="16" rx="8" fill="#000" opacity="0.45" filter="url(#slot-ao)" />
      <rect x="86" y="382" width="408" height="106" rx="30" fill="url(#slot-base)" filter="url(#slot-clay)" />

      {/* The big pink SPIN pill on the base, on a darker pink lip. */}
      <ellipse className="slot-button-shadow" cx={CX} cy="462" rx="86" ry="8" fill="#000" opacity="0.45" filter="url(#slot-blur-3)" />
      <rect x={CX - 86} y="410" width="172" height="52" rx="26" fill="var(--slot-pink-deep)" />
      <g className="slot-button-face">
        <rect className="slot-button-glow" x={CX - 86} y="400" width="172" height="52" rx="26" fill="var(--slot-pink)" filter="url(#slot-glow)" />
        <rect x={CX - 86} y="400" width="172" height="52" rx="26" fill="url(#slot-button)" />
        <rect className="slot-button-bright" x={CX - 86} y="400" width="172" height="52" rx="26" fill="#fff" />
        <rect x={CX - 70} y="405" width="140" height="11" rx="5.5" fill="#fff" opacity="0.28" filter="url(#slot-blur-3)" />
        <text x={CX} y="434" textAnchor="middle" className="slot-button-text">
          SPIN
        </text>
      </g>

      {/* Coins: a stack overlapping the base's corner, one lying flat. */}
      <Coin x={98} y={484} />
      <Coin x={95} y={472} />
      <Coin x={99} y={460} />
      <Coin x={96} y={448} />
      <Coin x={578} y={484} />
    </svg>
  );
}
