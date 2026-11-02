import { cn } from "@/lib/utils";

// Claude's pixel mascot at work, for the folded Claude pill while a turn
// runs: it walks on the spot, blinks now and then, and watches a playhead
// slide along a little clip beside it. Pixels stay crisp; it holds still
// for anyone who asks for less motion.

const BODY = "#D97757";
const EYE = "#141414";

export function ClaudeAtWork({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 26 8" shapeRendering="crispEdges" aria-hidden="true" className={cn("h-4 w-[52px] shrink-0 overflow-visible", className)}>
      {/* The clip being edited, and its playhead. */}
      <rect x={13} y={3} width={12} height={3} rx={0.6} fill="rgb(255 255 255 / 0.18)" />
      <rect x={13} y={3} width={4} height={3} rx={0.6} fill="rgb(255 255 255 / 0.32)" />
      <g className="motion-safe:animate-[studio-clawd-scrub_1.8s_linear_infinite]">
        <rect x={13} y={1.5} width={0.8} height={6} fill="#f2f2f2" />
      </g>
      {/* Claude. */}
      <g className="motion-safe:animate-[studio-clawd-bob_0.5s_steps(1,end)_infinite]">
        <rect x={1} y={1} width={8} height={4} fill={BODY} />
        <rect x={0} y={2.5} width={1} height={1.2} fill={BODY} />
        <rect x={9} y={2.5} width={1} height={1.2} fill={BODY} />
        <g className="[transform-box:fill-box] [transform-origin:50%_50%] motion-safe:animate-[studio-clawd-blink_3.2s_steps(1,end)_infinite]">
          <rect x={3} y={2} width={1} height={1.4} fill={EYE} />
          <rect x={6.6} y={2} width={1} height={1.4} fill={EYE} />
        </g>
      </g>
      <g className="motion-safe:animate-[studio-clawd-step_0.5s_steps(1,end)_infinite]">
        <rect x={2} y={5} width={1} height={2} fill={BODY} />
        <rect x={6} y={5} width={1} height={2} fill={BODY} />
      </g>
      <g className="motion-safe:animate-[studio-clawd-step_0.5s_steps(1,end)_-0.25s_infinite]">
        <rect x={3.6} y={5} width={1} height={2} fill={BODY} />
        <rect x={7.6} y={5} width={1} height={2} fill={BODY} />
      </g>
    </svg>
  );
}
