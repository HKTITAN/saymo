import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Small drawings for the studio's home page: the two ways to start, the
// empty states and a mark beside the studio's name. Each is drawn in the
// Aerchain way: quiet outlines, fields of flat lines at 2:1 (a 2 unit line,
// a 1 unit gap) and one touch of orange at the point of action. They move a
// little when the thing they sit in is hovered (a parent with
// `group/doodle`), and stay still for anyone who asks for less motion.

const ORANGE = "#F55A00";
const GROUND = "#0b0b0b"; // the page, behind shapes that hide what's under them

// The hover motion every drawing shares: slow, eased out, never bouncing.
const MOVE =
  "transition-[translate,rotate,scale] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] [transform-box:fill-box] motion-reduce:transition-none";

function Doodle({ viewBox, className, children }: { viewBox: string; className?: string; children: ReactNode }) {
  return (
    <svg
      viewBox={viewBox}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("shrink-0 overflow-visible", className)}
    >
      {children}
    </svg>
  );
}

// A field of flat lines filling a box: each line 2 high, 1 apart.
function Lines({ x, y, w, h, className, color }: { x: number; y: number; w: number; h: number; className?: string; color?: string }) {
  const rows: number[] = [];
  for (let at = y + 1; at < y + h; at += 3) rows.push(at);
  return (
    <g stroke={color ?? "currentColor"} strokeWidth={2} strokeLinecap="butt" className={className}>
      {rows.map((at) => (
        <line key={at} x1={x} x2={x + w} y1={at} y2={at} />
      ))}
    </g>
  );
}

// Edit a video: a screen over a timeline of clips; the playhead glides on.
export function VideoDoodle({ className }: { className?: string }) {
  return (
    <Doodle viewBox="0 0 120 72" className={className}>
      <rect x={32} y={4} width={56} height={34} rx={3} stroke="currentColor" strokeWidth={1.5} className="text-white/55" />
      <g className={cn(MOVE, "origin-center motion-safe:group-hover/doodle:scale-110")}>
        <path d="M56 15.5 L66 21 L56 26.5 Z" stroke="currentColor" strokeWidth={1.5} className="text-white/75" />
      </g>
      {(
        [
          [12, 30],
          [45, 22],
          [70, 38],
        ] as const
      ).map(([x, w]) => (
        <g key={x}>
          <Lines x={x + 2} y={50} w={w - 4} h={9} className="text-white/[0.16]" />
          <rect x={x} y={47} width={w} height={14} rx={2.5} stroke="currentColor" strokeWidth={1.5} className="text-white/45" />
        </g>
      ))}
      <g className={cn(MOVE, "motion-safe:group-hover/doodle:translate-x-[22px]")}>
        <line x1={52} x2={52} y1={44} y2={65} stroke={ORANGE} strokeWidth={1.5} />
        <path d="M49 42 h6 l-3 3.5 Z" fill={ORANGE} stroke={ORANGE} strokeWidth={1} />
      </g>
    </Doodle>
  );
}

// Make motion graphics: lines rise like a staircase; the orange block on
// top climbs a step.
export function MotionDoodle({ className }: { className?: string }) {
  const steps = [
    [14, 12],
    [36, 22],
    [58, 32],
    [80, 42],
  ] as const;
  return (
    <Doodle viewBox="0 0 120 72" className={className}>
      {steps.map(([x, h], i) => (
        <g
          key={x}
          className={cn(MOVE, "motion-safe:group-hover/doodle:-translate-y-[4px]")}
          style={{ transitionDelay: `${i * 50}ms` }}
        >
          <Lines x={x} y={64 - h} w={20} h={h} className="text-white/[0.28]" />
        </g>
      ))}
      <line x1={12} x2={106} y1={66.5} y2={66.5} stroke="currentColor" strokeWidth={1.5} className="text-white/40" />
      <g className={cn(MOVE, "motion-safe:group-hover/doodle:-translate-y-[8px] motion-safe:group-hover/doodle:translate-x-[4px]")}>
        {/* What moves leaves a few lines behind it. */}
        <line x1={70} x2={78} y1={9} y2={9} stroke="currentColor" strokeWidth={1.5} className="text-white/30" />
        <line x1={66} x2={78} y1={13} y2={13} stroke="currentColor" strokeWidth={1.5} className="text-white/45" />
        <line x1={72} x2={78} y1={17} y2={17} stroke="currentColor" strokeWidth={1.5} className="text-white/30" />
        <Lines x={82} y={6} w={14} h={14} color={ORANGE} />
      </g>
    </Doodle>
  );
}

// No films yet: a clapperboard whose arm opens a little further on hover.
export function ClapperDoodle({ className }: { className?: string }) {
  return (
    <Doodle viewBox="0 0 120 84" className={className}>
      <rect x={30} y={34} width={60} height={40} rx={3} stroke="currentColor" strokeWidth={1.5} className="text-white/55" />
      <line x1={40} x2={72} y1={50} y2={50} stroke="currentColor" strokeWidth={1.5} className="text-white/30" />
      <line x1={40} x2={60} y1={58} y2={58} stroke="currentColor" strokeWidth={1.5} className="text-white/30" />
      <line x1={40} x2={66} y1={66} y2={66} stroke="currentColor" strokeWidth={1.5} className="text-white/20" />
      <g className={cn(MOVE, "origin-bottom-left -rotate-[12deg] motion-safe:group-hover/doodle:-rotate-[22deg]")}>
        <rect x={30} y={24} width={60} height={10} rx={2} fill={GROUND} stroke="currentColor" strokeWidth={1.5} className="text-white/55" />
        <Lines x={33} y={26} w={54} h={6} className="text-white/[0.2]" />
      </g>
      <circle cx={31} cy={34} r={2.6} fill={ORANGE} />
    </Doodle>
  );
}

// A folder: its back with a tab, a sheet inside, and a front that tips
// open when hovered (or when something is dragged over it).
export function FolderDoodle({ className, open = false }: { className?: string; open?: boolean }) {
  return (
    <Doodle viewBox="0 0 120 84" className={className}>
      <path
        d="M22 72 V20 a3 3 0 0 1 3 -3 h20 l6 6 h44 a3 3 0 0 1 3 3 v46"
        stroke="currentColor"
        strokeWidth={1.5}
        className="text-white/45"
      />
      <g className={cn(MOVE, open ? "-translate-y-[7px]" : "motion-safe:group-hover/doodle:-translate-y-[7px]")}>
        <rect x={34} y={29} width={52} height={30} rx={2} fill={GROUND} stroke="currentColor" strokeWidth={1.5} className="text-white/40" />
        <Lines x={38} y={33} w={44} h={10} className="text-white/[0.16]" />
      </g>
      <g className={cn(MOVE, "origin-bottom", open ? "scale-y-[0.86]" : "motion-safe:group-hover/doodle:scale-y-[0.86]")}>
        <path d="M16 40 H104 L98 72 H22 Z" fill={GROUND} stroke="currentColor" strokeWidth={1.5} className="text-white/60" />
        <line x1={50} x2={70} y1={56} y2={56} stroke={ORANGE} strokeWidth={2} />
      </g>
    </Doodle>
  );
}

// The same folder, small enough for a row. Orange marks the one that's open.
export function TinyFolder({ open = false, current = false, className }: { open?: boolean; current?: boolean; className?: string }) {
  return (
    <Doodle viewBox="0 0 18 14" className={cn("h-3.5 w-[18px]", className)}>
      {/* Only the part above the front is drawn, so it sits on any ground. */}
      <path d="M2 6 V2.5 a1 1 0 0 1 1 -1 h3.5 l1.5 1.5 h7 a1 1 0 0 1 1 1 V6" stroke="currentColor" strokeWidth={1.2} className="opacity-60" />
      <g className={cn(MOVE, "origin-bottom", open ? "scale-y-[0.7]" : "motion-safe:group-hover/doodle:scale-y-[0.82]")}>
        <path d="M1 6 H17 L16 12.5 H2 Z" stroke="currentColor" strokeWidth={1.2} />
        {current || open ? <line x1={7} x2={11} y1={9.3} y2={9.3} stroke={ORANGE} strokeWidth={1.4} /> : null}
      </g>
    </Doodle>
  );
}

// No brand kits yet: three swatch cards that fan out on hover.
export function KitsDoodle({ className }: { className?: string }) {
  const card = (color: string | null) => (
    <>
      <rect x={46} y={18} width={28} height={50} rx={3} fill={GROUND} stroke="currentColor" strokeWidth={1.5} className="text-white/50" />
      {color ? <Lines x={49} y={21} w={22} h={24} color={color} /> : <Lines x={49} y={21} w={22} h={24} className="text-white/[0.2]" />}
      <line x1={50} x2={64} y1={56} y2={56} stroke="currentColor" strokeWidth={1.5} className="text-white/35" />
    </>
  );
  return (
    <Doodle viewBox="0 0 120 84" className={className}>
      <g className={cn(MOVE, "[transform-origin:60px_74px] [transform-box:view-box] -rotate-[16deg] motion-safe:group-hover/doodle:-rotate-[24deg]")}>{card(null)}</g>
      <g className={cn(MOVE, "[transform-origin:60px_74px] [transform-box:view-box] rotate-[16deg] motion-safe:group-hover/doodle:rotate-[24deg]")}>{card(null)}</g>
      <g className={cn(MOVE, "[transform-origin:60px_74px] [transform-box:view-box] motion-safe:group-hover/doodle:-translate-y-[3px]")}>{card(ORANGE)}</g>
    </Doodle>
  );
}

// Beside the studio's name: lines in motion, led by an orange block.
export function StudioMark({ className }: { className?: string }) {
  return (
    <Doodle viewBox="0 0 26 16" className={cn("h-4 w-[26px]", className)}>
      <g className={cn(MOVE, "motion-safe:group-hover/doodle:translate-x-[2px]")}>
        <line x1={3} x2={13} y1={4} y2={4} stroke="currentColor" strokeWidth={2} className="text-white/35" />
        <line x1={1} x2={13} y1={8} y2={8} stroke="currentColor" strokeWidth={2} className="text-white/60" />
        <line x1={5} x2={13} y1={12} y2={12} stroke="currentColor" strokeWidth={2} className="text-white/35" />
      </g>
      <g className={cn(MOVE, "motion-safe:group-hover/doodle:translate-x-[4px]")}>
        <Lines x={16} y={2.5} w={8} h={11} color={ORANGE} />
      </g>
    </Doodle>
  );
}

// A film with no still yet: its own shape, filled with quiet lines.
export function PosterLines({ width, height }: { width: number; height: number }) {
  const wide = width >= height;
  return (
    <span
      aria-hidden="true"
      className="relative overflow-hidden rounded-[3px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
      style={{
        width: wide ? "62%" : undefined,
        height: wide ? undefined : "74%",
        aspectRatio: `${width} / ${height}`,
        maxHeight: "74%",
        backgroundImage: "repeating-linear-gradient(to bottom, rgb(255 255 255 / 0.07) 0 2px, transparent 2px 3px)",
      }}
    />
  );
}
