"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { HudFrame, type HudShape } from "./hud-frame";
import { PromptBox } from "./prompt-box";
import { useAttachments } from "./use-attachments";

// A bench for the prompt box cut like hardware (hud-frame.tsx): two shapes,
// each at rest and while Claude works. Development only, at /dev/prompt-hud.

const TAB: HudShape = {
  cut: { tl: 6, tr: 12, br: 20, bl: 8 },
  tab: { width: 132, height: 22 },
  notches: [{ edge: "bottom", at: 0.5, width: 40, depth: 4 }],
  ticks: "tr",
};
const NOTCHED: HudShape = {
  cut: { tl: 16, tr: 6, br: 16, bl: 6 },
  notches: [
    { edge: "top", at: 0.34, width: 52, depth: 4 },
    { edge: "top", at: 0.6, width: 20, depth: 4 },
  ],
  ticks: "bl",
};

// The send button cut to match: an octagon instead of a rounded square,
// white instead of the pink accent (the owner wants no pink here).
const NEUTRAL_SEND = ["Send_to_Claude", "Add_to_the_queue"]
  .map(
    (l) =>
      `[&_button[aria-label='${l}']]:bg-white [&_button[aria-label='${l}']]:text-[#141414] [&_button[aria-label='${l}']:hover]:bg-white/90 [&_button[aria-label='${l}']:disabled]:bg-white/15 [&_button[aria-label='${l}']:disabled]:text-white/40`,
  )
  .join(" ");
const CUT_SEND =
  "[&_button[aria-label='Send_to_Claude']]:rounded-none [&_button[aria-label='Send_to_Claude']]:[clip-path:polygon(6px_0,calc(100%-6px)_0,100%_6px,100%_calc(100%-6px),calc(100%-6px)_100%,6px_100%,0_calc(100%-6px),0_6px)] [&_button[aria-label='Add_to_the_queue']]:rounded-none [&_button[aria-label='Add_to_the_queue']]:[clip-path:polygon(6px_0,calc(100%-6px)_0,100%_6px,100%_calc(100%-6px),calc(100%-6px)_100%,6px_100%,0_calc(100%-6px),0_6px)]";

function Sample({ shape, working, tabbed }: { shape: HudShape; working: boolean; tabbed: boolean }) {
  const [draft, setDraft] = useState(working ? "Make the title come in from the left" : "");
  const attached = useAttachments(null);
  return (
    <div className={cn("w-[340px]", CUT_SEND, NEUTRAL_SEND)}>
      <HudFrame
        shape={shape}
        stroke={working ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.12)"}
        mark={working ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.22)"}
        label={
          <span className="flex items-center gap-1.5 text-[10.5px] text-white/55 uppercase tracking-[0.08em]">
            At <span className="text-white/85 tabular-nums">0:01.60</span>
          </span>
        }
      >
        <PromptBox
          value={draft}
          onChange={setDraft}
          onSend={() => {}}
          running={working}
          queueing={working}
          attachments={attached}
          chip={tabbed ? null : "At 0:01.60"}
          placeholder="Make the title come in from the left"
          maxRows={5}
          className="rounded-none bg-transparent p-2.5 has-[:focus-visible]:bg-transparent has-[:focus-visible]:ring-0"
          tools={
            <button type="button" className="inline-flex h-7 cursor-pointer items-center rounded-[7px] px-2 text-[12px] text-white/60 outline-none hover:bg-white/[0.07] hover:text-white">
              Point
            </button>
          }
        />
      </HudFrame>
    </div>
  );
}

export function PromptHudBench() {
  return (
    <main className="min-h-dvh bg-[#0b0b0b] p-12 font-sans text-white antialiased">
      <h1 className="mb-8 font-medium text-[15px] text-white/85">Prompt box, cut like hardware</h1>
      <div className="grid w-max grid-cols-2 gap-x-16 gap-y-14">
        {(
          [
            ["A. Tab: the time sits in a tab on top", TAB, true],
            ["B. Notched: two notches in the top edge", NOTCHED, false],
          ] as const
        ).map(([title, shape, tabbed]) => (
          <section key={title} className="contents">
            {[false, true].map((working) => (
              <div key={`${title}-${working}`} className="flex flex-col gap-3">
                <p className="text-[12px] text-white/45">
                  {title} · {working ? "while Claude works" : "at rest"}
                </p>
                <Sample shape={shape} working={working} tabbed={tabbed} />
              </div>
            ))}
          </section>
        ))}
        {[false, true].map((working) => (
          <div key={`panel-${working}`} className="flex flex-col gap-3">
            <p className="text-[12px] text-white/45">C. The whole chat panel as one shape · {working ? "while Claude works" : "at rest"}</p>
            <ChatPanel working={working} />
          </div>
        ))}
      </div>
    </main>
  );
}

// The chat panel itself cut as one shape: "Claude" in the tab, the
// suggestions, then the prompt at the foot, parted by a hairline. No box
// inside a box.
const PANEL: HudShape = {
  cut: { tl: 6, tr: 14, br: 22, bl: 8 },
  tab: { width: 112, height: 24 },
  notches: [{ edge: "bottom", at: 0.5, width: 40, depth: 4 }],
  ticks: "tr",
};

function ChatPanel({ working }: { working: boolean }) {
  const [draft, setDraft] = useState(working ? "Make the title come in from the left" : "");
  const attached = useAttachments(null);
  return (
    <div className={cn("w-[340px]", CUT_SEND, NEUTRAL_SEND)}>
      <HudFrame
        shape={PANEL}
        fill="#161616"
        stroke={working ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.12)"}
        mark={working ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.22)"}
        label={<span className="font-medium text-[11px] text-white/80 uppercase tracking-[0.08em]">Claude</span>}
      >
        <div className="flex flex-col gap-3 px-4 pt-4 pb-1">
          <p className="text-[12.5px] text-white/55 leading-relaxed">Tell Claude what to change, or point at a part of the film to change just that.</p>
          <div className="flex flex-col items-start gap-1.5">
            {["Make it loop smoothly", "Slow the opening down", "Add a title that types in"].map((t) => (
              <span key={t} className="rounded-[8px] bg-white/[0.06] px-2.5 py-1.5 text-[12px] text-white/75">
                {t}
              </span>
            ))}
          </div>
        </div>
        <div className="mx-3 mt-3 h-px bg-white/[0.07]" />
        <div className="flex items-center gap-2 px-4 pt-2.5 text-[10.5px] text-white/50 uppercase tracking-[0.08em]">
          At <span className="text-white/85 tabular-nums">0:01.60</span>
        </div>
        <PromptBox
          value={draft}
          onChange={setDraft}
          onSend={() => {}}
          running={working}
          queueing={working}
          attachments={attached}
          placeholder="Make the title come in from the left"
          maxRows={5}
          className="rounded-none bg-transparent px-2.5 pt-1 pb-3 has-[:focus-visible]:bg-transparent has-[:focus-visible]:ring-0"
          tools={
            <button type="button" className="inline-flex h-7 cursor-pointer items-center rounded-[7px] px-2 text-[12px] text-white/60 outline-none hover:bg-white/[0.07] hover:text-white">
              Point
            </button>
          }
        />
      </HudFrame>
    </div>
  );
}
