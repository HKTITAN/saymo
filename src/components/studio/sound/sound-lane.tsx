"use client";

import { RefreshIcon } from "@/components/icons";
import type { SoundStatus, SoundStem } from "@/lib/studio/sound/sound";
import { cn } from "@/lib/utils";
import type { SoundEditor } from "./use-sound-edit";

// The sound design on a timeline: its waveform across the film, one
// shimmering line while it's being made, or one plain line if it failed.
// It's the score, not clips: it isn't cut or moved here, Claude writes it.
// Once rendered as stems it shows as lanes, Music (Score on a video film)
// and Effects, plus Voiceover on a film made from slides with a voice,
// where parts can be made louder, quieter or silent (sound-stems.tsx).

export type SoundLaneData = {
  status: SoundStatus;
  peaks: number[] | null;
  on: boolean; // the film's own Sound On | Off
  muted: boolean; // only muted for listening
  error: string | null; // a render that couldn't start
  onRetry: () => void;
  // The music and the effects on their own (sound-stems.tsx), once the
  // sound has been rendered as stems, and editing parts of them by hand.
  stems?: { music: number[] | null; effects: number[] | null; voice: number[] | null } | null;
  present?: SoundStem[]; // the stems the score has
  editor?: SoundEditor;
};

// Whether a timeline should show the lane at all.
export const showLane = (d: SoundLaneData | undefined) =>
  Boolean(d && (d.status.state !== "none" || d.error));

// Whether it shows as lanes, one per stem.
export const showStems = (d: SoundLaneData | undefined): d is SoundLaneData & { stems: NonNullable<SoundLaneData["stems"]>; editor: SoundEditor } =>
  Boolean(d && d.status.state === "ready" && !d.error && d.stems && d.editor);

// The lanes, top to bottom: Music and Effects always, Voiceover when the
// film has one.
export const stemLanes = (d: SoundLaneData | undefined): SoundStem[] =>
  d?.present?.includes("voice") ? ["music", "effects", "voice"] : ["music", "effects"];

const PER_SECOND = 100;

// The waveform, mirrored about its middle, `duration` seconds over `width`
// pixels.
export function SoundWave({
  peaks,
  duration,
  width,
  height,
  dim,
}: {
  peaks: number[];
  duration: number;
  width: number;
  height: number;
  dim?: boolean;
}) {
  if (width <= 0 || duration <= 0) return null;
  const columns = Math.max(1, Math.min(1600, Math.floor(width / 2)));
  const mid = height / 2;
  const top: string[] = [];
  const bottom: string[] = [];
  for (let c = 0; c < columns; c++) {
    const a = Math.floor((c / columns) * duration * PER_SECOND);
    const b = Math.max(a + 1, Math.ceil(((c + 1) / columns) * duration * PER_SECOND));
    let v = 0;
    for (let i = a; i < b && i < peaks.length; i++) v = Math.max(v, peaks[i] ?? 0);
    // A floor of half a pixel, so quiet stretches still read as a line.
    const h = Math.max(0.5, v * (mid - 1));
    const x = (c / columns) * width;
    top.push(`${x},${mid - h}`);
    bottom.unshift(`${x},${mid + h}`);
  }
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 left-0"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      <polygon
        points={`${top.join(" ")} ${width},${mid} ${bottom.join(" ")} 0,${mid}`}
        style={{ fill: dim ? "rgb(var(--hi) / 0.14)" : "rgb(var(--hi) / 0.38)" }}
      />
    </svg>
  );
}

// What the lane says when there's no waveform to show.
export function SoundLine({ data }: { data: SoundLaneData }) {
  const { status, error, onRetry } = data;
  const failed = error ?? (status.state === "failed" ? status.message : null);
  if (failed) {
    return (
      <span className="pointer-events-auto flex min-w-0 items-center gap-2 text-[11px] text-danger/90">
        <span className="truncate">The sound couldn’t be made. {failed}</span>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRetry}
          className="inline-flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded-[6px] bg-white/[0.08] px-1.5 text-white/75 outline-none hover:bg-white/[0.14] hover:text-white focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3"
        >
          <RefreshIcon aria-hidden="true" />
          Try again
        </button>
      </span>
    );
  }
  if (status.state === "rendering") {
    return (
      <span className="block overflow-hidden text-[11px]">
        <span key={status.step} className="studio-shimmer block animate-in truncate fade-in slide-in-from-bottom-1 duration-200">
          {status.step || "Composing the sound…"}
        </span>
      </span>
    );
  }
  return null;
}

// The lane under the motion timeline's track: the same width, so the
// waveform lines up with the playhead above it.
export function MotionSoundLane({
  data,
  duration,
  width,
  share,
}: {
  data: SoundLaneData;
  duration: number;
  width: number;
  share: number; // the playhead, 0..1
}) {
  const ready = data.status.state === "ready" && data.peaks && !data.error;
  return (
    <div
      className={cn(
        "relative flex h-6 items-center overflow-hidden rounded-[8px] bg-white/[0.03] px-2",
        ready && "px-0",
        ready && (!data.on || data.muted) && "opacity-60",
      )}
      aria-label={ready ? `Sound design${data.on ? "" : ", off"}${data.muted ? ", muted here" : ""}` : undefined}
    >
      {ready && data.peaks ? (
        <>
          <SoundWave peaks={data.peaks} duration={duration} width={width} height={24} dim={!data.on || data.muted} />
          <div
            className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white/80"
            style={{ left: `${share * 100}%` }}
          />
        </>
      ) : (
        <SoundLine data={data} />
      )}
    </div>
  );
}
