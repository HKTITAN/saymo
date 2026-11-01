"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import { type Clock, formatTime, useClock } from "./clock";
import { Spinner } from "@/components/ui/spinner";
import type { ChatMessage } from "@/lib/studio/contract";
import { cn } from "@/lib/utils";
import { Hint, PILL_BUTTON, Panel } from "./panel";
import { PromptBox } from "./prompt-box";
import type { ChatState } from "./use-chat";
import { chipLabel, type Pinned } from "./words";

// The chat with Claude, on the left. It grows to full height while Claude
// works and settles back when the turn ends.

const IDEAS = ["Make it loop smoothly", "Slow the opening down", "Add a title that types in"];

export function ChatPanel({
  chat,
  pinned,
  time,
  clock,
  onClearPick,
  pointing,
  onPoint,
  folded,
  onFold,
  hidden,
  inputRef,
  style,
}: {
  chat: ChatState;
  pinned: Pinned | null;
  time: () => number;
  clock: Clock;
  onClearPick: () => void;
  pointing: boolean;
  onPoint: () => void;
  folded: boolean;
  onFold: (folded: boolean) => void;
  hidden: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  style?: React.CSSProperties;
}) {
  const [draft, setDraft] = useState("");
  const [undoError, setUndoError] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const { messages, turn } = chat;
  const claudeTurns = messages.filter((m) => m.role === "claude").length;

  // Keep the newest words in view.
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, turn.text, turn.steps.length]);

  const send = () => {
    const words = draft;
    setDraft("");
    void chat.send(words, { t: pinned?.t ?? time(), pick: pinned?.pick ?? null });
    onClearPick();
  };

  const undo = async () => {
    setUndoError(null);
    setUndoError(await chat.undo());
  };

  return (
    <Panel
      title="Claude"
      folded={folded}
      onFold={onFold}
      hidden={hidden}
      className={cn(
        "top-[68px] left-4 w-[340px] transition-[height,opacity,translate,scale,filter] [interpolate-size:allow-keywords]",
        turn.running ? "h-[calc(100dvh-84px)]" : "h-auto max-h-[calc(100dvh-84px)]",
      )}
      pillClassName="top-[68px] left-4"
      style={style}
      bodyClassName="flex flex-col"
      actions={
        claudeTurns > 0 ? (
          <Hint label="Undo Claude’s last change. ⌘Z undoes your changes too, in order" keys={["⌘", "Z"]}>
            <button
              type="button"
              className={cn(PILL_BUTTON, "h-7 px-2.5 text-white/60 hover:bg-white/[0.08] hover:text-white")}
              onClick={undo}
              disabled={turn.running || chat.undoing}
            >
              {chat.undoing ? <Spinner className="size-3" /> : null}
              Undo
            </button>
          </Hint>
        ) : null
      }
    >
      <div ref={list} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-3">
        {messages.length === 0 && !turn.running ? (
          <div className="flex flex-col gap-2 pt-1 pb-1">
            <p className="text-[12.5px] text-white/55 leading-relaxed">
              Tell Claude what to change, or point at a part of the film to change just that.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {IDEAS.map((idea) => (
                <button
                  key={idea}
                  type="button"
                  onClick={() => {
                    setDraft(idea);
                    inputRef.current?.focus();
                  }}
                  className="h-7 cursor-pointer rounded-[8px] bg-white/[0.05] px-2.5 text-[12px] text-white/65 outline-none transition-colors hover:bg-white/[0.09] hover:text-white focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {idea}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {messages.map((m, i) => (
          <Message key={`${m.at}-${i}`} message={m} />
        ))}
        {turn.running ? <Live text={turn.text} steps={turn.steps} resumed={turn.resumed} /> : null}
        {turn.error ? <p className="text-[12.5px] text-[#ff9592] leading-relaxed">{turn.error}</p> : null}
        {undoError ? <p className="text-[12.5px] text-[#ff9592] leading-relaxed">{undoError}</p> : null}
      </div>
      <div className="shrink-0 px-2 pb-2">
        <PromptBox
          inputRef={inputRef}
          value={draft}
          onChange={setDraft}
          onSend={send}
          onStop={chat.stop}
          running={turn.running}
          placeholder="Make the title come in from the left"
          chip={pinned ? chipLabel(pinned.pick, pinned.t) : null}
          onClearChip={onClearPick}
          meta={<PlayheadChip clock={clock} />}
          tools={
            <Hint label={pointing ? "Stop pointing" : "Point at the film"} keys={["P"]}>
              <button
                type="button"
                onClick={onPoint}
                aria-pressed={pointing}
                className={cn(
                  PILL_BUTTON,
                  "h-7 px-2.5",
                  pointing ? "bg-[#F55A00] text-white hover:bg-[#ff6a14]" : "text-white/60 hover:bg-white/[0.08] hover:text-white",
                )}
              >
                Point
              </button>
            </Hint>
          }
        />
      </div>
    </Panel>
  );
}

function Message({ message }: { message: ChatMessage }) {
  if (message.role === "you") {
    return (
      <div className="flex flex-col items-end gap-1 ps-8">
        {message.context?.pick ? (
          <span className="rounded-[6px] bg-[#F55A00]/12 px-1.5 py-0.5 text-[11px] text-[#ff9a5c]/90">
            {chipLabel(message.context.pick, message.context.t)}
          </span>
        ) : message.context ? (
          <span className="rounded-[6px] bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-white/45 tabular-nums">
            At {formatTime(message.context.t)}
          </span>
        ) : null}
        <p className="whitespace-pre-wrap rounded-[12px] rounded-br-[4px] bg-white/[0.09] px-3 py-2 text-[12.5px] text-white/90 leading-relaxed">
          {message.text}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5 pe-4">
      {message.text ? (
        <p className="whitespace-pre-wrap text-[12.5px] text-white/80 leading-relaxed">{message.text}</p>
      ) : null}
    </div>
  );
}

function Live({ text, steps, resumed }: { text: string; steps: string[]; resumed: boolean }) {
  // One line that shimmers and changes in place as Claude moves from step
  // to step, so the chat doesn't fill up with a list of steps.
  const step = steps.at(-1) ?? (resumed ? "Still working on your last request" : "Reading the film");
  return (
    <div className="flex flex-col gap-1.5 pe-4" aria-live="polite">
      <p className="h-4 overflow-hidden text-[11.5px]">
        <span
          key={`${steps.length}-${step}`}
          className="studio-shimmer block animate-in fade-in slide-in-from-bottom-1 duration-200"
        >
          {step}
        </span>
      </p>
      {text ? <p className="whitespace-pre-wrap text-[12.5px] text-white/80 leading-relaxed">{text}</p> : null}
    </div>
  );
}

// Where the playhead is, sent with every prompt so "here" and "now" mean
// that exact moment. It follows the playhead on its own, so the rest of the
// chat doesn't redraw while the film plays.
function PlayheadChip({ clock }: { clock: Clock }) {
  const t = useClock(clock, (s) => Math.round(s.t * 100) / 100);
  return (
    <span className="flex h-6 items-center gap-1.5 self-start rounded-[7px] bg-white/[0.06] px-2 text-[11.5px] text-white/50">
      At
      <span className="font-mono text-white/75 tabular-nums">{formatTime(t)}</span>
    </span>
  );
}
