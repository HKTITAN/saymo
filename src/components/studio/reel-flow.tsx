"use client";

import { Popover } from "@base-ui/react/popover";
import { type DragEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  DeleteDustbin01Icon,
  MultipleCrossCancelIcon,
  PlusIcon,
  RefreshIcon,
  UploadUpIcon,
} from "@/components/icons";
import { Skeleton } from "@/components/skeleton";
import { SURFACE } from "@/components/tool/dial";
import { SIZES } from "@/lib/studio/contract";
import {
  type Beat,
  LENGTHS,
  looksLikeScript,
  motionPrompt,
  readSeconds,
  type Script,
  tidy,
  wordCount,
  WORDS_PER_SECOND,
} from "@/lib/studio/script";
import { cn } from "@/lib/utils";
import { StudioError } from "./api";
import { CARD, Hint, ICON_BUTTON, PILL_BUTTON } from "./panel";
import { PromptBox } from "./prompt-box";
import { keepDraft, makeReel, type Progress, readDraft, writeScript } from "./reel-api";
import { RecordStep } from "./record-step";
import { ACCEPTS, isMediaFile } from "./video-api";

// Write a script, and Record a reel, from the studio's home page. One
// full-screen card that moves through the steps:
//   script    type a topic or paste a script; Claude writes it as beats
//             (what you say, and what's shown), every beat editable in place
//   record    the teleprompter that follows your voice (record-step.tsx)
//   footage   or use videos you already have
//   making    the take goes into a new 9:16 video film, which opens with
//             Claude making the half-and-half reel
// "Make motion graphics from this" starts a motion film from the script.

type Step = "script" | "record" | "footage" | "making";

const POPUP =
  "origin-(--transform-origin) outline-none transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0";

const PRIMARY = cn(PILL_BUTTON, "bg-white text-[#141414] hover:bg-white/90");
const SECONDARY = cn(PILL_BUTTON, "bg-white/[0.08] text-white/85 hover:bg-white/[0.12]");
const TEXT_BUTTON =
  "cursor-pointer rounded-[6px] text-[12px] text-white/45 underline decoration-white/20 underline-offset-4 outline-none transition-colors hover:text-white/75 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export function ReelFlow({
  start,
  folder,
  onClose,
  onStartMotion,
  onOpenFilm,
}: {
  start: "script" | "reel";
  folder: string | null;
  onClose: () => void;
  onStartMotion: (prompt: string, width: number, height: number) => void;
  onOpenFilm: (id: string, prompt: string, attach: File[]) => void;
}) {
  const [step, setStep] = useState<Step>("script");
  const [script, setScriptState] = useState<Script | null>(null);
  const [footage, setFootage] = useState<File[]>([]);
  const [useScript, setUseScript] = useState(true);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [cameFrom, setCameFrom] = useState<Step>("script");
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const setScript = useCallback((next: Script | null) => {
    setScriptState(next);
    keepDraft(next);
  }, []);

  const make = async (files: File[], withScript: Script | null) => {
    setCameFrom(step);
    setStep("making");
    setProblem(null);
    setProgress({ label: "Making the film", share: null });
    try {
      const made = await makeReel({ files, script: withScript, folder, onProgress: (p) => live.current && setProgress(p), cancelled: () => !live.current });
      if (!live.current) return;
      onOpenFilm(made.id, made.prompt, made.attach);
    } catch (e) {
      if (!live.current) return;
      setProblem(e instanceof StudioError ? e.message : "Unable to make the reel. Try again.");
    }
  };
  const lastTake = useRef<File[] | null>(null);

  // Esc closes, except where a step handles it (the recorder asks first
  // when there's a take).
  useEffect(() => {
    if (step === "record") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, onClose]);

  const close = (
    <Hint label="Close" keys={["Esc"]}>
      <button type="button" onClick={onClose} className={cn(CARD, ICON_BUTTON, "absolute top-4 right-4 z-10 size-11 rounded-[14px]")} aria-label="Close">
        <MultipleCrossCancelIcon aria-hidden="true" />
      </button>
    </Hint>
  );

  if (step === "record" && script) {
    return (
      <RecordStep
        script={script}
        onBack={() => setStep("script")}
        onClose={onClose}
        onTake={(file) => {
          lastTake.current = [file];
          void make([file], script);
        }}
      />
    );
  }

  return (
    <div data-backdrop="" className="absolute inset-0 flex items-center justify-center p-6">
      {close}
      {step === "making" ? (
        <Making
          progress={progress}
          problem={problem}
          onRetry={() => {
            const files = lastTake.current ?? footage;
            if (files.length) void make(files, cameFrom === "footage" ? (useScript ? script : null) : script);
          }}
          onBack={() => {
            setProblem(null);
            setStep(cameFrom === "making" ? "script" : cameFrom);
          }}
        />
      ) : step === "footage" ? (
        <FootageStep
          files={footage}
          setFiles={setFootage}
          script={script}
          useScript={useScript}
          setUseScript={setUseScript}
          onBack={() => setStep("script")}
          onMake={() => {
            lastTake.current = null;
            void make(footage, useScript ? script : null);
          }}
        />
      ) : (
        <ScriptStep
          start={start}
          script={script}
          setScript={setScript}
          onRecord={() => setStep("record")}
          onFootage={() => setStep("footage")}
          onMotion={(w, h) => script && onStartMotion(motionPrompt(script), w, h)}
        />
      )}
    </div>
  );
}

// ─── 1. The script and its storyboard ───────────────────────────────────────

function ScriptStep({
  start,
  script,
  setScript,
  onRecord,
  onFootage,
  onMotion,
}: {
  start: "script" | "reel";
  script: Script | null;
  setScript: (s: Script | null) => void;
  onRecord: () => void;
  onFootage: () => void;
  onMotion: (width: number, height: number) => void;
}) {
  const [idea, setIdea] = useState("");
  const [seconds, setSeconds] = useState<number>(30);
  const [keep, setKeep] = useState(false);
  const [keepTouched, setKeepTouched] = useState(false);
  const [writing, setWriting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved] = useState(readDraft);
  const [asked, setAsked] = useState<{ idea: string; seconds: number; keep: boolean } | null>(null);
  const stop = useRef<AbortController | null>(null);
  useEffect(() => () => stop.current?.abort(), []);

  const write = async (request = { idea: idea.trim(), seconds, keep }) => {
    if (!request.idea) return;
    setAsked(request);
    stop.current?.abort();
    const controller = new AbortController();
    stop.current = controller;
    setWriting(true);
    setError(null);
    setStatus(request.keep ? "Reading your script" : "Thinking it through");
    setScript(null);
    let done = false;
    try {
      await writeScript(
        request,
        (event) => {
          if (event.kind === "step") setStatus(event.label);
          else if (event.kind === "draft") setScript(event.beats.length ? { title: event.title || "Untitled reel", beats: event.beats } : null);
          else if (event.kind === "done") {
            done = true;
            setScript(event.script);
          } else if (event.kind === "error") setError(event.message);
        },
        controller.signal,
      );
      if (!done && !controller.signal.aborted) setError((e) => e ?? "Claude stopped before the script was finished. Try again.");
    } catch (e) {
      setError(e instanceof StudioError ? e.message : "Unable to reach Claude. Try again.");
    } finally {
      if (stop.current === controller) {
        stop.current = null;
        setWriting(false);
      }
    }
  };

  const typed = (text: string) => {
    setIdea(text);
    if (!keepTouched) setKeep(looksLikeScript(text));
  };

  const heading = start === "reel" ? "Record a reel" : "Write a script";

  // Before there's a script: what it's about.
  if (!script && !writing) {
    return (
      <section aria-labelledby="script-title" className={cn(CARD, "flex w-full max-w-[600px] flex-col gap-4 p-5")}>
        <div className="flex flex-col gap-1.5">
          <h1 id="script-title" className="font-medium text-[15px] text-white/95">
            {heading}
          </h1>
          <p className="text-pretty text-[12.5px] text-white/55 leading-relaxed">
            {start === "reel"
              ? "Start with the script: type a topic, or paste one you've written. Then read it to your camera; the prompter follows your voice."
              : "Type a topic, or paste a script you've written. Claude splits it into beats: what you say, and what's shown while you say it."}
          </p>
        </div>
        <PromptBox
          value={idea}
          onChange={typed}
          onSend={() => void write()}
          running={false}
          autoFocus
          maxRows={10}
          placeholder="Why procurement teams lose a day a week to approvals, and how SpendOS gives it back"
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Segmented
            label="Words"
            value={keep ? "keep" : "write"}
            options={[
              ["write", "Write it for me"],
              ["keep", "Use my words"],
            ]}
            onChange={(v) => {
              setKeepTouched(true);
              setKeep(v === "keep");
            }}
          />
          {keep ? null : (
            <Segmented
              label="Length"
              value={String(seconds)}
              options={LENGTHS.map((s) => [String(s), <Seconds key={s} n={s} />] as const)}
              onChange={(v) => setSeconds(Number(v))}
            />
          )}
        </div>
        {error ? <p className="text-[12px] text-[#ff9592] leading-relaxed">{error}</p> : null}
        {saved || start === "reel" ? (
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {saved ? (
              <button type="button" className={TEXT_BUTTON} onClick={() => setScript(saved)}>
                Open your last storyboard ({saved.beats.length} beats)
              </button>
            ) : null}
            {start === "reel" ? (
              <button type="button" className={TEXT_BUTTON} onClick={onFootage}>
                Use videos I already have
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  }

  // The storyboard: written in as Claude goes, then yours to change.
  const beats = script?.beats ?? [];
  const change = (next: Beat[]) => script && setScript({ ...script, beats: next });
  const total = readSeconds(beats);
  return (
    <section aria-labelledby="script-title" className={cn(CARD, "flex max-h-full w-full max-w-[680px] flex-col")}>
      <header className="flex shrink-0 flex-col gap-1 px-5 pt-5 pb-3">
        {script ? (
          <Editable
            id="script-title"
            label="Title"
            value={script.title}
            placeholder="Title"
            onChange={(title) => setScript({ ...script, title: title || "Untitled reel" })}
            className="font-medium text-[15px] text-white/95"
          />
        ) : (
          <h1 id="script-title" className="font-medium text-[15px] text-white/95">
            {heading}
          </h1>
        )}
        {writing ? (
          <p className="text-[12px]" aria-live="polite">
            <span key={status} className="studio-shimmer block animate-in fade-in slide-in-from-bottom-1 duration-200">
              {status}
            </span>
          </p>
        ) : (
          <p className="text-[12px] text-white/45">
            <span className="tabular-nums">{beats.length}</span> {beats.length === 1 ? "beat" : "beats"}, about <span className="tabular-nums">{Math.max(1, Math.round(total))}</span> s read
            aloud. Click any words to change them.
          </p>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <BeatList beats={beats} onChange={change} locked={writing} />
        {writing ? (
          <Skeleton data={null} sample={SAMPLE_BEAT} id="script-next-beat" label="Writing the next beat">
            {(b) => (
              <div className="px-2 pt-2">
                <BeatView n={beats.length + 1} beat={b} />
              </div>
            )}
          </Skeleton>
        ) : (
          <button
            type="button"
            onClick={() => change([...beats, { line: "", visual: "" }])}
            className="mx-2 mt-1 flex h-9 w-[calc(100%-1rem)] cursor-pointer items-center justify-center gap-2 rounded-[10px] text-[12px] text-white/50 outline-none transition-colors hover:bg-white/[0.05] hover:text-white/80 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"
          >
            <PlusIcon aria-hidden="true" />
            Add a beat
          </button>
        )}
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-white/[0.06] border-t px-5 py-3.5">
        {error ? <p className="w-full pb-1 text-[12px] text-[#ff9592] leading-relaxed">{error}</p> : null}
        {writing ? (
          <button type="button" className={SECONDARY} onClick={() => stop.current?.abort()}>
            Stop
          </button>
        ) : (
          <>
            <button type="button" className={TEXT_BUTTON} onClick={() => setScript(null)}>
              Start over
            </button>
            {asked ? (
              <Hint label="Write it again">
                <button type="button" className={cn(ICON_BUTTON, "ms-1")} aria-label="Write it again" onClick={() => asked && void write(asked)}>
                  <RefreshIcon aria-hidden="true" />
                </button>
              </Hint>
            ) : null}
            <span className="ms-auto" />
            <MotionButton primary={start === "script"} disabled={!beats.some((b) => b.line)} onPick={onMotion} />
            <button
              type="button"
              className={start === "reel" ? PRIMARY : SECONDARY}
              disabled={!beats.some((b) => b.line)}
              onClick={() => {
                if (script) setScript({ ...script, beats: beats.filter((b) => b.line.trim()) });
                onRecord();
              }}
            >
              Record it
            </button>
          </>
        )}
      </footer>
    </section>
  );
}

const SAMPLE_BEAT: Beat = { line: "Most procurement teams still chase approvals by email.", visual: "An inbox stacking up with approval requests" };

const Seconds = ({ n }: { n: number }) => (
  <>
    <span className="tabular-nums">{n}</span> s
  </>
);

// The beats, each editable where it is, moved with the arrows or by
// dragging its number.
function BeatList({ beats, onChange, locked }: { beats: Beat[]; onChange: (b: Beat[]) => void; locked: boolean }) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= beats.length || from === to) return;
    const next = [...beats];
    const [b] = next.splice(from, 1);
    next.splice(to, 0, b);
    onChange(next);
  };
  return (
    <ol className="flex flex-col gap-1">
      {beats.map((beat, i) => (
        <li
          // Beats have no ids of their own; the index keeps each editor in
          // place while it's typed in.
          key={i}
          onDragOver={(e: DragEvent) => {
            if (dragging === null) return;
            e.preventDefault();
            setOver(i);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragging !== null) move(dragging, i);
            setDragging(null);
            setOver(null);
          }}
          className={cn(
            "group/beat relative rounded-[12px] px-2 py-2 transition-colors animate-in fade-in duration-300",
            over === i && dragging !== null && dragging !== i ? "bg-white/[0.07]" : "hover:bg-white/[0.03]",
            dragging === i && "opacity-50",
          )}
        >
          <BeatView
            n={i + 1}
            beat={beat}
            locked={locked}
            onChange={(b) => onChange(beats.map((x, j) => (j === i ? b : x)))}
            onDragStart={() => setDragging(i)}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
            actions={
              locked ? null : (
                <div className="flex shrink-0 items-start gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/beat:opacity-100">
                  <Hint label="Move up">
                    <button type="button" className={ICON_BUTTON} disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={`Move beat ${i + 1} up`}>
                      <ArrowUpIcon aria-hidden="true" />
                    </button>
                  </Hint>
                  <Hint label="Move down">
                    <button type="button" className={ICON_BUTTON} disabled={i === beats.length - 1} onClick={() => move(i, i + 1)} aria-label={`Move beat ${i + 1} down`}>
                      <ArrowDownIcon aria-hidden="true" />
                    </button>
                  </Hint>
                  <Hint label="Delete">
                    <button type="button" className={ICON_BUTTON} onClick={() => onChange(beats.filter((_, j) => j !== i))} aria-label={`Delete beat ${i + 1}`}>
                      <DeleteDustbin01Icon aria-hidden="true" />
                    </button>
                  </Hint>
                </div>
              )
            }
          />
        </li>
      ))}
    </ol>
  );
}

function BeatView({
  n,
  beat,
  locked = true,
  onChange,
  onDragStart,
  onDragEnd,
  actions,
}: {
  n: number;
  beat: Beat;
  locked?: boolean;
  onChange?: (b: Beat) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  actions?: ReactNode;
}) {
  const secs = wordCount(beat.line) / WORDS_PER_SECOND;
  return (
    <div className="flex gap-3">
      <span
        draggable={!locked}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(n));
          onDragStart?.();
        }}
        onDragEnd={onDragEnd}
        title={locked ? undefined : "Drag to move"}
        className={cn("flex w-8 shrink-0 flex-col items-center gap-0.5 pt-0.5 select-none", !locked && "cursor-grab active:cursor-grabbing")}
      >
        <span className="text-[12px] text-white/55 tabular-nums">{n}</span>
        {beat.line ? (
          <span className="text-[10.5px] text-white/30">
            <span className="tabular-nums">{Math.max(1, Math.round(secs))}</span> s
          </span>
        ) : null}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Editable
          label={`Beat ${n}, what you say`}
          value={beat.line}
          placeholder="What you say"
          readOnly={locked}
          onChange={(line) => onChange?.({ ...beat, line })}
          className="text-pretty text-[14px] text-white/90 leading-snug"
        />
        <div className="flex items-baseline gap-2">
          <span className="shrink-0 text-[11px] text-white/30">Shows</span>
          <Editable
            label={`Beat ${n}, what's shown`}
            value={beat.visual}
            placeholder="What's on screen while you say it"
            readOnly={locked}
            onChange={(visual) => onChange?.({ ...beat, visual })}
            className="min-w-0 flex-1 text-pretty text-[12px] text-white/50 leading-snug"
          />
        </div>
      </div>
      {actions}
    </div>
  );
}

// Words you click and type into in place. Enter or clicking away keeps
// them; Esc puts them back.
function Editable({
  id,
  label,
  value,
  placeholder,
  readOnly,
  onChange,
  className,
}: {
  id?: string;
  label: string;
  value: string;
  placeholder: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Words from outside (Claude, a reorder) show unless it's being typed in.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.textContent !== value) el.textContent = value;
  }, [value]);
  return (
    <div
      ref={ref}
      id={id}
      role="textbox"
      aria-label={label}
      aria-readonly={readOnly || undefined}
      tabIndex={readOnly ? -1 : 0}
      contentEditable={readOnly ? false : "plaintext-only"}
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onBlur={(e) => {
        const next = tidy(e.currentTarget.textContent ?? "");
        if (e.currentTarget.textContent !== next) e.currentTarget.textContent = next;
        if (next !== value) onChange(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.currentTarget.textContent = value;
          e.currentTarget.blur();
        }
      }}
      className={cn(
        "-mx-1 rounded-[6px] px-1 outline-none transition-colors empty:before:text-white/25 empty:before:content-[attr(data-placeholder)]",
        !readOnly && "cursor-text hover:bg-white/[0.05] focus:bg-white/[0.07]",
        className,
      )}
    />
  );
}

// A choice of a few, as a DialKit-style row of quiet pills.
function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, ReactNode])[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-white/45">{label}</span>
      <div className="flex gap-0.5 rounded-[10px] bg-white/[0.05] p-0.5" role="radiogroup" aria-label={label}>
        {options.map(([k, text]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={value === k}
            onClick={() => onChange(k)}
            className={cn(
              "h-7 cursor-pointer rounded-[8px] px-2.5 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              value === k ? "bg-white/[0.13] text-white" : "text-white/50 hover:text-white/80",
            )}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

// "Make motion graphics from this", with the film's size picked from a
// small menu.
function MotionButton({ primary, disabled, onPick }: { primary: boolean; disabled: boolean; onPick: (w: number, h: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={primary ? PRIMARY : SECONDARY} disabled={disabled}>
        Make motion graphics from this
        <ChevronDownIcon aria-hidden="true" className="opacity-60" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="end" sideOffset={8} collisionPadding={12} className="z-50">
          <Popover.Popup className={cn(SURFACE, POPUP, "flex w-[220px] flex-col gap-0.5 p-1.5")}>
            <p className="px-2 pt-1.5 pb-1 font-medium text-[11.5px] text-white/40">Size</p>
            {SIZES.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onPick(s.width, s.height);
                }}
                className="flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-[9px] px-2 text-left text-[12.5px] text-white/80 outline-none transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:bg-white/[0.07]"
              >
                <span
                  aria-hidden="true"
                  className="shrink-0 rounded-[2px] shadow-[inset_0_0_0_1.5px_currentColor]"
                  style={{ width: (s.width / Math.max(s.width, s.height)) * 14, height: (s.height / Math.max(s.width, s.height)) * 14 }}
                />
                {s.label}
              </button>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ─── Videos you already have ────────────────────────────────────────────────

function FootageStep({
  files,
  setFiles,
  script,
  useScript,
  setUseScript,
  onBack,
  onMake,
}: {
  files: File[];
  setFiles: (f: File[]) => void;
  script: Script | null;
  useScript: boolean;
  setUseScript: (v: boolean) => void;
  onBack: () => void;
  onMake: () => void;
}) {
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const add = (list: FileList | null) => {
    const picked = [...(list ?? [])].filter(isMediaFile);
    if (picked.length) setFiles([...files, ...picked].slice(0, 12));
  };
  return (
    <section aria-labelledby="footage-title" className={cn(CARD, "flex w-full max-w-[560px] flex-col gap-4 p-5")}>
      <div className="flex items-start gap-2">
        <Hint label="Back">
          <button type="button" className={cn(ICON_BUTTON, "-ms-1.5 mt-[-3px]")} onClick={onBack} aria-label="Back to the script">
            <ArrowLeftIcon aria-hidden="true" />
          </button>
        </Hint>
        <div className="flex flex-col gap-1.5">
          <h1 id="footage-title" className="font-medium text-[15px] text-white/95">
            Use videos I already have
          </h1>
          <p className="text-pretty text-[12.5px] text-white/55 leading-relaxed">
            Drop your takes. Claude puts the speaker on the top half and makes a graphic for each idea on the bottom half, timed to the words, with captions.
          </p>
        </div>
      </div>
      <input
        ref={picker}
        type="file"
        multiple
        accept={ACCEPTS}
        className="hidden"
        tabIndex={-1}
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target; the button inside it is the keyboard way in */}
      <div
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          add(e.dataTransfer.files);
        }}
        className={cn(
          "flex min-h-36 flex-col items-center justify-center gap-2.5 rounded-[12px] border border-dashed p-4 text-center transition-colors",
          over ? "border-white/50 bg-white/[0.07]" : "border-white/15 bg-white/[0.02]",
        )}
      >
        {files.length ? (
          <ul className="flex w-full flex-wrap justify-center gap-1.5">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex h-7 max-w-[240px] items-center gap-1 rounded-[8px] bg-white/[0.07] ps-2.5 pe-0.5 text-[12px] text-white/80">
                <span className="truncate">{f.name}</span>
                <button
                  type="button"
                  className={cn(ICON_BUTTON, "size-6 [&_svg]:size-3.5")}
                  aria-label={`Remove ${f.name}`}
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                >
                  <MultipleCrossCancelIcon aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-white/70">Drop your videos here</p>
        )}
        <button type="button" onClick={() => picker.current?.click()} className={cn(SECONDARY, "mt-1")}>
          <UploadUpIcon aria-hidden="true" />
          {files.length ? "Add more" : "Choose files"}
        </button>
      </div>
      {script ? (
        <div className="flex h-9 items-center rounded-[10px] bg-white/[0.05] ps-3 pe-1 text-[12px]">
          <span className="min-w-0 truncate text-white/65">
            Time the graphics to your script ({script.beats.length} beats)
          </span>
          <div className="ms-auto flex gap-0.5" role="radiogroup" aria-label="Use the script">
            {[false, true].map((on) => (
              <button
                key={String(on)}
                type="button"
                role="radio"
                aria-checked={useScript === on}
                onClick={() => setUseScript(on)}
                className={cn(
                  "h-7 cursor-pointer rounded-[7px] px-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  useScript === on ? "bg-white/[0.13] text-white" : "text-white/45 hover:text-white/75",
                )}
              >
                {on ? "On" : "Off"}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="flex justify-end">
        <button type="button" className={PRIMARY} disabled={!files.length} onClick={onMake}>
          Make the reel
        </button>
      </div>
    </section>
  );
}

// ─── Making the film ────────────────────────────────────────────────────────

function Making({ progress, problem, onRetry, onBack }: { progress: Progress | null; problem: string | null; onRetry: () => void; onBack: () => void }) {
  const share = progress?.share;
  return (
    <section aria-label="Making your reel" className={cn(CARD, "flex w-full max-w-[420px] flex-col gap-3 p-5")}>
      <h1 className="font-medium text-[15px] text-white/95">Making your reel</h1>
      {problem ? (
        <>
          <p className="text-[12.5px] text-[#ff9592] leading-relaxed">{problem}</p>
          <div className="flex gap-2">
            <button type="button" className={PRIMARY} onClick={onRetry}>
              Try again
            </button>
            <button type="button" className={SECONDARY} onClick={onBack}>
              Back
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="flex items-baseline gap-2 text-[12.5px]" aria-live="polite">
            <span key={progress?.label} className="studio-shimmer animate-in fade-in duration-200">
              {progress?.label ?? "Making the film"}
            </span>
            {share != null ? <span className="text-white/45 tabular-nums">{Math.round(share * 100)}%</span> : null}
          </p>
          <p className="text-[12px] text-white/40 leading-relaxed">
            When it&apos;s in, the film opens and Claude lays out the reel. Stay on this page until then.
          </p>
        </>
      )}
    </section>
  );
}
