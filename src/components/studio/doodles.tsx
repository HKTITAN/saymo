import { type ReactNode, useId } from "react";
import { cn } from "@/lib/utils";

// Small drawings for the studio's home page: the two ways to start, the
// empty states, folders and a mark beside the studio's name. The studio is
// a tool, not a brand, so they are plain and friendly: soft rounded shapes
// in greys, no brand colour and no line fields. They move a little when the
// thing they sit in is hovered (a parent with `group/doodle`), and stay
// still for anyone who asks for less motion.

const GROUND = "#0b0b0b"; // the page, behind shapes that hide what's under them
const SOFT = "rgb(255 255 255 / 0.07)"; // a quiet fill
const MID = "rgb(255 255 255 / 0.16)";

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

// Two dots and a small smile: a face for the drawings that wait for you.
function Face({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g className="text-white/70">
      <circle cx={x - 5 * s} cy={y} r={1.4 * s} fill="currentColor" />
      <circle cx={x + 5 * s} cy={y} r={1.4 * s} fill="currentColor" />
      <path d={`M${x - 2.6 * s} ${y + 3.6 * s} q${2.6 * s} ${2.4 * s} ${5.2 * s} 0`} stroke="currentColor" strokeWidth={1.3} />
    </g>
  );
}

// The two start tiles: one plain object each, the studio's screen at its
// simplest. At rest each shows its result; on hover, the one thing that
// makes it happens again.

const INK = "#f2f2f2";
const TYPE = { fontFamily: "inherit" } as const;

// Edit a video: a screen over three clips. On hover the playhead runs into
// the last clip and the caption appears on the screen.
export function VideoDoodle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 180" aria-hidden="true" className={className}>
      <rect x={92} y={26} width={136} height={77} rx={8} fill="#2e2e2e" />
      <g className="motion-safe:group-hover/doodle:animate-[studio-caption-in_1.3s_both]">
        <rect x={122} y={84} width={76} height={12} rx={4} fill="rgb(0 0 0 / 0.55)" />
        <text x={160} y={92.6} fontSize={7.5} fontWeight={500} fill={INK} textAnchor="middle" style={TYPE}>
          Welcome aboard
        </text>
      </g>
      {(
        [
          [72, 58],
          [134, 44],
          [182, 66],
        ] as const
      ).map(([x, w]) => (
        <rect key={x} x={x} y={124} width={w} height={20} rx={5} fill={x === 182 ? "#4a4a4a" : "#2e2e2e"} />
      ))}
      <g className="[transform-box:view-box] motion-safe:group-hover/doodle:animate-[studio-playhead_1.3s_cubic-bezier(0.45,0,0.2,1)_both]">
        <line x1={206} x2={206} y1={118} y2={150} stroke={INK} strokeWidth={1.5} strokeLinecap="round" />
        <circle cx={206} cy={117} r={3} fill={INK} />
      </g>
    </svg>
  );
}

// Make motion graphics: a prompt sent, and the title it asked for rising
// in word by word.
export function MotionDoodle({ className }: { className?: string }) {
  const id = useId();
  const word = "motion-safe:group-hover/doodle:animate-[studio-word-in_0.75s_cubic-bezier(0.23,1,0.32,1)_both] [transform-box:fill-box]";
  return (
    <svg viewBox="0 0 320 180" aria-hidden="true" className={className}>
      <defs>
        <clipPath id={`${id}-line`}>
          <rect x={60} y={44} width={200} height={34} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-line)`}>
        <text x={157} y={70} fontSize={26} fontWeight={650} letterSpacing={-0.5} fill={INK} textAnchor="end" className={word} style={{ ...TYPE, animationDelay: "0.3s" }}>
          Launch
        </text>
        <text x={164} y={70} fontSize={26} fontWeight={650} letterSpacing={-0.5} fill={INK} className={word} style={{ ...TYPE, animationDelay: "0.42s" }}>
          day
        </text>
      </g>
      <rect x={70} y={112} width={180} height={30} rx={15} fill="#2e2e2e" />
      <text x={85} y={130} fontSize={9} fill="rgb(255 255 255 / 0.75)" style={TYPE}>
        Bring the title in
      </text>
      <g className="[transform-box:fill-box] origin-center motion-safe:group-hover/doodle:animate-[studio-press_0.4s_ease-out_both]">
        <circle cx={235} cy={127} r={10} fill={INK} />
        <path d="M235 131.5 V123 M231.2 126.6 L235 122.8 L238.8 126.6" stroke="#141414" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </g>
    </svg>
  );
}

// No films yet: a clapperboard with a face, whose arm opens on hover.
export function ClapperDoodle({ className }: { className?: string }) {
  return (
    <Doodle viewBox="0 0 120 84" className={className}>
      <rect x={30} y={34} width={60} height={40} rx={6} fill={SOFT} stroke="currentColor" strokeWidth={1.5} className="text-white/55" />
      <Face x={60} y={52} />
      <g className={cn(MOVE, "origin-bottom-left -rotate-[12deg] motion-safe:group-hover/doodle:-rotate-[22deg]")}>
        <rect x={30} y={23} width={60} height={11} rx={3} fill={GROUND} stroke="currentColor" strokeWidth={1.5} className="text-white/55" />
        {[38, 52, 66, 80].map((x) => (
          <path key={x} d={`M${x} 24.5 l5 8 h5 l-5 -8 Z`} fill="currentColor" className="text-white/25" />
        ))}
      </g>
      <circle cx={31} cy={34} r={2.4} fill="currentColor" className="text-white/70" />
    </Doodle>
  );
}

// A folder: its back with a tab, a sheet inside, and a front that tips
// open when hovered (or when something is dragged over it).
export function FolderDoodle({ className, open = false }: { className?: string; open?: boolean }) {
  return (
    <Doodle viewBox="0 0 120 84" className={className}>
      <path
        d="M22 72 V22 a5 5 0 0 1 5 -5 h17 a4 4 0 0 1 3 1.3 l4 4.7 h42 a5 5 0 0 1 5 5 v44"
        fill={SOFT}
        stroke="currentColor"
        strokeWidth={1.5}
        className="text-white/40"
      />
      <g className={cn(MOVE, open ? "-translate-y-[8px]" : "motion-safe:group-hover/doodle:-translate-y-[8px]")}>
        <rect x={34} y={29} width={52} height={30} rx={4} fill={GROUND} stroke="currentColor" strokeWidth={1.5} className="text-white/40" />
        <rect x={39} y={34} width={22} height={4} rx={2} fill={MID} />
        <rect x={39} y={41} width={34} height={4} rx={2} fill={SOFT} />
      </g>
      <g className={cn(MOVE, "origin-bottom", open ? "scale-y-[0.86]" : "motion-safe:group-hover/doodle:scale-y-[0.86]")}>
        <path d="M17 44 a4 4 0 0 1 4 -4 H99 a4 4 0 0 1 4 4.6 L99 68 a5 5 0 0 1 -5 4 H26 a5 5 0 0 1 -5 -4 Z" fill="#1d1d1d" stroke="currentColor" strokeWidth={1.5} className="text-white/55" />
        <Face x={60} y={55} s={0.9} />
      </g>
    </Doodle>
  );
}

// The same folder, small enough for a row. The open one is filled in.
export function TinyFolder({ open = false, current = false, className }: { open?: boolean; current?: boolean; className?: string }) {
  return (
    <Doodle viewBox="0 0 18 14" className={cn("h-3.5 w-[18px]", className)}>
      {/* Only the part above the front is drawn, so it sits on any ground. */}
      <path d="M2 6 V3 a1.5 1.5 0 0 1 1.5 -1.5 h3 l1.5 1.5 h6.5 a1.5 1.5 0 0 1 1.5 1.5 V6" stroke="currentColor" strokeWidth={1.2} className="opacity-60" />
      <g className={cn(MOVE, "origin-bottom", open ? "scale-y-[0.7]" : "motion-safe:group-hover/doodle:scale-y-[0.82]")}>
        <path d="M1.5 6 H16.5 L15.6 11.4 a1.5 1.5 0 0 1 -1.5 1.1 H3.9 a1.5 1.5 0 0 1 -1.5 -1.1 Z" fill={current || open ? "currentColor" : "none"} fillOpacity={0.25} stroke="currentColor" strokeWidth={1.2} />
      </g>
    </Doodle>
  );
}

// No brand kits yet: three paint chips that fan out on hover.
export function KitsDoodle({ className }: { className?: string }) {
  const card = (dots: string[]) => (
    <>
      <rect x={46} y={18} width={28} height={50} rx={5} fill={GROUND} stroke="currentColor" strokeWidth={1.5} className="text-white/50" />
      {dots.map((fill, i) => (
        <circle key={i} cx={60} cy={28 + i * 11} r={4} fill={fill} />
      ))}
      <rect x={52} y={59} width={16} height={3} rx={1.5} fill={MID} />
    </>
  );
  return (
    <Doodle viewBox="0 0 120 84" className={className}>
      <g className={cn(MOVE, "[transform-origin:60px_74px] [transform-box:view-box] -rotate-[16deg] motion-safe:group-hover/doodle:-rotate-[24deg]")}>
        {card([SOFT, SOFT, SOFT])}
      </g>
      <g className={cn(MOVE, "[transform-origin:60px_74px] [transform-box:view-box] rotate-[16deg] motion-safe:group-hover/doodle:rotate-[24deg]")}>
        {card([SOFT, SOFT, SOFT])}
      </g>
      <g className={cn(MOVE, "[transform-origin:60px_74px] [transform-box:view-box] motion-safe:group-hover/doodle:-translate-y-[3px]")}>
        {card(["rgb(255 255 255 / 0.85)", "rgb(255 255 255 / 0.45)", "rgb(255 255 255 / 0.18)"])}
      </g>
    </Doodle>
  );
}

// Beside the studio's name: a small rounded frame with a play mark that
// nudges forward on hover.
export function StudioMark({ className }: { className?: string }) {
  return (
    <Doodle viewBox="0 0 20 16" className={cn("h-4 w-5", className)}>
      <rect x={1} y={1} width={18} height={14} rx={4} fill={SOFT} stroke="currentColor" strokeWidth={1.4} className="text-white/60" />
      <g className={cn(MOVE, "motion-safe:group-hover/doodle:translate-x-[1.5px]")}>
        <path d="M8.2 5.3 Q7.6 5 7.6 5.7 V10.3 Q7.6 11 8.2 10.7 L12.4 8.5 Q13 8 12.4 7.5 Z" fill="currentColor" className="text-white/85" />
      </g>
    </Doodle>
  );
}

// A film with no still yet: its own shape, quietly filled, with a small
// play mark.
export function PosterLines({ width, height }: { width: number; height: number }) {
  const wide = width >= height;
  return (
    <span
      aria-hidden="true"
      className="relative flex items-center justify-center overflow-hidden rounded-[6px] bg-white/[0.04] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
      style={{
        width: wide ? "62%" : undefined,
        height: wide ? undefined : "74%",
        aspectRatio: `${width} / ${height}`,
        maxHeight: "74%",
      }}
    >
      <svg viewBox="0 0 12 12" className="size-4 text-white/25" aria-hidden="true">
        <path d="M4 2.6 Q3.2 2.2 3.2 3.1 V8.9 Q3.2 9.8 4 9.4 L9.2 6.6 Q10 6 9.2 5.4 Z" fill="currentColor" />
      </svg>
    </span>
  );
}
