"use client";

import { useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { CARD } from "./panel";
import { PromptBox } from "./prompt-box";
import type { Fit } from "./stage";
import { useAttachments } from "./use-attachments";
import type { ChatState } from "./use-chat";
import { chipLabel, type Pinned } from "./words";

// The inline prompt: a small bubble right where you pointed on the film,
// so "make this bigger" means exactly this. ⌘K opens it in the middle of
// the film without a pick.

const W = 320;

const subscribe = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};
const viewport = () => `${window.innerWidth}x${window.innerHeight}`;

export function Bubble({
  filmId,
  fit,
  pinned,
  time,
  chat,
  onClose,
  onSent,
}: {
  filmId: string;
  fit: Fit;
  pinned: Pinned | null;
  time: () => number;
  chat: ChatState;
  onClose: () => void;
  onSent: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [vw, vh] = useSyncExternalStore(subscribe, viewport, () => "1440x900")
    .split("x")
    .map(Number);

  // Under what was picked (or at the click), kept inside the window.
  const pick = pinned?.pick;
  const anchor = pick?.rect
    ? { x: pick.rect.x + pick.rect.width / 2, y: pick.rect.y + pick.rect.height }
    : pick
      ? { x: pick.x, y: pick.y }
      : null;
  let left = anchor ? fit.x + anchor.x * fit.scale - W / 2 : fit.x + fit.width / 2 - W / 2;
  let top = anchor ? fit.y + anchor.y * fit.scale + 12 : fit.y + fit.height / 2 - 60;
  left = Math.min(Math.max(16, left), vw - W - 16);
  // Not enough room below: sit above the pick instead.
  if (top > vh - 150 && pick) {
    const above = pick.rect ? pick.rect.y : pick.y;
    top = fit.y + above * fit.scale - 140;
  }
  top = Math.min(Math.max(16, top), vh - 150);

  const files = useAttachments(`/api/studio/films/${filmId}/attachments`, { audio: true });

  const send = async () => {
    const attached = await files.flush();
    const words = draft.trim() || (attached.length ? "Have a look at what I attached." : "");
    if (!words) return;
    setDraft("");
    files.clear();
    void chat.send(words, {
      t: pinned?.t ?? time(),
      pick: pinned?.pick ?? null,
      ...(attached.length ? { attachments: attached } : {}),
    });
    onSent();
  };

  return (
    <div
      role="dialog"
      aria-label="Ask Claude about this"
      className={cn(CARD, "pointer-events-auto absolute z-30 p-1.5 motion-safe:animate-[bubble-in_180ms_cubic-bezier(0.23,1,0.32,1)]")}
      style={{ left, top, width: W, transformOrigin: "top center" }}
    >
      <PromptBox
        value={draft}
        onChange={setDraft}
        onSend={() => void send()}
        attachments={files}
        running={chat.turn.running}
        queueing
        autoFocus
        onEscape={onClose}
        maxRows={4}
        placeholder={pinned ? "Make this bigger and bring it in later" : "Describe a change to the film"}
        chip={chipLabel(pinned?.pick ?? null, pinned?.t ?? time())}
        className="bg-transparent has-[:focus-visible]:bg-transparent has-[:focus-visible]:ring-0"
      />
      <style>{`@keyframes bubble-in { from { opacity: 0; transform: translateY(-4px) scale(0.97); } }`}</style>
    </div>
  );
}

// The outline drawn round what was picked, in the film's own place.
export function PickOutline({ fit, pinned }: { fit: Fit; pinned: Pinned }) {
  const { pick } = pinned;
  if (pick.rect) {
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none absolute z-20 rounded-[3px] outline-[1.5px] outline-[#F55A00] outline-solid outline-offset-2 transition-[left,top,width,height] duration-200"
        style={{
          left: fit.x + pick.rect.x * fit.scale,
          top: fit.y + pick.rect.y * fit.scale,
          width: pick.rect.width * fit.scale,
          height: pick.rect.height * fit.scale,
        }}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-20 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#F55A00] ring-4 ring-[#F55A00]/25"
      style={{ left: fit.x + pick.x * fit.scale, top: fit.y + pick.y * fit.scale }}
    />
  );
}
