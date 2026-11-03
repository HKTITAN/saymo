"use client";

import { Popover } from "@base-ui/react/popover";
import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, MicOnIcon } from "@/components/icons";
import { DialNote, LABEL, ROW, SURFACE } from "@/components/tool/dial";
import { ACCURACIES, type DictationStatus, EXTRA_MB, type ExtraModel, LANGUAGES, SCRIPTS, STANDARD_MB } from "@/lib/studio/dictation-shared";
import { cn } from "@/lib/utils";
import { clockText } from "./use-attachments";
import { DiscardAsk, Hint, PILL_BUTTON } from "./panel";
import { Kbd } from "@/components/ui/kbd";
import { type Dictation, type DictationView, dictationApi, setDictationSettings, useDictationSettings } from "./use-dictation";

// The mic in a prompt box (use-dictation.ts does the work): the button,
// its menu (language, how Hindi is written, the optional Hinglish model,
// recordings kept from before), and what shows in the box while you talk.

export const TALK_KEYS = ["⌘", "⇧", "D"];

const POPUP =
  "origin-(--transform-origin) outline-none transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0";

const SMALL_BUTTON =
  "inline-flex h-7 shrink-0 cursor-pointer items-center rounded-[7px] px-2.5 text-[12px] text-white/75 outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-45";

export function MicButton({ d, view }: { d: Dictation; view: DictationView }) {
  const recording = view.phase === "recording" || view.phase === "starting";
  const blocked = view.elsewhere || view.phase === "writing";
  return (
    <span className="flex items-center">
      <Hint label={view.elsewhere ? "Another prompt box is listening" : recording ? "Stop and write it down" : "Talk instead of typing"} keys={view.elsewhere ? undefined : TALK_KEYS}>
        <button
          type="button"
          onClick={() => !blocked && d.toggle()}
          aria-disabled={blocked}
          aria-pressed={recording}
          aria-label={recording ? "Stop recording" : "Talk instead of typing"}
          className={cn(
            "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[8px] text-white/55 outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4",
            recording && "bg-[#F55A00] text-white hover:bg-[#ff6a14]",
            blocked && "cursor-default opacity-40 hover:bg-transparent hover:text-white/55",
          )}
        >
          <MicOnIcon aria-hidden="true" />
        </button>
      </Hint>
      <MicMenu d={d} view={view} />
    </span>
  );
}

const sizeText = (mb: number) => (mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb} MB`);

// A row with a choice of a few words, after DialKit's "Off | On".
function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn(ROW, "gap-2 ps-3 pe-1", disabled && "opacity-50")}>
      <span className={LABEL}>{label}</span>
      <div className="ms-auto flex gap-0.5" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            disabled={disabled}
            onClick={() => onChange(o.id)}
            className={cn(
              "h-7 cursor-pointer rounded-[7px] px-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
              value === o.id ? "bg-white/[0.13] text-white" : "text-white/45 hover:text-white/75",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function MicMenu({ d, view }: { d: Dictation; view: DictationView }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<DictationStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const settings = useDictationSettings();

  // While open, the menu keeps up with downloads and setting up.
  useEffect(() => {
    if (!open) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = () => {
      dictationApi
        .status()
        .then((s) => {
          if (!live) return;
          setStatus(s);
          setProblem(null);
          const moving = s.models.best.percent !== null || s.models.hinglish.percent !== null || s.setup.running;
          timer = setTimeout(poll, moving ? 1000 : 4000);
        })
        .catch(() => {
          if (!live) return;
          setProblem("Unable to reach the studio. Check that it's still running.");
          timer = setTimeout(poll, 3000);
        });
    };
    poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open]);

  const act = (action: string, extra?: Record<string, unknown>) =>
    dictationApi
      .act(action, extra)
      .then((s) => s && setStatus(s))
      .catch(() => setProblem("Unable to reach the studio. Check that it's still running."));

  const hindi = settings.language !== "en";
  const h = status?.models.hinglish;
  const best = status?.models.best;
  const busy = view.phase !== "idle" || view.elsewhere;

  // A download row: get it, how far it's got, or remove it.
  const model = (which: ExtraModel, label: string) => {
    const m = status?.models[which];
    return (
      <>
        <div className={cn(ROW, "gap-2 ps-3 pe-1")}>
          <span className={LABEL}>{label}</span>
          {!m ? (
            <span className="ms-auto pe-2 text-white/35">Checking</span>
          ) : m.installed ? (
            <>
              <span className="ms-auto text-white/45">On this Mac</span>
              <button type="button" className={SMALL_BUTTON} onClick={() => void act("remove", { model: which })}>
                Remove
              </button>
            </>
          ) : m.percent !== null ? (
            <>
              <span className="ms-auto font-mono text-white/60 tabular-nums">{m.percent}%</span>
              <button type="button" className={SMALL_BUTTON} onClick={() => void act("stop", { model: which })}>
                Stop
              </button>
            </>
          ) : (
            <button type="button" className={cn(SMALL_BUTTON, "ms-auto")} onClick={() => void act("get", { model: which })}>
              Download, {sizeText(EXTRA_MB[which])}
            </button>
          )}
        </div>
        {m?.error ? <p className="px-1 text-[11.5px] text-[#ff9592] leading-relaxed">{m.error}</p> : null}
      </>
    );
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Hint label="Voice settings">
        <Popover.Trigger
          className="inline-flex h-7 w-4 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-white/40 outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-white/[0.08] data-popup-open:text-white [&_svg]:size-3"
          aria-label="Voice settings"
        >
          <ChevronDownIcon aria-hidden="true" />
        </Popover.Trigger>
      </Hint>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8} collisionPadding={12} className="z-50">
          <Popover.Popup className={cn(SURFACE, POPUP, "flex w-[340px] flex-col gap-1.5 p-1.5")}>
            <Choice label="Language" options={LANGUAGES} value={settings.language} onChange={(language) => setDictationSettings({ language })} />
            <Choice
              label="Write Hindi in"
              options={SCRIPTS}
              value={settings.script}
              disabled={!hindi}
              onChange={(script) => setDictationSettings({ script })}
            />
            {hindi && settings.script === "roman" && h && !h.installed && !(settings.accuracy === "best" && best?.installed) ? (
              <DialNote>Mixed Hindi and English comes out better with Most accurate or the Hinglish model.</DialNote>
            ) : null}
            <Choice label="Accuracy" options={ACCURACIES} value={settings.accuracy} onChange={(accuracy) => setDictationSettings({ accuracy })} />
            {settings.accuracy === "best" && best && !best.installed ? (
              <DialNote>Most accurate needs its model below. Until then, Fast is used.</DialNote>
            ) : null}
            {model("best", "Most accurate model")}
            {model("hinglish", "Hinglish model")}
            <DialNote>Most accurate takes about twice as long as Fast.</DialNote>
            {status && !status.ready ? (
              <div className={cn(ROW, "gap-2 ps-3 pe-1")}>
                <span className={LABEL}>Listening</span>
                {status.setup.running ? (
                  <span className="studio-shimmer ms-auto truncate pe-2">{status.setup.step ?? "Setting up"}</span>
                ) : (
                  <button type="button" className={cn(SMALL_BUTTON, "ms-auto")} onClick={() => void act("setup")}>
                    Set up, {sizeText(STANDARD_MB)}
                  </button>
                )}
              </div>
            ) : null}
            {status?.setup.error ? <p className="px-1 text-[11.5px] text-[#ff9592] leading-relaxed">{status.setup.error}</p> : null}
            {status?.leftovers.length ? <DialNote>Kept, not written down yet.</DialNote> : null}
            {status?.leftovers.map((l) => (
              <div key={l.id} className={cn(ROW, "gap-2 ps-3 pe-1")}>
                <span className={cn(LABEL, "truncate")}>
                  Recording <span className="font-mono text-white/45 tabular-nums">{clockText(l.seconds)}</span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  className={cn(SMALL_BUTTON, "ms-auto")}
                  onClick={() => {
                    setOpen(false);
                    void d.writeKept(l.id);
                  }}
                >
                  Write it down
                </button>
                <button type="button" className={SMALL_BUTTON} onClick={() =>
                    void dictationApi
                      .act("discard", { id: l.id })
                      .then(() => dictationApi.status())
                      .then(setStatus)
                      .catch(() => setProblem("Unable to reach the studio. Check that it's still running."))
                  }>
                  Discard
                </button>
              </div>
            ))}
            {problem ? <p className="px-1 text-[11.5px] text-[#ff9592] leading-relaxed">{problem}</p> : null}
            {/* The keys, as key caps: talk, stop, discard. */}
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5 px-3 pt-1 pb-2 text-[11.5px] text-white/45">
              <dt>Talk</dt>
              <dd className="flex flex-wrap items-center gap-1">
                <Kbd>⌘</Kbd>
                <Kbd>⇧</Kbd>
                <Kbd>D</Kbd>
                <span className="mx-1">or hold</span>
                <Kbd>⌥</Kbd>
                <Kbd>Space</Kbd>
              </dd>
              <dt>Stop</dt>
              <dd className="flex items-center gap-1">
                <Kbd>Enter</Kbd>
              </dd>
              <dt>Discard</dt>
              <dd className="flex items-center gap-1">
                <Kbd>Esc</Kbd>
              </dd>
            </dl>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

// The level of your voice, as a row of thin bars moving right to left.
function Meter({ d }: { d: Dictation }) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const levels = d.recorder?.levels;
      const n = bars.current.length;
      for (let i = 0; i < n; i++) {
        const el = bars.current[i];
        if (!el) continue;
        const v = levels ? levels[levels.length - n + i] : 0;
        el.style.transform = `scaleY(${Math.max(0.12, v)})`;
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [d]);
  return (
    <span aria-hidden="true" className="flex h-4 items-center gap-[2px]">
      {Array.from({ length: 28 }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed bars
          key={i}
          ref={(el) => {
            bars.current[i] = el;
          }}
          style={{ transform: "scaleY(0.12)" }}
          className="h-4 w-[2px] origin-center rounded-full bg-white/70"
        />
      ))}
    </span>
  );
}

// Shown in place of the box's buttons while you talk.
export function RecordingBar({ d, view }: { d: Dictation; view: DictationView }) {
  return (
    <div className="flex h-7 items-center gap-2 ps-1.5">
      <span className="size-1.5 shrink-0 rounded-full bg-[#F55A00] motion-safe:animate-pulse" aria-hidden="true" />
      {view.phase === "starting" ? (
        <span className="text-[12px] text-white/50">Starting the mic</span>
      ) : view.plain ? (
        <span className="text-[12px] text-white/50">Recording</span>
      ) : (
        <Meter d={d} />
      )}
      <span className="font-mono text-[11.5px] text-white/60 tabular-nums" aria-live="off">
        {clockText(view.seconds)}
      </span>
      <span className="sr-only" aria-live="polite">
        {view.phase === "recording" ? "Recording" : ""}
      </span>
      <span className="ms-auto" />
      <Hint label="Discard this recording" keys={["Esc"]}>
        <button type="button" onClick={() => d.cancel(true)} className={cn(PILL_BUTTON, "h-7 px-2.5 text-white/60 hover:bg-white/[0.08] hover:text-white")}>
          Cancel
        </button>
      </Hint>
      <Hint label="Stop and write it down" keys={["↵"]}>
        <button type="button" onClick={() => void d.stop()} className={cn(PILL_BUTTON, "h-7 bg-white px-2.5 text-[#141414] hover:bg-white/90")}>
          Done
        </button>
      </Hint>
    </div>
  );
}

// Above the words: writing in progress, setting up, or what went wrong.
export function DictationNotice({ d, view }: { d: Dictation; view: DictationView }) {
  if (view.asking) {
    return <DiscardAsk what="this recording" onKeep={() => d.keepRecording()} onDiscard={() => d.cancel(true)} />;
  }
  if (view.setupStep) {
    return (
      <p className="px-1.5 text-[11.5px]" aria-live="polite">
        <span className="studio-shimmer">{view.setupStep}</span>
      </p>
    );
  }
  const n = view.notice;
  return (
    <>
      {view.phase === "writing" && !n ? (
        <p className="px-1.5 text-[11.5px]" aria-live="polite">
          <span className="studio-shimmer">Writing it down</span>
        </p>
      ) : null}
      {n ? (
        <div className="flex flex-col gap-1 px-1.5" aria-live="polite">
          <p className={cn("text-[11.5px] leading-relaxed", n.tone === "error" ? "text-[#ff9592]" : "text-white/55")}>{n.text}</p>
          <div className="flex gap-1">
            {n.setup ? (
              <button type="button" onClick={() => void d.setUp()} className={cn(PILL_BUTTON, "h-7 bg-white/[0.1] px-2.5 text-white/85 hover:bg-white/[0.15]")}>
                Set up listening
              </button>
            ) : null}
            {n.retry ? (
              <button type="button" onClick={() => d.retry()} className={cn(PILL_BUTTON, "h-7 bg-white/[0.1] px-2.5 text-white/85 hover:bg-white/[0.15]")}>
                Try again
              </button>
            ) : null}
            {n.retry || n.setup ? (
              <button type="button" onClick={() => d.discard()} className={cn(PILL_BUTTON, "h-7 px-2.5 text-white/55 hover:bg-white/[0.08] hover:text-white")}>
                Discard recording
              </button>
            ) : (
              <button type="button" onClick={() => d.dismiss()} className={cn(PILL_BUTTON, "h-7 px-2.5 text-white/55 hover:bg-white/[0.08] hover:text-white")}>
                Dismiss
              </button>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
