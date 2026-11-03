"use client";

import { useEffect, useRef, useState } from "react";
import { slotSounds } from "./slot-sounds";
import { TextMorph } from "torph/react";
import { Kbd } from "@/components/ui/kbd";
import { TAKE_WAYS } from "@/lib/studio/takes-shared";
import { cn } from "@/lib/utils";

// The moment "Try 3" is pressed: a soft, clay-like slot machine, drawn in
// code after the owner's reference, in the middle of the screen. Its lever
// is pulled down (three pink dashes pop by the hood, the SPIN button presses
// in and lights up) and springs back, and that pull sets the three reels
// spinning through cherries, bells and sevens while a playful line morphs
// above. The reels settle left to right on 1, 2 and 3, one per version,
// each with a small clunk. Each moment has its sound (slot-sounds.ts). They only settle once the three versions have
// really started (`ready`); then the hood's pink panel glows, the dashes
// pop again, and the machine fades and hands over to the canvas
// (`onDone`). With reduced motion nothing swings or spins: the reels stand
// on their numbers and the rest only fades.

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
// Drawn in the reference image's own coordinates (it's 2000 by 1333), so
// its outlines line up with it, then shown at S px per unit.

const S = 0.52;
const VX = 350;
const VY = 215;
const VW = 1300;
const VH = 945;
const VIEW = `${VX} ${VY} ${VW} ${VH}`;
const W = VW * S;
const H = VH * S;
const px = (x: number, y: number) => ({ left: (x - VX) * S, top: (y - VY) * S });

const CX = 994; // the hood's centre
// The body and its hood as one shape: a rounded block whose top rises into
// a circular arch (radius 268) through softly curved shoulders.
const SHELL =
  "M629,900 V479 Q629,437 671,437 H716 Q734,437 738,421 A268,268 0 0 1 1250,421 Q1254,437 1272,437 H1307 Q1349,437 1349,479 V900 Z";
// The pink panel: a concentric dome (radius 202), cut flat at the bottom
// with softly rounded corners.
const DISC = "M826,447 H1162 Q1184,447 1183,428 A202,202 0 0 0 805,428 Q804,447 826,447 Z";

// The reels, inside the window.
const REELS = { x: 714, y: 539, w: 556, h: 275 };
const DIVIDER = 5; // px

// The lever: a thick arm leaning out from a chunky hub on the body's right
// side at reel height, a big pink ball on top. Pulled, it swings towards
// you, so seen from the front the ball drops past the hub and grows a
// little as it comes closer.
const PIVOT = { x: 1384, y: 735 };
const BALL = { x: 1447, y: 538, r: 52 };
const ARM = Math.hypot(BALL.x - PIVOT.x, BALL.y - PIVOT.y);
const LEAN = Math.atan2(BALL.x - PIVOT.x, PIVOT.y - BALL.y);
const PULL_MAX = 150; // degrees
const lever = (deg: number) => {
  const a = (deg * Math.PI) / 180;
  const x = PIVOT.x + ARM * Math.sin(LEAN);
  const y = PIVOT.y - ARM * Math.cos(LEAN) * Math.cos(a);
  return { x, y, knob: `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${(1 + 0.14 * Math.sin(a)).toFixed(4)})` };
};
const REST = lever(0);
// Three short dashes that pop out from the hood's upper right.
const BURST = ["M1290,303 L1320,255", "M1335,345 L1385,308", "M1348,381 L1393,380"];

// ─── The reels ──────────────────────────────────────────────────────────────

// A reel: a strip of ten symbols, one showing at a time. The three it lands
// on are the numbers; the rest are for the spin.
type Sym = "1" | "2" | "3" | "7" | "cherry" | "bell" | "heart" | "diamond";
const SYMBOLS: Sym[] = ["1", "cherry", "7", "2", "bell", "heart", "3", "diamond", "7", "cherry"];
const TARGET = [0, 3, 6]; // where "1", "2" and "3" sit on the strip
const START = [1, 5, 2]; // cherry, heart, seven before the pull
const WINDOW = REELS.h * S;
const ITEM = WINDOW;
const REEL_W = (REELS.w * S - DIVIDER * 2) / 3;
const SPEED = 30; // symbols a second while spinning
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

// The machine shrinks to fit a short window, with room for the line above
// and the way back below.
const fitScale = () =>
  typeof window === "undefined" ? 1 : Math.max(0.5, Math.min(1, (window.innerHeight - 170) / H, (window.innerWidth - 32) / W));

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
    let lastTick = 0;
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
        slotSounds.pull();
      }
      if (stage < 2 && t >= PRESS_AT) {
        stage = 2;
        setPressed(true);
        slotSounds.press();
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
          const v = up < 0.2 ? -2 : SPEED * easeOutCubic(Math.min(1, (up - 0.2) / 0.8));
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
            slotSounds.land(i);
          }
        }
        r.v = r.mode === "done" ? 0 : Math.abs(r.p - before) / Math.max(dt, 0.001);
        // A tick each time a symbol passes the pay line (the first reel
        // speaks for all three, so it stays a tick and not a buzz).
        if (i === 0 && r.mode !== "done" && Math.floor(r.p) !== Math.floor(before) && now - lastTick > 45) {
          lastTick = now;
          slotSounds.tick(r.v);
        }
        const strip = strips.current[i];
        if (strip) strip.style.transform = `translate3d(0, ${offset(r.p)}px, 0)`;
        // Blurred along the reel only, more the faster it goes.
        blurs.current[i]?.setAttribute("stdDeviation", `0 ${Math.min(14, r.v * 0.4).toFixed(2)}`);
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
    if (!reduced) slotSounds.jackpot();
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
        "absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 transition-[opacity,scale] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]",
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

          {/* The reels: near-white drums behind thin grey dividers. */}
          <div
            className="absolute flex overflow-hidden rounded-[16px] bg-[#8a8293]"
            style={{ ...px(REELS.x, REELS.y), width: REELS.w * S, height: WINDOW, gap: DIVIDER }}
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
                {/* The drum's curve: shaded as it turns away. */}
                <div className="slot-drum-shade pointer-events-none absolute inset-0" />
              </div>
            ))}
            <div className="slot-screen-shade pointer-events-none absolute inset-0 rounded-[16px]" />
          </div>

          {/* The lever goes over everything else. */}
          <svg className="pointer-events-none absolute inset-0 overflow-visible" width={W} height={H} viewBox={VIEW}>
            <line ref={arm} x1={PIVOT.x} y1={PIVOT.y} x2={REST.x} y2={REST.y} stroke="url(#slot-arm)" strokeWidth="30" strokeLinecap="round" />
            <rect x="1340" y="698" width="78" height="104" rx="38" fill="url(#slot-hub)" filter="url(#slot-clay)" />
            <g ref={knob} transform={REST.knob}>
              <circle r={BALL.r} fill="url(#slot-ball)" />
              <ellipse cx="-17" cy="-20" rx="17" ry="10" fill="#fff" opacity="0.45" transform="rotate(-32 -17 -20)" filter="url(#slot-blur-3)" />
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

// One symbol on a reel, chunky and pink. Numbers are type; the rest are
// drawn, each lit from the upper left.
function Symbol({ s }: { s: Sym }) {
  if (s === "1" || s === "2" || s === "3" || s === "7")
    return <span className="slot-num font-black text-[84px] leading-none tracking-[-0.03em]">{s}</span>;
  return (
    <svg width="82" height="82" viewBox="0 0 64 64" aria-hidden="true">
      {s === "cherry" ? (
        <>
          <path d="M19 41 C21 28 27 17 34 11 M44 40 C43 28 39 18 34 11" fill="none" stroke="#4a4652" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M34 11 C41 4 52 5 56 12 C49 15 41 15 34 11 Z" fill="#4a4652" />
          <circle cx="18" cy="47" r="12" fill="url(#slot-sym)" />
          <circle cx="44" cy="47" r="12" fill="url(#slot-sym)" />
          <circle cx="13.5" cy="42.5" r="3" fill="#fff" opacity="0.55" />
          <circle cx="39.5" cy="42.5" r="3" fill="#fff" opacity="0.55" />
        </>
      ) : s === "bell" ? (
        <>
          <path d="M32 8 C21 8 17 18 17 30 C17 37 13 41 9 45 H55 C51 41 47 37 47 30 C47 18 43 8 32 8 Z" fill="url(#slot-sym)" />
          <rect x="7" y="43" width="50" height="7" rx="3.5" fill="var(--slot-pink-deep)" />
          <circle cx="32" cy="55" r="5" fill="var(--slot-pink-deep)" />
          <path d="M24 18 C22 22 21 26 21 31" stroke="#fff" strokeOpacity="0.5" strokeWidth="3.5" strokeLinecap="round" fill="none" />
        </>
      ) : s === "heart" ? (
        <>
          <path d="M32 55 C15 44 7 35 7 24 C7 15 13 9 21 9 C26 9 30 12 32 16 C34 12 38 9 43 9 C51 9 57 15 57 24 C57 35 49 44 32 55 Z" fill="url(#slot-sym)" />
          <path d="M15 21 C16 17 18 15 22 15" stroke="#fff" strokeOpacity="0.55" strokeWidth="3.5" strokeLinecap="round" fill="none" />
        </>
      ) : (
        <>
          <path d="M32 7 L55 32 L32 57 L9 32 Z" fill="url(#slot-sym)" />
          <path d="M32 7 L9 32 L32 32 Z" fill="#fff" opacity="0.25" />
          <path d="M32 57 L55 32 L32 32 Z" fill="#000" opacity="0.1" />
        </>
      )}
    </svg>
  );
}

// A big, chunky coin lying flat: a bevelled graphite rim round a light
// top with an embossed ring.
function Coin({ x, y, rx = 78, ry = 28, depth = 22 }: { x: number; y: number; rx?: number; ry?: number; depth?: number }) {
  return (
    <g>
      <ellipse cx={x} cy={y + depth} rx={rx} ry={ry} fill="#2c2932" />
      <rect x={x - rx} y={y} width={rx * 2} height={depth} fill="url(#slot-coin-side)" />
      <ellipse cx={x} cy={y} rx={rx} ry={ry} fill="url(#slot-coin)" />
      <ellipse cx={x} cy={y + 1.5} rx={rx - 5} ry={ry - 4} fill="none" stroke="#fff" strokeOpacity="0.2" strokeWidth="2.5" />
      <ellipse cx={x} cy={y + 2} rx={rx * 0.5} ry={ry * 0.5} fill="none" stroke="#3a3641" strokeWidth="8" />
      <ellipse cx={x} cy={y - 1.5} rx={rx * 0.5} ry={ry * 0.5} fill="none" stroke="#fff" strokeOpacity="0.22" strokeWidth="2.5" />
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
            along the bottom, as if lit from the upper left. */}
        <filter id="slot-clay" x="-10%" y="-10%" width="120%" height="120%">
          <feFlood floodColor="#fff" floodOpacity="0.22" />
          <feComposite in2="SourceAlpha" operator="out" />
          <feGaussianBlur stdDeviation="8" />
          <feOffset dx="5" dy="8" />
          <feComposite in2="SourceAlpha" operator="in" result="light" />
          <feFlood floodColor="#0c0b10" floodOpacity="0.45" />
          <feComposite in2="SourceAlpha" operator="out" />
          <feGaussianBlur stdDeviation="18" />
          <feOffset dx="-6" dy="-18" />
          <feComposite in2="SourceAlpha" operator="in" result="shade" />
          <feMerge>
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="light" />
            <feMergeNode in="shade" />
          </feMerge>
        </filter>
        {/* A recess: shadow falling in from the top edge. */}
        <filter id="slot-inset" x="-10%" y="-10%" width="120%" height="120%">
          <feFlood floodColor="#000" floodOpacity="0.7" />
          <feComposite in2="SourceAlpha" operator="out" />
          <feGaussianBlur stdDeviation="10" />
          <feOffset dy="10" />
          <feComposite in2="SourceAlpha" operator="in" result="in" />
          <feMerge>
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="in" />
          </feMerge>
        </filter>
        <filter id="slot-blur-3" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <filter id="slot-ao" x="-30%" y="-100%" width="160%" height="300%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
        <filter id="slot-glow" x="-50%" y="-60%" width="200%" height="220%">
          <feGaussianBlur stdDeviation="34" />
        </filter>
        <filter id="slot-floor" x="-10%" y="-100%" width="120%" height="300%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
        {/* Graphite, a little warm, lit from the upper left. */}
        <linearGradient id="slot-body" x1="0.1" y1="0" x2="0.5" y2="1">
          <stop offset="0" stopColor="#635e6c" />
          <stop offset="0.45" stopColor="#4c4855" />
          <stop offset="1" stopColor="#38343f" />
        </linearGradient>
        {/* The bezel round the window: in shade along the top, catching
            the light on its lower lip and right side. */}
        <linearGradient id="slot-bezel" x1="0.3" y1="0" x2="0.5" y2="1">
          <stop offset="0" stopColor="#37333f" />
          <stop offset="0.45" stopColor="#524d5a" />
          <stop offset="1" stopColor="#857b8a" />
        </linearGradient>
        {/* The base: lit along its upper face, darker towards the floor. */}
        <linearGradient id="slot-base" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#47434f" />
          <stop offset="0.4" stopColor="#5f5b68" />
          <stop offset="0.72" stopColor="#4a4653" />
          <stop offset="1" stopColor="#2e2b36" />
        </linearGradient>
        <linearGradient id="slot-arm" gradientUnits="userSpaceOnUse" x1={PIVOT.x} y1="0" x2={PIVOT.x + 90} y2="0">
          <stop offset="0" stopColor="#6e6876" />
          <stop offset="0.5" stopColor="#56505d" />
          <stop offset="1" stopColor="#433f4b" />
        </linearGradient>
        <linearGradient id="slot-hub" x1="0.2" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor="#8f8798" />
          <stop offset="0.35" stopColor="#696371" />
          <stop offset="1" stopColor="#3f3b47" />
        </linearGradient>
        <radialGradient id="slot-ball" cx="0.35" cy="0.3" r="0.78">
          <stop offset="0" style={{ stopColor: "var(--slot-pink-light)" }} />
          <stop offset="0.45" style={{ stopColor: "var(--slot-pink)" }} />
          <stop offset="1" style={{ stopColor: "var(--slot-pink-deep)" }} />
        </radialGradient>
        <linearGradient id="slot-disc" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--slot-pink-light)" }} />
          <stop offset="0.6" style={{ stopColor: "var(--slot-pink)" }} />
          <stop offset="1" style={{ stopColor: "var(--slot-pink)" }} />
        </linearGradient>
        <linearGradient id="slot-button" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--slot-pink-light)" }} />
          <stop offset="0.55" style={{ stopColor: "var(--slot-pink)" }} />
          <stop offset="1" style={{ stopColor: "var(--slot-pink)" }} />
        </linearGradient>
        {/* The pink the reel symbols are shaded with. */}
        <linearGradient id="slot-sym" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" style={{ stopColor: "var(--slot-pink-light)" }} />
          <stop offset="0.5" style={{ stopColor: "var(--slot-pink)" }} />
          <stop offset="1" style={{ stopColor: "var(--slot-pink-dark)" }} />
        </linearGradient>
        <linearGradient id="slot-coin" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#a39bab" />
          <stop offset="1" stopColor="#837c8b" />
        </linearGradient>
        <linearGradient id="slot-coin-side" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#4b4653" />
          <stop offset="0.5" stopColor="#3d3944" />
          <stop offset="1" stopColor="#2f2b35" />
        </linearGradient>
      </defs>

      {/* The wide, soft floor everything stands on, and the shade right
          under the machine. */}
      <ellipse cx="996" cy="1100" rx="632" ry="46" fill="#1c1a23" filter="url(#slot-floor)" />
      <ellipse cx="990" cy="1110" rx="400" ry="16" fill="#000" opacity="0.55" filter="url(#slot-ao)" />

      {/* The body with its hood, and the pink panel in the hood. */}
      <path d={SHELL} fill="url(#slot-body)" filter="url(#slot-clay)" />
      <path d={DISC} className="slot-disc-glow" fill="var(--slot-pink)" filter="url(#slot-glow)" />
      <ellipse cx={CX} cy="452" rx="188" ry="9" fill="#120f16" opacity="0.8" filter="url(#slot-blur-3)" />
      <path d={DISC} fill="url(#slot-disc)" />
      <path d={DISC} className="slot-disc-bright" fill="#fff" />
      <text x={CX} y="406" textAnchor="middle" className="slot-disc-text">
        3
      </text>

      {/* The reel window: a thick rounded bezel round a snug recess. */}
      <rect x="675" y="495" width="635" height="365" rx="54" fill="url(#slot-bezel)" filter="url(#slot-clay)" />
      <rect x="708" y="531" width="568" height="290" rx="34" fill="#1d1a22" filter="url(#slot-inset)" />

      {/* A deep groove where the body meets the base. */}
      <rect x="640" y="864" width="700" height="24" rx="12" fill="#120f16" opacity="0.85" filter="url(#slot-blur-3)" />

      {/* The base: one chunky block, a little wider than the body, its top
          edge soft and lit. */}
      <rect x="609" y="885" width="761" height="227" rx="30" fill="url(#slot-base)" filter="url(#slot-clay)" />
      <rect x="611" y="905" width="5" height="190" rx="2.5" fill="#fff" opacity="0.14" filter="url(#slot-blur-3)" />

      {/* The big pink SPIN pill on the base's upper part, on a darker pink
          lip. */}
      <ellipse className="slot-button-shadow" cx="991" cy="1014" rx="200" ry="12" fill="#000" opacity="0.4" filter="url(#slot-blur-3)" />
      <rect x="784" y="922" width="414" height="90" rx="45" fill="var(--slot-pink-deep)" />
      <g className="slot-button-face">
        <rect className="slot-button-glow" x="784" y="905" width="414" height="90" rx="45" fill="var(--slot-pink)" filter="url(#slot-glow)" />
        <rect x="784" y="905" width="414" height="90" rx="45" fill="url(#slot-button)" />
        <rect className="slot-button-bright" x="784" y="905" width="414" height="90" rx="45" fill="#fff" />
        <text x="991" y="968" textAnchor="middle" className="slot-button-text">
          SPIN
        </text>
      </g>

      {/* Coins: a stack of four at the left, the top one set up and to the
          right, and one lying flat on the right. */}
      <Coin x={503} y={1050} />
      <Coin x={505} y={1025} />
      <Coin x={502} y={1000} />
      <Coin x={534} y={935} rx={75} ry={32} />
      <Coin x={1483} y={1044} rx={75} ry={28} depth={30} />
    </svg>
  );
}
