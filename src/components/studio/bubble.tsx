"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { CARD, DiscardAsk } from "./panel";
import { PromptBox } from "./prompt-box";
import type { Fit } from "./stage";
import { useAttachments } from "./use-attachments";
import type { ChatState } from "./use-chat";
import { useOutsideClose } from "./use-outside";
import { chipLabel, type Pinned } from "./words";

// The inline prompt: a small bubble right where you pointed on the film,
// so "make this bigger" means exactly this. ⌘K opens it in the middle of
// the film without a pick. A press outside it or Esc closes it, asking
// first when there's an unsent prompt or file.

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
  pointing,
  onClose,
  onSent,
}: {
  filmId: string;
  fit: Fit;
  pinned: Pinned | null;
  time: () => number;
  chat: ChatState;
  pointing: boolean; // Point is picking on the film, so presses there aren't "outside"
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

  // Closing would lose an unsent prompt or file, so it asks once first.
  const [asking, setAsking] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const dirty = Boolean(draft.trim()) || files.items.length > 0;
  const keep = () => {
    setAsking(false);
    input.current?.focus();
  };

  // A press outside closes it, or asks; a second one while asking discards.
  const outside = useOutsideClose(box, () => (dirty && !asking ? setAsking(true) : onClose()), {
    ignore: (target) => pointing && Boolean(target.closest("[data-film-stage]")),
  });

  // Esc closes it, or asks; Esc while asking goes back to the prompt. Heard
  // before the studio's own Esc, which would close it without asking.
  const latest = useRef({ asking, dirty, onClose });
  useEffect(() => {
    latest.current = { asking, dirty, onClose };
  });
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      const now = latest.current;
      if (now.asking) {
        setAsking(false);
        input.current?.focus();
      } else if (now.dirty) setAsking(true);
      else now.onClose();
    };
    window.addEventListener("keydown", keys, true);
    return () => window.removeEventListener("keydown", keys, true);
  }, []);

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
      ref={box}
      role="dialog"
      aria-label="Ask Claude about this"
      {...outside}
      className={cn(CARD, "pointer-events-auto absolute z-30 flex flex-col gap-1.5 p-1.5 motion-safe:animate-[bubble-in_180ms_cubic-bezier(0.23,1,0.32,1)]")}
      style={{ left, top, width: W, transformOrigin: "top center" }}
    >
      <PromptBox
        inputRef={input}
        value={draft}
        onChange={setDraft}
        onSend={() => void send()}
        attachments={files}
        running={chat.turn.running}
        queueing
        autoFocus
        maxRows={4}
        placeholder={pinned ? "Make this bigger and bring it in later" : "Describe a change to the film"}
        chip={chipLabel(pinned?.pick ?? null, pinned?.t ?? time())}
        className="bg-transparent has-[:focus-visible]:bg-transparent has-[:focus-visible]:ring-0"
      />
      {asking ? <DiscardAsk what="this prompt" onKeep={keep} onDiscard={onClose} /> : null}
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
