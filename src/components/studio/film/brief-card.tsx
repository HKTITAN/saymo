"use client";

import type { Brief, BriefCall } from "@/lib/studio/agent/brief";
import { cn } from "@/lib/utils";
import { CARD, PILL_BUTTON } from "../ui/panel";
import { SlideMark, useSlide } from "../ui/slide-mark";

// The blank-page brief on the empty stage, before the film is made: the
// look, its references (stills and moving), the beats, and the creative
// calls, each one flippable to its alternative. Make it builds the film
// from the brief; Another look asks for a different direction.

const moving = (file: string) => /\.(mp4|webm|mov|m4v)$/i.test(file);

export function BriefCard({
  id,
  brief,
  busy,
  onChange,
  onMake,
  onAnother,
}: {
  id: string;
  brief: Brief;
  busy: boolean;
  onChange: (next: Brief) => void;
  onMake: () => void;
  onAnother: () => void;
}) {
  const src = (file: string) => `/studio/stage/${id}/${file.split("/").map(encodeURIComponent).join("/")}`;
  // Stills first, then the moves, as the skill finds them; 3D models stay out.
  const refs = brief.refs.filter((r) => r.kind !== "asset");
  return (
    <section
      aria-labelledby="brief-look"
      className={cn(CARD, "flex max-h-full w-full max-w-[640px] flex-col gap-4 overflow-y-auto p-5 [scrollbar-width:none] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300")}
    >
      <header className="flex flex-col gap-1">
        <p className="text-[11.5px] text-white/40">Brief</p>
        <h2 id="brief-look" className="text-balance font-medium text-[17px] text-white/95 first-letter:uppercase">
          {brief.look}
        </h2>
      </header>

      {refs.length ? (
        <ul aria-label="References" className="grid grid-cols-4 gap-2 min-[560px]:grid-cols-8">
          {refs.map((r) => (
            <li key={r.file} className="flex min-w-0 flex-col gap-1">
              <span className="relative block aspect-square overflow-hidden rounded-[8px] bg-white/[0.06]" title={r.use || undefined}>
                {moving(r.file) ? (
                  <video src={src(r.file)} autoPlay muted loop playsInline aria-hidden="true" className="absolute inset-0 size-full object-cover" />
                ) : (
                  <span aria-hidden="true" className="absolute inset-0 bg-center bg-cover" style={{ backgroundImage: `url("${src(r.file)}")` }} />
                )}
              </span>
              <span className="truncate text-[10.5px] text-white/45 first-letter:uppercase">{r.role || (r.kind === "motion" ? "Move" : "Look")}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <ol aria-label="Beats" className="flex flex-col gap-1.5">
        {brief.beats.map((beat, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: beats are numbered by their place
          <li key={i} className="flex gap-2.5 text-[12.5px] text-white/80 leading-relaxed">
            <span className="w-3 shrink-0 text-white/35 tabular-nums">{i + 1}</span>
            <span className="text-pretty">{beat.replace(/^\d+[.)]\s*/, "")}</span>
          </li>
        ))}
      </ol>

      {brief.calls.length ? (
        <div className="flex flex-col gap-1.5">
          {brief.calls.map((call, i) => (
            <Swap
              // biome-ignore lint/suspicious/noArrayIndexKey: up to three calls, in a fixed order
              key={i}
              call={call}
              disabled={busy}
              onSwap={(swapped) => onChange({ ...brief, calls: brief.calls.map((c, j) => (j === i ? { ...c, swapped } : c)) })}
            />
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="button" disabled={busy} onClick={onMake} className={cn(PILL_BUTTON, "bg-studio text-[#1f0612] hover:bg-studio-hover")}>
          Make it
        </button>
        <button type="button" disabled={busy} onClick={onAnother} className={cn(PILL_BUTTON, "bg-white/[0.08] text-white/85 hover:bg-white/[0.12]")}>
          Another look
        </button>
      </div>
    </section>
  );
}

// One creative call: the one made, or its alternative, the highlight
// sliding between them.
function Swap({ call, disabled, onSwap }: { call: BriefCall; disabled: boolean; onSwap: (swapped: boolean) => void }) {
  const slide = useSlide(call.swapped ? 1 : 0);
  return (
    <div className="relative grid grid-cols-2 gap-0.5 rounded-[10px] bg-white/[0.05] p-0.5" role="radiogroup" aria-label={`${call.choice} or ${call.alternative}`}>
      <SlideMark mark={slide.mark} className="rounded-[8px] bg-white/[0.13]" />
      {[call.choice, call.alternative].map((label, i) => {
        const on = (i === 1) === Boolean(call.swapped);
        return (
          <button
            key={label}
            ref={slide.ref(i)}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onSwap(i === 1)}
            className={cn(
              "relative min-h-8 cursor-pointer rounded-[8px] px-2.5 py-1.5 text-left text-[12px] leading-snug outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
              on ? cn("text-white", !slide.mark && "bg-white/[0.13]") : "text-white/45 hover:text-white/75",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
