"use client";

import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUpIcon, MultipleCrossCancelIcon, MusicBeamNoteIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { libraryApi } from "./library-api";
import { AttachMenu } from "./library-picker";
import { DictationNotice, MicButton, RecordingBar } from "./mic-button";
import { Hint } from "./panel";
import { SaveToLibrary } from "./save-to-library";
import { acceptFor, type Attachments, clockText, KIND_LABEL } from "./use-attachments";
import { useDictation } from "./use-dictation";

// Where a prompt is typed: in the chat panel and in the bubble on the film.
// Enter sends, Shift+Enter starts a new line. Grows with its words. While
// Claude works, Enter adds the prompt to the queue (where the box allows it).
// With `attachments`, files can come along too: the paperclip (files from
// this Mac, or from the reference library), a drop onto the box, or a
// pasted screenshot. The mic writes down what you say
// (use-dictation.ts): ⌘ ⇧ D or hold ⌥ Space; while it listens, Enter
// stops and Esc discards it, and nothing is sent.

export function PromptBox({
  value,
  onChange,
  onSend,
  onStop,
  running,
  queueing,
  placeholder,
  chip,
  meta,
  onClearChip,
  tools,
  inputRef,
  autoFocus,
  onEscape,
  maxRows = 6,
  className,
  attachments,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop?: () => void;
  running: boolean;
  queueing?: boolean; // while Claude works, Enter adds to the queue instead of waiting
  placeholder: string;
  chip?: string | null;
  meta?: React.ReactNode; // shown where the chip goes when there's no chip
  onClearChip?: () => void;
  tools?: ReactNode;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  autoFocus?: boolean;
  onEscape?: () => void;
  maxRows?: number;
  className?: string;
  attachments?: Attachments;
}) {
  const own = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? own;
  const picker = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  // The words as they are now, for the mic to add to (it may add twice
  // before the box has drawn the first).
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  const { d, view } = useDictation({
    value: () => latest.current,
    set: (next) => {
      latest.current = next;
      onChange(next);
    },
    textarea: () => ref.current,
  });
  const listening = view.phase === "recording" || view.phase === "starting";
  // Holding ⌥ Space talks while it's held; a quick press starts, and the
  // next one stops.
  const hold = useRef<number | null>(null);
  // Sends (or queues, while Claude works) once there are words or files,
  // every file is in, and nothing said is still being written down.
  const canSend =
    (!running || Boolean(queueing)) && !attachments?.uploading && view.phase === "idle" && view.waiting === 0 && Boolean(value.trim() || attachments?.hasFiles);

  // Fit the box to its lines, up to maxRows.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const line = 19;
    el.style.height = `${Math.min(el.scrollHeight, line * maxRows + 12)}px`;
  }, [value, maxRows, ref]);

  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.metaKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      d.toggle();
    } else if (e.code === "Space" && e.altKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      if (e.repeat) return;
      if (view.phase === "idle" && !view.elsewhere) {
        hold.current = performance.now();
        void d.start();
      } else if (listening) {
        hold.current = null;
        void d.stop();
      }
    } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (listening) void d.stop();
      else if (canSend) onSend();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onEscape?.();
    }
  };

  const filesOf = (list: FileList | null | undefined) => [...(list ?? [])];

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-[12px] bg-white/[0.06] p-1.5 transition-colors has-[:focus-visible]:bg-white/[0.08] has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-white/15",
        over && "bg-white/[0.09] ring-1 ring-white/30",
        className,
      )}
      onDragOver={
        attachments
          ? (e) => {
              if (!e.dataTransfer.types.includes("Files")) return;
              e.preventDefault();
              setOver(true);
            }
          : undefined
      }
      onDragLeave={attachments ? () => setOver(false) : undefined}
      onDrop={
        attachments
          ? (e) => {
              if (!e.dataTransfer.types.includes("Files")) return;
              // Claimed here, so the studio doesn't treat them as footage.
              e.preventDefault();
              setOver(false);
              attachments.add(filesOf(e.dataTransfer.files));
            }
          : undefined
      }
    >
      {attachments?.items.length ? (
        <ul className="flex flex-wrap gap-1">
          {attachments.items.map((a) => (
            <li
              key={a.key}
              className={cn(
                "group/chip flex h-7 max-w-full items-center gap-1.5 rounded-[8px] bg-white/[0.07] ps-1 pe-0.5 text-[11.5px] text-white/80",
                a.error && "bg-[#ff9592]/10 text-[#ff9592]",
              )}
              title={a.error ?? a.name}
            >
              {a.preview ? (
                // biome-ignore lint/performance/noImgElement: a local preview of a file being attached
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.preview} alt="" className="size-5 shrink-0 rounded-[4px] object-cover" />
              ) : a.kind === "audio" ? (
                <span className="flex size-5 shrink-0 items-center justify-center rounded-[4px] bg-[#F55A00]/15 text-[#ff9a5c] [&_svg]:size-3">
                  <MusicBeamNoteIcon aria-hidden="true" />
                </span>
              ) : (
                <span className="flex h-5 shrink-0 items-center rounded-[4px] bg-white/[0.08] px-1 font-medium text-[10px] text-white/60 uppercase tracking-[0.04em]">
                  {KIND_LABEL[a.kind]}
                </span>
              )}
              <span className={cn("max-w-40 truncate", !a.done && !a.error && "text-white/50")}>{a.name}</span>
              {a.kind === "audio" && (a.seconds ?? a.done?.seconds) ? (
                <span className="shrink-0 font-mono text-[10.5px] text-white/45 tabular-nums">{clockText(a.seconds ?? a.done?.seconds ?? 0)}</span>
              ) : null}
              {/* Keep it for later: saved to the reference library. */}
              <span className="hidden group-hover/chip:flex group-focus-within/chip:flex">
                <SaveToLibrary save={() => libraryApi.upload(a.file, null)} />
              </span>
              <button
                type="button"
                onClick={() => attachments.remove(a.key)}
                aria-label={`Remove ${a.name}`}
                className="inline-flex size-5 cursor-pointer items-center justify-center rounded-[5px] text-white/40 outline-none hover:bg-white/[0.08] hover:text-white focus-visible:ring-1 focus-visible:ring-white/40 [&_svg]:size-3"
              >
                <MultipleCrossCancelIcon aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {attachments?.uploading ? (
        <p className="px-1.5 text-[11.5px]" aria-live="polite">
          <span className="studio-shimmer">
            {attachments.items.filter((a) => !a.done && !a.error).length === 1
              ? "Attaching the file"
              : `Attaching ${attachments.items.filter((a) => !a.done && !a.error).length} files`}
          </span>
        </p>
      ) : null}
      {attachments?.notice ? (
        <p className="px-1.5 text-[11.5px] text-[#ff9592] leading-relaxed" aria-live="polite">
          {attachments.notice}
        </p>
      ) : null}
      <DictationNotice d={d} view={view} />
      {chip ? (
        <span className="flex h-6 max-w-full items-center gap-1 self-start rounded-[7px] bg-[#F55A00]/15 ps-2 pe-1 text-[11.5px] text-[#ff9a5c]">
          <span className="truncate">{chip}</span>
          {onClearChip ? (
            <button
              type="button"
              onClick={onClearChip}
              aria-label="Stop pointing at this"
              className="inline-flex size-4 cursor-pointer items-center justify-center rounded-[4px] text-[#ff9a5c]/70 outline-none hover:bg-[#F55A00]/20 hover:text-[#ffb27f] focus-visible:ring-1 focus-visible:ring-[#F55A00] [&_svg]:size-3"
            >
              <MultipleCrossCancelIcon aria-hidden="true" />
            </button>
          ) : null}
        </span>
      ) : (
        (meta ?? null)
      )}
      <textarea
        ref={ref}
        rows={1}
        value={value}
        autoFocus={autoFocus}
        placeholder={listening ? "Listening. Press Enter when you're done." : running && queueing ? "Next change, runs after this one" : placeholder}
        aria-label="Prompt for Claude"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={keys}
        onKeyUp={(e) => {
          if (e.code !== "Space" || hold.current === null) return;
          const held = performance.now() - hold.current;
          hold.current = null;
          if (held > 450 && view.phase === "recording") void d.stop();
        }}
        onPaste={
          attachments
            ? (e) => {
                const files = filesOf(e.clipboardData.files);
                if (!files.length) return;
                e.preventDefault();
                attachments.add(files);
              }
            : undefined
        }
        className="w-full resize-none bg-transparent px-1.5 py-1 text-[13px] text-white/90 leading-[19px] outline-none placeholder:text-white/30"
      />
      {listening ? (
        <RecordingBar d={d} view={view} />
      ) : (
      // One row that always fits the box: the buttons keep their size and
      // the AI picker's label shortens first.
      <div className="flex min-w-0 items-center gap-0.5 [&>*]:shrink-0">
        {attachments ? (
          <>
            {/* Upload files, or pick from the library (library-picker.tsx). */}
            <AttachMenu attachments={attachments} onUpload={() => picker.current?.click()} />
            <input
              ref={picker}
              type="file"
              multiple
              accept={acceptFor(attachments.audio)}
              className="hidden"
              tabIndex={-1}
              onChange={(e) => {
                const files = filesOf(e.target.files);
                e.target.value = "";
                attachments.add(files);
              }}
            />
          </>
        ) : null}
        {tools}
        <span className="ms-auto" />
        <MicButton d={d} view={view} />
        {running && onStop ? (
          // A square "stop" mark, as in every player: Claude's working line
          // above already shows it's busy, so no spinner here.
          <Hint label="Stop Claude">
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop Claude"
              className="inline-flex size-7 cursor-pointer items-center justify-center rounded-[8px] bg-white/[0.1] text-white/85 outline-none transition-colors hover:bg-white/[0.16] focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span aria-hidden="true" className="size-2.5 rounded-[2.5px] bg-current" />
            </button>
          </Hint>
        ) : null}
        {/* While Claude works, the arrow (which queues) shows once there's
            something to queue; until then Stop has the room. */}
        {!running || (queueing && (canSend || !onStop)) ? (
          <Hint label={running ? "Add to the queue" : "Send"} keys={["↵"]}>
            <button
              type="button"
              onClick={onSend}
              disabled={!canSend}
              aria-label={running ? "Add to the queue" : "Send to Claude"}
              className="inline-flex size-7 cursor-pointer items-center justify-center rounded-[8px] bg-white text-[#141414] outline-none transition-[background-color,opacity] duration-150 hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:bg-white/15 disabled:text-white/40 [&_svg]:size-4"
            >
              <ArrowUpIcon aria-hidden="true" />
            </button>
          </Hint>
        ) : null}
      </div>
      )}
    </div>
  );
}
