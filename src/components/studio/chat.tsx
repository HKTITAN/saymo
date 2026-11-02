"use client";

import { type RefObject, useCallback, useEffect, useId, useRef, useState } from "react";
import { type Clock, formatTime, useClock } from "./clock";
import { MultipleCrossCancelIcon } from "@/components/icons";
import { Skeleton } from "@/components/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { ChatMessage } from "@/lib/studio/contract";
import { cn } from "@/lib/utils";
import { Hint, PILL_BUTTON, Panel } from "./panel";
import { PromptBox } from "./prompt-box";
import { SentFiles } from "./sent-files";
import { ClaudeAtWork } from "./mascot";
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

  // The chat opens at your most recent prompt, and goes back to it when you
  // send one: the prompt sits at the top with Claude's reply growing under
  // it, or the chat's end shows if that's nearer. Scroll up to read, and it
  // stays put until you come back down or send again.
  const stuck = useRef(true);
  const toLatest = useCallback(() => {
    const el = list.current;
    if (!el || !stuck.current) return;
    const end = el.scrollHeight - el.clientHeight;
    const prompts = el.querySelectorAll<HTMLElement>('[data-chat-role="you"]');
    const last = prompts[prompts.length - 1];
    const top = last ? last.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 12 : end;
    el.scrollTop = Math.max(0, Math.min(end, top));
  }, []);
  const watching = useRef<(() => void) | null>(null);
  const listRef = useCallback(
    (el: HTMLDivElement | null) => {
      list.current = el;
      watching.current?.();
      watching.current = null;
      if (!el) return;
      // Only your own scrolling unsticks it; reaching the end sticks it again.
      const onWheel = (e: WheelEvent) => {
        if (e.deltaY < 0) stuck.current = false;
      };
      const onTouch = () => {
        stuck.current = false;
      };
      const onScroll = () => {
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 24) stuck.current = true;
      };
      const sizes = new ResizeObserver(toLatest);
      const watch = () => {
        sizes.disconnect();
        sizes.observe(el);
        for (const child of el.children) sizes.observe(child);
      };
      const changes = new MutationObserver(() => {
        watch();
        toLatest();
      });
      el.addEventListener("wheel", onWheel, { passive: true });
      el.addEventListener("touchmove", onTouch, { passive: true });
      el.addEventListener("scroll", onScroll, { passive: true });
      changes.observe(el, { childList: true, subtree: true, characterData: true });
      watch();
      toLatest();
      watching.current = () => {
        el.removeEventListener("wheel", onWheel);
        el.removeEventListener("touchmove", onTouch);
        el.removeEventListener("scroll", onScroll);
        sizes.disconnect();
        changes.disconnect();
      };
    },
    [toLatest],
  );
  const lastRole = messages.at(-1)?.role;
  useEffect(() => {
    // A film just opened, or you just sent a prompt: back to it.
    stuck.current = true;
    toLatest();
  }, [filmId, chat.loaded, messages.length, lastRole, chat.queue.length, toLatest]);

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
        "top-[68px] left-4 w-[320px] transition-[height,opacity,translate,scale,filter] [interpolate-size:allow-keywords]",
        turn.running ? "h-[calc(100dvh-84px)]" : "h-auto max-h-[calc(100dvh-84px)]",
      )}
      pillClassName="top-[68px] left-4"
      pillMark={turn.running ? <ClaudeAtWork /> : undefined}
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
      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-3">
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
      <div data-chat-role="you" className="flex flex-col items-end gap-1 ps-8">
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

// Aerchain's ai mark while Claude works: the dot hops and a light sweep
// runs across the swoosh, in time with the shimmering line beside it.
const SWOOSH =
  "M172.309 19.9259C172.411 14.5877 170.209 8.11491 164.449 11.7919C163.965 11.9834 163.689 11.9158 163.434 11.5498C162.707 10.2096 162.149 8.83849 161.458 7.43075C156.259 -6.19338 150.322 1.59707 144.051 9.66061C130.046 28.102 136.644 36.2697 158.719 20.0751C159.49 19.5176 161.035 18.352 161.591 18.3041C162.177 18.2084 162.42 18.6927 162.862 19.7063C163.291 20.7452 164.004 22.2177 164.656 23.2678C168.423 30.7148 172.597 28.9889 172.312 19.9568V19.9259H172.309ZM155.709 17.1498C152.931 18.9179 150.295 21.083 147.243 22.3753C145.914 22.9412 143.976 22.3162 143.498 21.221C142.956 19.5232 144.894 17.0203 145.845 15.2578C146.948 13.2504 148.41 11.4653 149.811 9.64653C151.171 7.85307 153.017 5.19244 155.576 6.35523C157.63 7.54337 158.473 10.829 159.648 12.8111C160.178 13.6699 160.162 14.278 159.233 14.7961C158.108 15.5253 156.889 16.3558 155.731 17.1385L155.709 17.1526V17.1498ZM170.761 20.6663C170.701 21.6884 170.51 25.554 169.23 23.7127C168.042 21.4378 166.737 18.6026 165.574 16.1785C165.12 14.9396 167.948 14.4385 168.683 14.6496C170.737 15.4211 170.808 18.7208 170.761 20.6494V20.6692V20.6663Z";
function WorkingMark() {
  const id = useId();
  return (
    <svg viewBox="128 -4 46 34" aria-hidden="true" className="h-[13px] w-[18px] shrink-0 overflow-visible">
      <defs>
        <clipPath id={`${id}-swoosh`}>
          <path d={SWOOSH} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-swoosh)`}>
        <rect x={128} y={-4} width={46} height={34} fill="#F55A00" />
        <rect
          x={110}
          y={-4}
          width={12}
          height={34}
          fill="#ffd2b8"
          opacity={0.75}
          className="motion-safe:animate-[studio-mark-sweep_1.6s_ease-in-out_infinite]"
        />
      </g>
      <circle
        cx={169.4}
        cy={6.1}
        r={2.4}
        fill="#F55A00"
        className="[transform-box:fill-box] [transform-origin:50%_100%] motion-safe:animate-[studio-mark-hop_0.8s_ease-in-out_infinite]"
      />
    </svg>
  );
}

function Live({ text, steps, resumed }: { text: string; steps: string[]; resumed: boolean }) {
  // One line that shimmers and changes in place as Claude moves from step
  // to step, so the chat doesn't fill up with a list of steps.
  const step = steps.at(-1) ?? (resumed ? "Still working on your last request" : "Reading the film");
  return (
    <div className="flex flex-col gap-1.5 pe-4" aria-live="polite">
      <p className="flex h-4 items-center gap-2 overflow-hidden text-[11.5px]">
        <WorkingMark />
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
