"use client";

import { useEffect, useRef, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { TAKE_WAYS } from "@/lib/studio/takes-shared";
import { cn } from "@/lib/utils";

// The moment "Try 3" is pressed: three reels spin in the middle of the
// screen while a playful line changes above them, then settle one by one on
// 1, 2 and 3, one reel per version. They only settle once the three versions
// have really started (`ready`); then the machine fades and hands over to
// the canvas (`onDone`). With reduced motion the reels stand still on their
// numbers and only fade.

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

// A reel: a strip of digits seen through a window 1.5 digits tall.
const ITEM = 112;
const WINDOW = 168;
const SPEED = 40; // digits a second while spinning
const STRIP = Array.from({ length: 30 }, (_, i) => i % 10);
// When the first reel starts to settle, and how far through its settling
// the one before has to be before the next starts.
const FIRST_SETTLE = 1000;
const OVERLAP = 0.55;

type Reel = { p: number; v: number; mode: "spin" | "settle" | "done"; from: number; dist: number; t0: number; d: number };

// Ease out with a small overshoot: the reel clunks into place.
const BACK = 0.6;
const easeOutBack = (u: number) => 1 + (BACK + 1) * (u - 1) ** 3 + BACK * (u - 1) ** 2;
// Its starting speed, as a multiple of distance over duration: matching it
// to the spin speed makes the hand-over seamless.
const BACK_START = 3 + BACK;

const wrap = (p: number) => ((p % 10) + 10) % 10;
const offset = (p: number) => WINDOW / 2 - (wrap(p) + 10 + 0.5) * ITEM;

export function SlotMachine({
  prompt,
  ready,
  reduced,
  onDone,
  onBack,
}: {
  prompt: string;
  ready: boolean;
  reduced: boolean;
  onDone: () => void;
  onBack: () => void;
}) {
  const strips = useRef<(HTMLDivElement | null)[]>([]);
  const blurs = useRef<(SVGFEGaussianBlurElement | null)[]>([]);
  const [settled, setSettled] = useState(0);
  const [line, setLine] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const live = useRef({ ready, onDone });
  useEffect(() => {
    live.current = { ready, onDone };
  });

  // The reels, drawn straight onto their strips each frame.
  useEffect(() => {
    if (reduced) return;
    const start = performance.now();
    const reels: Reel[] = [0, 1, 2].map(() => ({ p: Math.random() * 10, v: SPEED, mode: "spin", from: 0, dist: 0, t0: 0, d: 0 }));
    let last = start;
    let raf = 0;
    let count = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      reels.forEach((r, i) => {
        const before = r.p;
        if (r.mode === "spin") {
          r.p += SPEED * dt;
          const prev = reels[i - 1];
          const prevFar = !prev || prev.mode === "done" || (prev.mode === "settle" && (now - prev.t0) / prev.d >= OVERLAP);
          if (live.current.ready && now - start >= FIRST_SETTLE && prevFar) {
            // Land on this reel's number, at least ten digits on, at a
            // speed that starts where the spin is.
            const target = i + 1;
            let dist = wrap(target - r.p);
            while (dist < 10) dist += 10;
            r.mode = "settle";
            r.from = r.p;
            r.dist = dist;
            r.t0 = now;
            r.d = (BACK_START * dist) / SPEED * 1000;
          }
        } else if (r.mode === "settle") {
          const u = Math.min(1, (now - r.t0) / r.d);
          r.p = r.from + r.dist * easeOutBack(u);
          if (u >= 1) {
            r.mode = "done";
            r.p = i + 1;
            count++;
            setSettled(count);
          }
        }
        r.v = Math.abs(r.p - before) / Math.max(dt, 0.001);
        const strip = strips.current[i];
        if (strip) strip.style.transform = `translate3d(0, ${offset(r.p)}px, 0)`;
        // Blurred along the reel only, more the faster it goes.
        blurs.current[i]?.setAttribute("stdDeviation", `0 ${Math.min(9, r.v * 0.22).toFixed(2)}`);
      });
      if (count < 3) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  // Standing still: all three show their number once the versions start.
  useEffect(() => {
    if (!reduced || !ready) return;
    const t = setTimeout(() => setSettled(3), 400);
    return () => clearTimeout(t);
  }, [reduced, ready]);

  // A new line every second or so while the reels spin.
  useEffect(() => {
    if (settled >= 3) return;
    const t = setInterval(() => setLine((l) => (l + 1) % LINES.length), reduced ? 2200 : 1100);
    return () => clearInterval(t);
  }, [settled, reduced]);

  // Jackpot: a beat to read it, then over to the canvas.
  useEffect(() => {
    if (settled < 3) return;
    const out = setTimeout(() => setLeaving(true), reduced ? 1000 : 900);
    const done = setTimeout(() => live.current.onDone(), reduced ? 1200 : 1180);
    return () => {
      clearTimeout(out);
      clearTimeout(done);
    };
  }, [settled, reduced]);

  const all = settled >= 3;
  const text = all ? JACKPOT : LINES[line];

  return (
    <div
      className={cn(
        "absolute inset-0 flex flex-col items-center justify-center gap-9 px-6 transition-[opacity,scale] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]",
        "starting:opacity-0 motion-safe:starting:scale-[0.96]",
        leaving && "opacity-0 motion-safe:scale-[1.03]",
      )}
    >
      {/* One blur per reel, along the reel only. */}
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <defs>
          {[0, 1, 2].map((i) => (
            <filter key={i} id={`studio-reel-blur-${i}`} x="0" y="-20%" width="100%" height="140%">
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

      <p role="status" aria-live="polite" className="flex h-9 items-center text-center font-medium text-[28px] text-white tracking-[-0.01em]">
        <span key={text} className="animate-in fade-in-0 duration-300 motion-safe:slide-in-from-bottom-2">
          {text}
        </span>
      </p>

      <div className="flex flex-col items-center gap-4">
        <div className="relative rounded-[24px] bg-[#141414] p-3 shadow-[0_24px_80px_-16px_rgba(0,0,0,0.8),0_0_0_1px_rgba(255,255,255,0.07)]">
          <div className="flex gap-2.5">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={cn(
                  "relative overflow-hidden rounded-[16px] bg-[#0c0c0c] ring-1 transition-[box-shadow] duration-300",
                  settled > i ? "ring-white/[0.16]" : "ring-white/[0.06]",
                )}
                style={{ width: 124, height: WINDOW }}
              >
                {/* The digits above and below fade into the window. */}
                <div
                  className="absolute inset-0"
                  style={{ maskImage: "linear-gradient(to bottom, transparent 4%, #000 30%, #000 70%, transparent 96%)" }}
                >
                  <div
                    ref={(el) => {
                      strips.current[i] = el;
                    }}
                    className="absolute inset-x-0 top-0 will-change-transform"
                    style={{ transform: `translate3d(0, ${offset(i + 1)}px, 0)`, filter: reduced ? undefined : `url(#studio-reel-blur-${i})` }}
                    aria-hidden="true"
                  >
                    {STRIP.map((d, j) => (
                      <span
                        key={j}
                        className="flex items-center justify-center font-medium text-[88px] text-white tabular-nums leading-none"
                        style={{ height: ITEM }}
                      >
                        {d}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {/* The pay line: two small marks at the machine's sides, lit once
              all three land. */}
          {(["left-0", "right-0"] as const).map((side) => (
            <span
              key={side}
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute top-1/2 h-[3px] w-2 -translate-y-1/2 rounded-full transition-colors duration-300",
                side,
                side === "left-0" ? "-translate-x-1/2" : "translate-x-1/2",
                all ? "bg-[#F55A00]" : "bg-white/20",
              )}
            />
          ))}
        </div>
        <div className="flex gap-2.5 px-3">
          {TAKE_WAYS.map((way, i) => (
            <p
              key={way.label}
              className={cn(
                "w-[124px] text-center text-[12.5px] text-white/55 transition-[opacity,translate] duration-300",
                settled > i ? "opacity-100" : "opacity-0 motion-safe:translate-y-1",
              )}
            >
              {way.label}
            </p>
          ))}
        </div>
      </div>

      <div className="flex max-w-[520px] flex-col items-center gap-4">
        <p className="line-clamp-2 text-center text-[13px] text-white/40 leading-relaxed">{prompt}</p>
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
