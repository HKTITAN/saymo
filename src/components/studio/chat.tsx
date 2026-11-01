"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import { type Clock, formatTime, useClock } from "./clock";
import { MultipleCrossCancelIcon } from "@/components/icons";
import { Skeleton } from "@/components/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { ChatMessage } from "@/lib/studio/contract";
import { cn } from "@/lib/utils";
import { Hint, PILL_BUTTON, Panel } from "./panel";
import { PromptBox } from "./prompt-box";
import { SentFiles } from "./sent-files";
import { useAttachments } from "./use-attachments";
import type { ChatState } from "./use-chat";
import { VersionsButton } from "./versions";
import { chipLabel, type Pinned } from "./words";

// The chat with Claude, on the left. It grows to full height while Claude
// works and settles back when the turn ends.

const IDEAS = ["Make it loop smoothly", "Slow the opening down", "Add a title that types in"];

// What the loading shapes are measured from.
const SAMPLE: ChatMessage[] = [
  { role: "you", text: "Make the title come in from the left", at: "" },
  { role: "claude", text: "The title now slides in from the left over half a second, then settles.", at: "" },
];

export function ChatPanel({
  filmId,
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
  filmId: string;
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

  // The chat sits at its newest message: when a film opens, when a prompt
  // is sent, and as replies, pictures and the queue grow, unless you've
  // scrolled up to read something (then it stays put until you come back
  // down or send).
  const stuck = useRef(true);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const toEnd = () => {
      if (stuck.current) el.scrollTop = el.scrollHeight;
    };
    const onScroll = () => {
      stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    };
    const sizes = new ResizeObserver(toEnd);
    const watch = () => {
      sizes.disconnect();
      sizes.observe(el);
      for (const child of el.children) sizes.observe(child);
    };
    const changes = new MutationObserver(() => {
      watch();
      toEnd();
    });
    el.addEventListener("scroll", onScroll, { passive: true });
    changes.observe(el, { childList: true, subtree: true, characterData: true });
    watch();
    toEnd();
    return () => {
      el.removeEventListener("scroll", onScroll);
      sizes.disconnect();
      changes.disconnect();
    };
  }, []);
  const lastRole = messages.at(-1)?.role;
  useEffect(() => {
    // A film just opened, or you just sent a prompt: back to the end.
    stuck.current = true;
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [filmId, chat.loaded, messages.length, lastRole, chat.queue.length]);

  const files = useAttachments(`/api/studio/films/${filmId}/attachments`);

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
        <>
          {messages.length > 0 ? (
            <VersionsButton
              filmId={filmId}
              busy={turn.running || chat.undoing}
              time={() => pinned?.t ?? time()}
              onRestore={chat.restore}
            />
          ) : null}
          {claudeTurns > 0 ? (
            <Hint label="Undo Claude’s last change. ⌘Z undoes your changes too, in order" keys={["⌘", "Z"]}>
              <button
                type="button"
                className={cn(PILL_BUTTON, "h-7 px-2.5 text-white/60 hover:bg-white/[0.08] hover:text-white")}
                onClick={undo}
                disabled={turn.running || chat.undoing || chat.restoring}
              >
                {chat.undoing ? <Spinner className="size-3" /> : null}
                Undo
              </button>
            </Hint>
          ) : null}
        </>
      }
    >
      <div ref={list} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-3">
        {!chat.loaded ? (
          // The chat so far is on its way: two messages' worth of shapes.
          <Skeleton loading label="Loading the chat">
            <div className="flex flex-col gap-3 pt-1">
              <Message message={SAMPLE[0]} filmId={filmId} />
              <Message message={SAMPLE[1]} filmId={filmId} />
            </div>
          </Skeleton>
        ) : messages.length === 0 && !turn.running ? (
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
          <Message key={`${m.at}-${i}`} message={m} filmId={filmId} />
        ))}
        {turn.running ? <Live text={turn.text} steps={turn.steps} resumed={turn.resumed} /> : null}
        {turn.error ? <p className="text-[12.5px] text-[#ff9592] leading-relaxed">{turn.error}</p> : null}
        {chat.queue.length ? (
          <Queue
            queue={chat.queue}
            paused={chat.paused && !turn.running}
            onRemove={chat.removeQueued}
            onClear={chat.clearQueue}
            onResume={chat.resume}
          />
        ) : null}
        {undoError ? <p className="text-[12.5px] text-[#ff9592] leading-relaxed">{undoError}</p> : null}
      </div>
      <div className="shrink-0 px-2 pb-2">
        <PromptBox
          inputRef={inputRef}
          value={draft}
          onChange={setDraft}
          onSend={() => void send()}
          attachments={files}
          onStop={chat.stop}
          running={turn.running}
          queueing
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

function Message({ message, filmId }: { message: ChatMessage; filmId: string }) {
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
        <SentFiles files={message.context?.attachments ?? []} urlOf={(path) => `/studio/stage/${filmId}/${path}`} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5 pe-4">
      {message.text ? (
        <p className="whitespace-pre-wrap text-[12.5px] text-white/80 leading-relaxed">
          <Rich text={message.text} />
        </p>
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
      {text ? (
        <p className="whitespace-pre-wrap text-[12.5px] text-white/80 leading-relaxed">
          <Rich text={text} />
        </p>
      ) : null}
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

// Prompts waiting their turn, in order, each with the moment it was sent
// from. Each can be taken back; Stop pauses them until you carry on.
function Queue({
  queue,
  paused,
  onRemove,
  onClear,
  onResume,
}: {
  queue: ChatState["queue"];
  paused: boolean;
  onRemove: (key: string) => void;
  onClear: () => void;
  onResume: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 ps-8" aria-label="Waiting prompts">
      <p className="flex items-center gap-2 self-end text-[11px] text-white/40">
        {paused ? "Paused" : queue.length === 1 ? "Next up" : `${queue.length} waiting`}
        {paused ? (
          <button type="button" onClick={onResume} className="cursor-pointer rounded-[5px] px-1 text-white/70 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-ring">
            Carry on
          </button>
        ) : null}
        <button type="button" onClick={onClear} className="cursor-pointer rounded-[5px] px-1 text-white/55 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-ring">
          Clear
        </button>
      </p>
      {queue.map((q, i) => (
        <div key={q.key} className="group/q flex items-start justify-end gap-1.5">
          <span className="pt-2 font-mono text-[10.5px] text-white/30 tabular-nums">{i + 1}</span>
          <p className="whitespace-pre-wrap rounded-[12px] rounded-br-[4px] border border-white/[0.1] border-dashed px-3 py-2 text-[12.5px] text-white/55 leading-relaxed">
            {q.prompt}
            {q.context.attachments?.length ? (
              <span className="mt-1 block text-[11px] text-white/35">
                {q.context.attachments.length === 1 ? "With 1 file" : `With ${q.context.attachments.length} files`}
              </span>
            ) : null}
          </p>
          <button
            type="button"
            onClick={() => onRemove(q.key)}
            aria-label={`Remove waiting prompt ${i + 1}`}
            className="mt-1.5 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-[7px] text-white/35 opacity-0 outline-none transition-opacity hover:bg-white/[0.08] hover:text-white focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/q:opacity-100 [&_svg]:size-3.5"
          >
            <MultipleCrossCancelIcon aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

// Claude is asked for plain sentences, but when a reply carries **bold** or
// `code` anyway, it shows as such instead of as raw marks.
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
          <strong key={i} className="font-semibold text-white/90">
            {part.slice(2, -2)}
          </strong>
        ) : part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
          <code key={i} className="rounded-[4px] bg-white/[0.06] px-1 font-mono text-[0.92em]">
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}
