import { cn } from "@/lib/utils";

// Claude's pixel mascot, for the folded Claude pill, drawn from the real
// mascot's rectangles (body, two arms low at the sides, four legs, happy
// ^ eyes, #DD775B). Idle, it glances left and right now and then. While a
// turn runs it walks on the spot, its arms working, and a playhead slides
// along a little clip beside it. Pixels stay crisp; it holds still for
// anyone who asks for less motion.

const BODY = "#DD775B";

function Eye({ x }: { x: number }) {
  return (
    <>
      <rect x={x + 6} y={71} width={10} height={6} fill="#000" />
      <rect x={x} y={77} width={6} height={6} fill="#000" />
      <rect x={x + 16} y={77} width={6} height={6} fill="#000" />
    </>
  );
}

export function ClaudeAtWork({ working = true, className }: { working?: boolean; className?: string }) {
  const when = (a: string) => (working ? a : "");
  return (
    <svg
      viewBox={working ? "0 52 236 96" : "0 52 128 96"}
      shapeRendering="crispEdges"
      aria-hidden="true"
      className={cn("h-[18px] shrink-0 overflow-visible", working ? "w-[44px]" : "w-6", className)}
    >
      {working ? (
        <>
          {/* The clip being edited, and its playhead. */}
          <rect x={144} y={106} width={88} height={22} rx={5} fill="rgb(255 255 255 / 0.18)" />
          <rect x={144} y={106} width={30} height={22} rx={5} fill="rgb(255 255 255 / 0.32)" />
          <g className="motion-safe:animate-[studio-clawd-scrub_1.8s_linear_infinite]">
            <rect x={148} y={94} width={5} height={46} fill="#f2f2f2" />
          </g>
        </>
      ) : null}
      {/* Legs: two pairs that step in turn. */}
      <g className={when("motion-safe:animate-[studio-clawd-step_0.5s_steps(1,end)_infinite]")}>
        <rect x={21.66} y={126} width={11} height={20} fill={BODY} />
        <rect x={74} y={126} width={11} height={20} fill={BODY} />
      </g>
      <g className={when("motion-safe:animate-[studio-clawd-step_0.5s_steps(1,end)_-0.25s_infinite]")}>
        <rect x={42} y={126} width={11} height={20} fill={BODY} />
        <rect x={94.34} y={126} width={11} height={20} fill={BODY} />
      </g>
      {/* Body, arms and eyes move together. */}
      <g className={when("motion-safe:animate-[studio-clawd-bob_0.5s_steps(1,end)_infinite]")}>
        <rect x={21.66} y={62} width={83.68} height={64} fill={BODY} />
        <g className={when("motion-safe:animate-[studio-clawd-arm_0.5s_steps(1,end)_infinite]")}>
          <rect x={0} y={90} width={22} height={23} fill={BODY} />
        </g>
        <g className={when("motion-safe:animate-[studio-clawd-arm_0.5s_steps(1,end)_-0.25s_infinite]")}>
          <rect x={105} y={90} width={22} height={23} fill={BODY} />
        </g>
        <g className={working ? "" : "motion-safe:animate-[studio-clawd-look_6s_steps(1,end)_infinite]"}>
          <Eye x={27} />
          <Eye x={78} />
        </g>
      </g>
    </svg>
  );
}
