"use client";

import { Popover } from "@base-ui/react/popover";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  CheckTickCircleIcon,
  ChevronDownIcon,
  MicOnIcon,
  MultipleCrossCancelIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  RefreshIcon,
  VideoCallIcon,
} from "@/components/icons";
import { DialButton, DialGroup, DialNote, DialSlider, LABEL, ROW_BUTTON, SURFACE } from "@/components/tool/dial";
import { Kbd } from "@/components/ui/kbd";
import { follow, heardWords, promptWords } from "@/lib/studio/prompter";
import type { Script } from "@/lib/studio/script";
import { cn } from "@/lib/utils";
import { CARD, Hint, ICON_BUTTON, PILL_BUTTON } from "./panel";
import { recordingType } from "./reel-api";
import { installSpeech, type Listener, listen, type SpeechSupport, speechSupport } from "./speech";

// Recording a reel: your camera in a 9:16 frame (mirrored, as a mirror
// would be; the take itself isn't), with the script over its top part in
// big type. While you record, the prompter listens and moves on as you
// read: the words you've said dim, the line you're on stays bright, and it
// scrolls to keep your place. Arrow keys move it by hand.
//
// Space starts (after 3, 2, 1) and stops; Esc closes, asking once before a
// take is thrown away.

type Phase = "live" | "countdown" | "recording" | "review";
type Device = { id: string; label: string };
type Take = { file: File; url: string; seconds: number };

const PREFS_KEY = "studio:prompter";
type Prefs = { size: number; margin: number; camera: string | null; mic: string | null };
const DEFAULT_PREFS: Prefs = { size: 34, margin: 8, camera: null, mic: null };
const readPrefs = (): Prefs => {
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
};

const POPUP =
  "origin-(--transform-origin) outline-none transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0";

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");

export function RecordStep({
  script,
  onBack,
  onClose,
  onTake,
}: {
  script: Script;
  onBack: () => void;
  onClose: () => void;
  onTake: (file: File) => void;
}) {
  const [prefs, setPrefsState] = useState<Prefs>(readPrefs);
  const setPrefs = (change: Partial<Prefs>) =>
    setPrefsState((p) => {
      const next = { ...p, ...change };
      try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });

  // ─── Camera and microphone ─────────────────────────────────────────────

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameras, setCameras] = useState<Device[]>([]);
  const [mics, setMics] = useState<Device[]>([]);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    let got: MediaStream | null = null;
    (async () => {
      try {
        got = await navigator.mediaDevices.getUserMedia({
          video: {
            ...(prefs.camera ? { deviceId: { exact: prefs.camera } } : {}),
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 },
          },
          audio: {
            ...(prefs.mic ? { deviceId: { exact: prefs.mic } } : {}),
            echoCancellation: false,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (e) {
        const name = (e as DOMException)?.name;
        // A camera that's gone: try the default one instead.
        if (live && name === "OverconstrainedError" && (prefs.camera || prefs.mic)) {
          setPrefs({ camera: null, mic: null });
          return;
        }
        if (live) {
          setBlocked(
            name === "NotAllowedError"
              ? "The studio can't use your camera and microphone. Allow them for this page (the camera button in the address bar), then try again."
              : name === "NotFoundError"
                ? "No camera was found. Connect one, then try again."
                : "The camera couldn't start. Close other apps using it, then try again.",
          );
        }
        return;
      }
      if (!live) {
        for (const t of got.getTracks()) t.stop();
        return;
      }
      setBlocked(null);
      setStream(got);
      const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      if (!live) return;
      const named = (kind: MediaDeviceKind, word: string) =>
        all.filter((d) => d.kind === kind && d.deviceId).map((d, i) => ({ id: d.deviceId, label: d.label || `${word} ${i + 1}` }));
      setCameras(named("videoinput", "Camera"));
      setMics(named("audioinput", "Microphone"));
    })();
    return () => {
      live = false;
      if (got) for (const t of got.getTracks()) t.stop();
    };
  }, [prefs.camera, prefs.mic, attempt]);

  // The preview is a new element after each review, so it's fed as it appears.
  const preview = useCallback(
    (el: HTMLVideoElement | null) => {
      if (el && stream && el.srcObject !== stream) el.srcObject = stream;
    },
    [stream],
  );

  const camTrack = stream?.getVideoTracks()[0];
  const micTrack = stream?.getAudioTracks()[0];
  const currentCamera = camTrack?.getSettings().deviceId ?? prefs.camera;
  const currentMic = micTrack?.getSettings().deviceId ?? prefs.mic;

  // How loud the microphone is, drawn straight onto the meter (no
  // re-render each frame).
  const meter = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!stream || !stream.getAudioTracks().length) return;
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let raf = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      const level = Math.min(1, Math.sqrt(sum / data.length) * 4);
      if (meter.current) meter.current.style.transform = `scaleX(${level.toFixed(3)})`;
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      void ctx.close();
    };
  }, [stream]);

  // ─── Speech following ──────────────────────────────────────────────────

  const [support, setSupport] = useState<SpeechSupport | null>(null);
  const [installing, setInstalling] = useState(false);
  const [speechProblem, setSpeechProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void speechSupport().then((s) => live && setSupport(s));
    return () => {
      live = false;
    };
  }, []);

  const words = useMemo(() => promptWords(script.beats.map((b) => b.line)), [script]);
  const [pos, setPosState] = useState(0);
  const posRef = useRef(0);
  const setPos = useCallback(
    (p: number) => {
      const next = Math.max(0, Math.min(words.length, p));
      posRef.current = next;
      setPosState(next);
    },
    [words.length],
  );
  const listener = useRef<Listener | null>(null);
  const startListening = () => {
    listener.current?.stop();
    setSpeechProblem(null);
    if (!support || support.kind === "none") return;
    listener.current = listen({
      lang: support.lang,
      local: support.kind === "local",
      track: micTrack,
      onHeard: (said) => {
        const next = follow(words, posRef.current, heardWords(said));
        if (next !== posRef.current) setPos(next);
      },
      onProblem: setSpeechProblem,
    });
  };
  const stopListening = () => {
    listener.current?.stop();
    listener.current = null;
  };
  useEffect(() => () => listener.current?.stop(), []);

  // ─── Recording ─────────────────────────────────────────────────────────

  const [phase, setPhase] = useState<Phase>("live");
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [take, setTake] = useState<Take | null>(null);
  const [asking, setAsking] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const countdown = useRef<ReturnType<typeof setInterval> | null>(null);
  const started = useRef(0);

  useEffect(
    () => () => {
      if (countdown.current) clearInterval(countdown.current);
      if (recorder.current?.state === "recording") {
        recorder.current.onstop = null;
        recorder.current.stop();
      }
    },
    [],
  );
  useEffect(() => () => void (take && URL.revokeObjectURL(take.url)), [take]);

  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => setElapsed((Date.now() - started.current) / 1000), 250);
    return () => clearInterval(t);
  }, [phase]);

  const begin = () => {
    if (!stream) return;
    const type = recordingType();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, {
        ...(type ? { mimeType: type } : {}),
        videoBitsPerSecond: 16_000_000,
        audioBitsPerSecond: 192_000,
      });
    } catch {
      setRecordError("This browser can't record video. Try Chrome or Safari.");
      setPhase("live");
      return;
    }
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      const blobType = rec.mimeType || type || "video/webm";
      const blob = new Blob(chunks, { type: blobType.split(";")[0] });
      const ext = blobType.includes("mp4") ? "mp4" : "webm";
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", ".");
      const file = new File([blob], `Take ${stamp}.${ext}`, { type: blob.type });
      setTake({ file, url: URL.createObjectURL(blob), seconds: (Date.now() - started.current) / 1000 });
      setPhase("review");
    };
    recorder.current = rec;
    setPos(0);
    setRecordError(null);
    started.current = Date.now();
    setElapsed(0);
    rec.start(1000);
    setPhase("recording");
    startListening();
  };

  const startCountdown = () => {
    if (!stream || phase !== "live") return;
    setCount(3);
    setPhase("countdown");
    let n = 3;
    countdown.current = setInterval(() => {
      n -= 1;
      if (n > 0) setCount(n);
      else {
        if (countdown.current) clearInterval(countdown.current);
        countdown.current = null;
        begin();
      }
    }, 1000);
  };
  const cancelCountdown = () => {
    if (countdown.current) clearInterval(countdown.current);
    countdown.current = null;
    setPhase("live");
  };
  const stop = () => {
    stopListening();
    if (recorder.current?.state === "recording") recorder.current.stop();
  };
  const retake = () => {
    setTake(null);
    setAsking(false);
    setPos(0);
    setPhase("live");
  };

  // ─── The take, played back ─────────────────────────────────────────────

  const player = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const toggleTake = () => {
    const v = player.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };

  // ─── Keys ──────────────────────────────────────────────────────────────

  const beatStarts = useMemo(() => {
    const starts: number[] = [];
    words.forEach((w, i) => {
      if (i === 0 || words[i - 1].beat !== w.beat) starts.push(i);
    });
    return starts;
  }, [words]);
  const jump = useCallback(
    (dir: 1 | -1) => {
      const p = posRef.current;
      if (dir > 0) setPos(beatStarts.find((s) => s > p) ?? words.length);
      else setPos([...beatStarts].reverse().find((s) => s < p) ?? 0);
    },
    [beatStarts, setPos, words.length],
  );

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keys.current = (e) => {
      if (e.key === "Escape") {
        if (e.defaultPrevented) return;
        e.preventDefault();
        if (phase === "countdown") return cancelCountdown();
        if (phase === "recording" || phase === "review") {
          // Asked once; a second Esc throws the take away.
          if (asking) {
            if (phase === "recording" && recorder.current) recorder.current.onstop = null;
            stop();
            onClose();
          } else setAsking(true);
          return;
        }
        onClose();
        return;
      }
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === " ") {
        e.preventDefault();
        if (phase === "live") startCountdown();
        else if (phase === "countdown") cancelCountdown();
        else if (phase === "recording") stop();
        else if (phase === "review") toggleTake();
      } else if ((e.key === "ArrowDown" || e.key === "ArrowRight") && phase !== "review") {
        e.preventDefault();
        jump(1);
      } else if ((e.key === "ArrowUp" || e.key === "ArrowLeft") && phase !== "review") {
        e.preventDefault();
        jump(-1);
      }
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ─── Layout ────────────────────────────────────────────────────────────

  const speechLine =
    support === null
      ? null
      : speechProblem
        ? speechProblem
        : support.kind === "local"
          ? "The prompter follows your voice, listening on this Mac."
          : support.kind === "none"
            ? "This browser can't follow your voice. Move the script with the arrow keys."
            : "The prompter follows your voice. Your audio goes to the browser's speech service to be understood.";

  return (
    <div className="absolute inset-0 bg-[#0b0b0b]">
      {/* Top corners: back to the script, and close. */}
      <div className="absolute top-4 left-4 z-10">
        <button type="button" onClick={onBack} disabled={phase === "recording"} className={cn(CARD, PILL_BUTTON, "h-11 rounded-[14px] px-4 text-white/80 hover:text-white")}>
          <ArrowLeftIcon aria-hidden="true" />
          Back to the script
        </button>
      </div>
      <Hint label="Close" keys={["Esc"]}>
        <button
          type="button"
          onClick={() => keys.current(new KeyboardEvent("keydown", { key: "Escape" }))}
          className={cn(CARD, ICON_BUTTON, "absolute top-4 right-4 z-10 size-11 rounded-[14px]")}
          aria-label="Close"
        >
          <MultipleCrossCancelIcon aria-hidden="true" />
        </button>
      </Hint>

      {/* The frame, centred, with the controls under it. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-4 pt-20 pb-6 lg:pe-[300px] lg:ps-[300px]">
        <div
          className="relative aspect-[9/16] h-[min(calc(100vh-200px),900px)] max-w-full overflow-hidden rounded-[18px] bg-[#111] shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_30px_80px_-20px_rgba(0,0,0,0.8)]"
          data-phase={phase}
        >
          {phase === "review" && take ? (
            // biome-ignore lint/a11y/useMediaCaption: the person's own take, played back to check it
            <video
              ref={player}
              src={take.url}
              playsInline
              loop
              preload="auto"
              // Show the first frame rather than black until it plays.
              onLoadedData={(e) => {
                if (e.currentTarget.paused && e.currentTarget.currentTime === 0) e.currentTarget.currentTime = 0.001;
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onClick={toggleTake}
              className="absolute inset-0 size-full cursor-pointer object-cover"
            />
          ) : (
            <video ref={preview} autoPlay muted playsInline className="absolute inset-0 size-full -scale-x-100 object-cover" />
          )}

          {blocked ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-pretty text-[13px] text-white/75 leading-relaxed">{blocked}</p>
              <button type="button" className={cn(PILL_BUTTON, "bg-white text-[#141414] hover:bg-white/90")} onClick={() => setAttempt((a) => a + 1)}>
                Try again
              </button>
            </div>
          ) : !stream && phase !== "review" ? (
            <p className="absolute inset-0 flex items-center justify-center text-[12.5px]">
              <span className="studio-shimmer">Starting your camera</span>
            </p>
          ) : null}

          {phase !== "review" && !blocked ? (
            <Prompter script={script} words={words} pos={pos} size={prefs.size} margin={prefs.margin} onPick={setPos} />
          ) : null}

          {phase === "countdown" ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25">
              <span key={count} className="font-medium text-[120px] text-white tabular-nums animate-in fade-in zoom-in-75 duration-300">
                {count}
              </span>
            </div>
          ) : null}

          {phase === "recording" ? (
            <div className="absolute right-3 bottom-3 flex h-7 items-center gap-2 rounded-full bg-black/55 px-3 text-[12px] backdrop-blur-md">
              <span className="size-2 animate-pulse rounded-full bg-[#ff5f57]" aria-hidden="true" />
              <span className="text-white/90 tabular-nums">{clock(elapsed)}</span>
            </div>
          ) : null}

          {phase === "review" && take && !playing ? (
            <button
              type="button"
              onClick={toggleTake}
              aria-label="Play the take"
              className="absolute inset-0 m-auto flex size-16 cursor-pointer items-center justify-center rounded-full bg-black/45 text-white/90 backdrop-blur-md transition-transform hover:scale-105 [&_svg]:size-8"
            >
              <PlayCircleIcon aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {/* What to do now. */}
        <div className="flex min-h-14 items-center gap-3">
          {phase === "review" && take ? (
            <>
              <button type="button" className={cn(PILL_BUTTON, "h-10 rounded-[12px] bg-white/[0.08] px-4 text-white/85 hover:bg-white/[0.12]")} onClick={retake}>
                <RefreshIcon aria-hidden="true" />
                Retake
              </button>
              <span className="text-[12px] text-white/45">
                <span className="tabular-nums">{clock(take.seconds)}</span>
              </span>
              <Hint label={playing ? "Pause" : "Play"} keys={["Space"]}>
                <button type="button" className={ICON_BUTTON} onClick={toggleTake} aria-label={playing ? "Pause the take" : "Play the take"}>
                  {playing ? <PauseCircleIcon aria-hidden="true" /> : <PlayCircleIcon aria-hidden="true" />}
                </button>
              </Hint>
              <button type="button" className={cn(PILL_BUTTON, "h-10 rounded-[12px] bg-white px-4 text-[#141414] hover:bg-white/90")} onClick={() => onTake(take.file)}>
                Make the reel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={!stream}
                onClick={() => (phase === "live" ? startCountdown() : phase === "countdown" ? cancelCountdown() : stop())}
                aria-label={phase === "recording" ? "Stop recording" : phase === "countdown" ? "Cancel the countdown" : "Start recording"}
                className="group/rec flex size-14 cursor-pointer items-center justify-center rounded-full shadow-[inset_0_0_0_3px_rgba(255,255,255,0.85)] outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-40"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "bg-[#ff5f57] transition-[width,height,border-radius] duration-200 ease-out",
                    phase === "recording" ? "size-5 rounded-[5px]" : "size-10 rounded-full group-hover/rec:size-9",
                  )}
                />
              </button>
              <span className="flex items-center gap-1.5 text-[12px] text-white/45">
                <Kbd>Space</Kbd>
                {phase === "recording" ? "stops" : phase === "countdown" ? "cancels" : "starts recording"}
              </span>
            </>
          )}
        </div>
        {recordError ? <p className="text-[12px] text-[#ff9592]">{recordError}</p> : null}
      </div>

      {/* Settings, floating at the side. */}
      <aside aria-label="Prompter settings" className={cn(CARD, "absolute top-20 right-4 hidden w-[264px] flex-col gap-3 p-3 lg:flex")}>
        <DialGroup title="Camera and sound">
          <DeviceRow label="Camera" icon={<VideoCallIcon aria-hidden="true" />} devices={cameras} value={currentCamera ?? null} disabled={phase === "recording"} onChange={(camera) => setPrefs({ camera })} />
          <DeviceRow label="Microphone" icon={<MicOnIcon aria-hidden="true" />} devices={mics} value={currentMic ?? null} disabled={phase === "recording"} onChange={(mic) => setPrefs({ mic })} />
          <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden="true">
            <span ref={meter} className="block h-full origin-left scale-x-0 bg-white/50 transition-transform duration-75" />
          </div>
        </DialGroup>
        <DialGroup title="Prompter">
          <DialSlider label="Text size" value={prefs.size} min={20} max={64} step={1} format={(v) => `${Math.round(v)} px`} onChange={(size) => setPrefs({ size })} />
          <DialSlider label="Margin" value={prefs.margin} min={2} max={24} step={1} format={(v) => `${Math.round(v)}%`} onChange={(margin) => setPrefs({ margin })} />
          {speechLine ? <DialNote>{speechLine}</DialNote> : null}
          {support?.kind === "downloadable" ? (
            <DialButton
              loading={installing}
              onClick={async () => {
                setInstalling(true);
                const ok = await installSpeech(support.lang);
                setInstalling(false);
                if (ok) setSupport({ kind: "local", lang: support.lang });
              }}
            >
              Listen on this Mac instead
            </DialButton>
          ) : null}
          <DialNote>
            <Kbd className="align-[-3px]">↑</Kbd> <Kbd className="align-[-3px]">↓</Kbd> move the script by a line. Click a word to jump to it.
          </DialNote>
        </DialGroup>
      </aside>

      {/* Asked once before a take is thrown away. */}
      {asking ? (
        <div className="absolute inset-x-0 bottom-24 z-20 flex justify-center px-4">
          <div role="alertdialog" aria-label="Discard this take?" className={cn(CARD, "flex items-center gap-3 py-2.5 ps-4 pe-2.5 animate-in fade-in slide-in-from-bottom-1 duration-150")}>
            <span className="text-[12.5px] text-white/85">Discard this take?</span>
            <button
              type="button"
              className={cn(PILL_BUTTON, "bg-white text-[#141414] hover:bg-white/90")}
              onClick={() => {
                if (recorder.current) recorder.current.onstop = null;
                stop();
                onClose();
              }}
            >
              Discard
            </button>
            <button type="button" className={cn(PILL_BUTTON, "text-white/70 hover:bg-white/[0.08]")} onClick={() => setAsking(false)}>
              Keep it
            </button>
            <span className="flex items-center gap-1 text-[11.5px] text-white/35">
              <Kbd>Esc</Kbd> discards
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// The script over the top of the frame. The beat you're on is bright; the
// words you've said dim; it scrolls to keep the next word a third of the
// way down.
function Prompter({
  script,
  words,
  pos,
  size,
  margin,
  onPick,
}: {
  script: Script;
  words: ReturnType<typeof promptWords>;
  pos: number;
  size: number;
  margin: number;
  onPick: (pos: number) => void;
}) {
  const area = useRef<HTMLDivElement>(null);
  const spans = useRef<(HTMLSpanElement | null)[]>([]);
  const [offset, setOffset] = useState(0);
  const beat = words[Math.min(pos, words.length - 1)]?.beat ?? 0;

  useLayoutEffect(() => {
    const at = spans.current[Math.min(pos, words.length - 1)];
    const box = area.current;
    if (!at || !box) return;
    const target = box.clientHeight * 0.3;
    setOffset(Math.min(0, target - at.offsetTop));
  }, [pos, size, margin, words.length]);

  let n = 0;
  return (
    <div
      ref={area}
      className="absolute inset-x-0 top-0 h-[46%] overflow-hidden bg-gradient-to-b from-black/80 via-black/60 to-transparent"
      style={{ paddingInline: `${margin}%`, maskImage: "linear-gradient(to bottom, transparent 0, black 14%, black 72%, transparent 100%)" }}
    >
      <div className="relative pt-6 transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]" style={{ transform: `translateY(${offset}px)` }}>
        {script.beats.map((b, bi) => (
          <p
            key={bi}
            className={cn("mb-[0.7em] text-pretty font-semibold transition-opacity duration-300", bi === beat ? "opacity-100" : bi < beat ? "opacity-30" : "opacity-55")}
            style={{ fontSize: size, lineHeight: 1.22, letterSpacing: "-0.01em" }}
          >
            {b.line
              .split(/\s+/)
              .filter(Boolean)
              .map((w) => {
                const i = n++;
                return (
                  <span key={i}>
                    <span
                      ref={(el) => {
                        spans.current[i] = el;
                      }}
                      onClick={() => onPick(i)}
                      className={cn("cursor-pointer transition-colors duration-200", i < pos ? "text-white/45" : "text-white")}
                    >
                      {w}
                    </span>{" "}
                  </span>
                );
              })}
          </p>
        ))}
        <p className="pb-[40%] text-[12px] text-white/40">End of the script</p>
      </div>
    </div>
  );
}

function DeviceRow({
  label,
  icon,
  devices,
  value,
  disabled,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  devices: Device[];
  value: string | null;
  disabled?: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = devices.find((d) => d.id === value) ?? devices[0];
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={cn(ROW_BUTTON, "disabled:cursor-default disabled:opacity-50")} disabled={disabled || devices.length < 2}>
        <span className={cn(LABEL, "flex items-center gap-2 [&_svg]:size-3.5")}>
          {icon}
          {label}
        </span>
        <span className="ms-auto flex min-w-0 items-center gap-1.5 text-white/90">
          <span className="truncate">{current?.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, "") ?? "None"}</span>
          {devices.length > 1 ? <ChevronDownIcon className="size-3.5 shrink-0 text-white/40" aria-hidden="true" /> : null}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={12} className="z-50">
          <Popover.Popup className={cn(SURFACE, POPUP, "flex w-[260px] flex-col gap-0.5 p-1.5")}>
            {devices.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (d.id !== value) onChange(d.id);
                }}
                className="flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-[9px] px-2 text-left text-[12.5px] text-white/80 outline-none transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:bg-white/[0.07]"
              >
                <span className="min-w-0 flex-1 truncate">{d.label}</span>
                {d.id === current?.id ? <CheckTickCircleIcon className="size-4 text-white/70" aria-label="In use" /> : null}
              </button>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
