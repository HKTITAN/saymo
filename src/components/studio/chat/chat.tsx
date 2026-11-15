"use client";

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { type Clock, formatTime, useClock } from "../film/clock";
import { MultipleCrossCancelIcon, PencilEditIcon } from "@/components/icons";
import { Skeleton } from "@/components/skeleton";
import type { ChatContext, ChatMessage } from "@/lib/studio/films/contract";
import { asksForThree } from "@/lib/studio/films/takes-shared";
import { cn } from "@/lib/utils";
import { Hint, PILL_BUTTON, Panel } from "../ui/panel";
import { PromptBox } from "./prompt-box";
import { SentFiles } from "./sent-files";
import { ClaudeAtWork } from "../ui/mascot";
import { EffectsMenu } from "../film/effects";
import { useAttachments } from "./use-attachments";
import type { ChatState } from "./use-chat";
import { VersionsButton } from "../film/versions";
import { chipLabel, type Pinned, type SoundPin, soundChipLabel } from "../film/words";

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
  sound,
  soundLength,
  video = false,
  effects = false,
  onTakes,
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
  sound?: { pin: SoundPin; label: string } | null; // part of the sound, picked on the timeline
  soundLength?: number; // how long the sound is, so a whole lane reads "whole film"
  video?: boolean; // a video film: Claude's music reads "Score"
  effects?: boolean; // an HTML film: the Effects menu sits beside Point
  onTakes?: (prompt: string, context: ChatContext) => void; // three versions of this prompt at once
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
  // After rewriting a prompt that had no saved version before it.
  const [rewriteNote, setRewriteNote] = useState<string | null>(null);
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

  const files = useAttachments(`/api/studio/films/${filmId}/attachments`, { audio: true });

  // "Try 3": three versions at once, to pick from, straight away: of what's
  // typed in the box, or of the film as it is when the box is empty. Also
  // when a sent prompt asks for three versions itself.
  const tryThree = () => {
    if (!onTakes || turn.running) return;
    const words = draft.trim() || "Three versions of this film";
    setDraft("");
    onTakes(words, { t: pinned?.t ?? time(), pick: null });
    onClearPick();
  };
  const send = async () => {
    const attached = await files.flush();
    const words = draft.trim() || (attached.length ? "Have a look at what I attached." : "");
    if (!words) return;
    setDraft("");
    files.clear();
    if (onTakes && !turn.running && asksForThree(words)) {
      onTakes(words, { t: pinned?.t ?? time(), pick: null, ...(attached.length ? { attachments: attached } : {}) });
      onClearPick();
      return;
    }
    void chat.send(words, {
      t: pinned?.t ?? time(),
      pick: pinned?.pick ?? null,
      ...(attached.length ? { attachments: attached } : {}),
      ...(sound ? { sound: sound.pin } : {}),
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
        "top-[68px] left-4 w-[300px] transition-[height,opacity,translate,scale,filter] [interpolate-size:allow-keywords]",
        turn.running ? "h-[calc(100dvh-84px)]" : "h-auto max-h-[calc(100dvh-84px)]",
      )}
      pillClassName="top-[68px] left-4"
      pillMark={<ClaudeAtWork working={turn.running} />}
      style={style}
      bodyClassName="flex flex-col"
      actions={
        <>
          {onTakes ? (
            <Hint label="Make 3 versions">
              <button
                type="button"
                onClick={tryThree}
                disabled={turn.running}
                className="studio-candy inline-flex h-[30px] cursor-pointer items-center px-3 text-[12.5px] outline-none"
              >
                Try 3
              </button>
            </Hint>
          ) : null}
          {messages.length > 0 ? (
            <VersionsButton
              filmId={filmId}
              busy={turn.running || chat.undoing}
              time={() => pinned?.t ?? time()}
              onRestore={chat.restore}
            />
          ) : null}
          {claudeTurns > 0 ? (
            <Hint label="Undo Claude’s change" keys={["⌘", "Z"]}>
              <button
                type="button"
                className={cn(PILL_BUTTON, "h-7 px-2.5 text-white/60 hover:bg-white/[0.08] hover:text-white")}
                onClick={undo}
                disabled={turn.running || chat.undoing || chat.restoring}
              >
                {chat.undoing ? <span className="studio-shimmer">Undoing</span> : "Undo"}
              </button>
            </Hint>
          ) : null}
        </>
      }
    >
      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden overscroll-x-none px-4 pb-3 [overflow-wrap:anywhere]">
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
              Tell Claude what to change, or point at the film.
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
          <Message
            key={`${m.at}-${i}`}
            message={m}
            filmId={filmId}
            soundLength={soundLength}
            video={video}
            rewrite={
              m.role === "you" && !m.auto
                ? {
                    editing: chat.editing === m.at,
                    running: turn.running,
                    disabled: chat.undoing || chat.restoring || (chat.editing !== null && chat.editing !== m.at),
                    onStart: () => chat.setEditing(m.at),
                    onCancel: () => chat.setEditing(null),
                    onSave: (words) => {
                      chat.setEditing(null);
                      setUndoError(null);
                      setRewriteNote(null);
                      void chat.rewrite(m, words).then((note) => {
                        if (!note) return;
                        if (note.startsWith("There was no saved version")) setRewriteNote(note);
                        else setUndoError(note);
                      });
                    },
                  }
                : undefined
            }
          />
        ))}
        {turn.running ? <Live text={turn.text} steps={turn.steps} resumed={turn.resumed} /> : null}
        {!turn.running && chat.carryOn ? <CarryOnNote carryOn={chat.carryOn} onCancel={() => void chat.cancelCarryOn()} /> : null}
        {turn.error ? <p className="text-[12.5px] text-danger leading-relaxed">{turn.error}</p> : null}
        {chat.queue.length ? (
          <Queue
            queue={chat.queue}
            paused={chat.paused && !turn.running}
            onRemove={chat.removeQueued}
            editing={chat.editing}
            onEdit={chat.setEditing}
            onSave={(key, words) => {
              chat.editQueued(key, words);
              chat.setEditing(null);
            }}
            onClear={chat.clearQueue}
            onResume={chat.resume}
          />
        ) : null}
        {undoError ? <p className="text-[12.5px] text-danger leading-relaxed">{undoError}</p> : null}
        {rewriteNote && !turn.running ? <p className="text-[11.5px] text-white/40 leading-relaxed">{rewriteNote}</p> : null}
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
          glow
          queueing
          placeholder="Make the title come in from the left"
          chip={sound ? sound.label : pinned ? chipLabel(pinned.pick, pinned.t) : null}
          onClearChip={onClearPick}
          meta={<PlayheadChip clock={clock} />}
          tools={
            <>
            <Hint label={pointing ? "Stop pointing" : "Point"} keys={["P"]}>
              <button
                type="button"
                onClick={onPoint}
                aria-pressed={pointing}
                className={cn(
                  PILL_BUTTON,
                  "h-7 px-2.5",
                  pointing ? "bg-studio text-white hover:bg-studio-hover" : "text-white/60 hover:bg-white/[0.08] hover:text-white",
                )}
              >
                Point
              </button>
            </Hint>
            {effects ? (
              <EffectsMenu
                onPick={(text) => {
                  setDraft(text);
                  inputRef.current?.focus();
                }}
              />
            ) : null}
            </>
          }
        />
      </div>
    </Panel>
  );
}

// The studio waiting to carry on by itself: after the 15-minute cap, a
// moment; after a usage limit, until it resets.
function CarryOnNote({ carryOn, onCancel }: { carryOn: { reason: "time" | "limit"; at: string }; onCancel: () => void }) {
  const at = new Date(carryOn.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).toLowerCase();
  return (
    <div className="flex flex-col gap-1 rounded-[10px] bg-white/[0.04] px-3 py-2.5 text-[12px] leading-relaxed" role="status">
      <p className="text-white/75">
        {carryOn.reason === "time" ? (
          <span className="studio-shimmer">Carrying on in a fresh turn</span>
        ) : (
          <>{`Usage limit reached, carrying on at ${at}.`}</>
        )}
      </p>
      <p className="text-white/40">
        {carryOn.reason === "time" ? "The last turn reached the 15-minute limit. " : "You can close this page, but keep the studio running. "}
        <button type="button" onClick={onCancel} className="cursor-pointer text-white/70 underline-offset-2 hover:text-white hover:underline">
          {"Don't carry on"}
        </button>
      </p>
    </div>
  );
}

type Rewrite = {
  editing: boolean;
  running: boolean;
  disabled: boolean;
  onStart: () => void;
  onCancel: () => void;
  onSave: (words: string) => void;
};

function Message({
  message,
  filmId,
  soundLength,
  video,
  rewrite,
}: {
  message: ChatMessage;
  filmId: string;
  soundLength?: number;
  video?: boolean;
  rewrite?: Rewrite;
}) {
  if (message.role === "you" && message.auto) {
    return <p className="text-center text-[11.5px] text-white/35">The studio carried on by itself</p>;
  }
  if (message.role === "you") {
    return (
      <div data-chat-role="you" className="flex flex-col items-end gap-1 ps-8">
        {message.context?.sound ? (
          <span className="rounded-[6px] bg-studio/12 px-1.5 py-0.5 text-[11px] text-studio-soft/90">
            {soundChipLabel(message.context.sound, soundLength, video)}
          </span>
        ) : message.context?.pick ? (
          <span className="rounded-[6px] bg-studio/12 px-1.5 py-0.5 text-[11px] text-studio-soft/90">
            {chipLabel(message.context.pick, message.context.t)}
          </span>
        ) : message.context ? (
          <span className="rounded-[6px] bg-white/[0.06] px-1.5 py-0.5 text-[11px] text-white/45 tabular-nums">
            At {formatTime(message.context.t)}
          </span>
        ) : null}
        {rewrite?.editing ? (
          <EditPrompt
            text={message.text}
            label={rewrite.running ? "Stop and run this" : "Run this instead"}
            onSave={rewrite.onSave}
            onCancel={rewrite.onCancel}
          />
        ) : (
          <div className="group/you flex items-start justify-end gap-1.5">
            {rewrite ? <EditButton label="Rewrite this prompt" disabled={rewrite.disabled} onClick={rewrite.onStart} group="you" /> : null}
            <p className="whitespace-pre-wrap rounded-[12px] rounded-br-[4px] bg-white/[0.09] px-3 py-2 text-[12.5px] text-white/90 leading-relaxed">
              {message.text}
            </p>
          </div>
        )}
        {rewrite?.editing ? (
          <p className="text-[11px] text-white/40">
            {rewrite.running
              ? "Claude stops, the film goes back to just before this prompt, and this runs instead. What you have now stays in History."
              : "The film goes back to just before this prompt, and this runs instead. What you have now stays in History."}
          </p>
        ) : null}
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

// While Claude works: a small dot hops in time with the shimmering line
// beside it.
function WorkingMark() {
  return (
    <span
      aria-hidden="true"
      className="size-[6px] shrink-0 rounded-full bg-current opacity-70 [transform-origin:50%_100%] motion-safe:animate-[studio-mark-hop_0.8s_ease-in-out_infinite]"
    />
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
      <span className="text-white/75 tabular-nums">{formatTime(t)}</span>
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
  editing,
  onEdit,
  onSave,
}: {
  queue: ChatState["queue"];
  paused: boolean;
  onRemove: (key: string) => void;
  editing: string | null;
  onEdit: (key: string | null) => void;
  onSave: (key: string, words: string) => void;
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
      {queue.map((q, i) =>
        editing === q.key ? (
          <EditPrompt key={q.key} text={q.prompt} label="Save" onSave={(words) => onSave(q.key, words)} onCancel={() => onEdit(null)} />
        ) : (
        <div key={q.key} className="group/q flex items-start justify-end gap-1.5">
          <span className="pt-2 text-[10.5px] text-white/30 tabular-nums">{i + 1}</span>
          <EditButton label={`Edit waiting prompt ${i + 1}`} disabled={editing !== null} onClick={() => onEdit(q.key)} group="q" />
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
        ),
      )}
    </div>
  );
}

// The pencil beside a prompt, shown on hover (or keyboard focus).
function EditButton({ label, disabled, onClick, group }: { label: string; disabled: boolean; onClick: () => void; group: "q" | "you" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "mt-1.5 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-[7px] text-white/35 opacity-0 outline-none transition-opacity hover:bg-white/[0.08] hover:text-white focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring disabled:hidden [&_svg]:size-3.5",
        group === "q" ? "group-hover/q:opacity-100" : "group-hover/you:opacity-100",
      )}
    >
      <PencilEditIcon aria-hidden="true" />
    </button>
  );
}

// A prompt being rewritten in place: Return saves, Shift Return adds a
// line, Escape lets it go unchanged.
function EditPrompt({ text, label, onSave, onCancel }: { text: string; label: string; onSave: (words: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(text);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  // Grows with the words, like the bubble it replaces.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  const words = value.trim();
  return (
    <div className="flex w-full flex-col items-end gap-1.5 ps-8">
      <textarea
        ref={box}
        value={value}
        rows={1}
        aria-label="Prompt"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (words) onSave(words);
          }
        }}
        className="w-full resize-none overflow-hidden rounded-[12px] rounded-br-[4px] bg-white/[0.09] px-3 py-2 text-[12.5px] text-white/90 leading-relaxed outline-none ring-1 ring-white/15 [scrollbar-width:none] focus-visible:ring-white/25"
      />
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onCancel}
          className="h-7 cursor-pointer rounded-[8px] px-2.5 text-[12px] text-white/55 outline-none transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:ring-2 focus-visible:ring-ring"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!words}
          onClick={() => onSave(words)}
          className="h-7 cursor-pointer rounded-[8px] bg-white/[0.12] px-2.5 text-[12px] text-white outline-none transition-colors hover:bg-white/[0.18] focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-40"
        >
          {label}
        </button>
      </div>
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
          <code key={i} className="rounded-[4px] bg-white/[0.06] px-1 tabular-nums text-[0.92em]">
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}
