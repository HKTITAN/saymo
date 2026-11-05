"use client";

import { type ReactNode, useRef, useState } from "react";
import { DeleteDustbin01Icon, LayerThreeIcon, MusicBeamNoteIcon, UploadUpIcon } from "@/components/icons";
import { Skeleton } from "@/components/skeleton";
import type { GraphicInfo, Media } from "@/lib/studio/edit";
import { cn } from "@/lib/utils";
import { StudioError } from "./api";
import { libraryApi } from "./library-api";
import { Hint, ICON_BUTTON, PILL_BUTTON, Panel } from "./panel";
import { SaveToLibrary } from "./save-to-library";
import { SlideMark, useSlide } from "./slide-mark";
import type { EditState } from "./use-edit";
import { ACCEPTS, mediaUrl, videoApi } from "./video-api";
import { VoiceoverButton } from "./voiceover";

// The bin: the footage, photos and sound brought into this film, and the
// studio's graphics. Drag one onto the timeline, or double-click to put it
// at the playhead. Files dropped anywhere on the studio land here. On hover,
// a bookmark saves a piece of footage to the reference library.

export function MediaBin({
  id,
  ed,
  onAddMedia,
  onAddGraphic,
  folded,
  onFold,
  hidden,
  className,
  pillClassName,
  style,
}: {
  id: string;
  ed: EditState;
  onAddMedia: (media: Media) => void;
  onAddGraphic: (graphic: GraphicInfo) => void;
  folded: boolean;
  onFold: (folded: boolean) => void;
  hidden: boolean;
  className?: string;
  pillClassName?: string;
  style?: React.CSSProperties;
}) {
  const [tab, setTab] = useState<"footage" | "graphics">("footage");
  const tabs = useSlide(tab === "footage" ? 0 : 1);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const used = new Set(ed.edit?.tracks.flatMap((t) => t.items.map((i) => (i.type === "clip" ? i.media : ""))) ?? []);

  const removeMedia = async (m: Media) => {
    setError(null);
    try {
      await videoApi.removeMedia(id, m.id);
      await ed.refreshMedia();
    } catch (e) {
      setError(e instanceof StudioError ? e.message : `Unable to remove ${m.name}. Try again.`);
    }
  };

  return (
    <Panel
      title="Media"
      folded={folded}
      onFold={onFold}
      hidden={hidden}
      className={className}
      pillClassName={pillClassName}
      style={style}
      bodyClassName="flex min-h-0 flex-col"
      actions={
        <>
          <VoiceoverButton id={id} onMade={() => void ed.refreshMedia()} />
          <Hint label="Add media">
            <button type="button" className={ICON_BUTTON} onClick={() => picker.current?.click()} aria-label="Add files">
              <UploadUpIcon aria-hidden="true" />
            </button>
          </Hint>
        </>
      }
    >
      {/* The system's file chooser, opened by the button above. */}
      <input
        ref={picker}
        type="file"
        multiple
        accept={ACCEPTS}
        className="hidden"
        tabIndex={-1}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) void ed.importFiles(files, { append: !ed.edit?.tracks.some((t) => t.items.length) });
        }}
      />

      <div className="relative mx-3 mb-2 flex gap-0.5 rounded-[10px] bg-white/[0.05] p-0.5" role="tablist" aria-label="Footage or graphics">
        <SlideMark mark={tabs.mark} className="rounded-[8px] bg-white/[0.13]" />
        {(["footage", "graphics"] as const).map((k, i) => (
          <button
            key={k}
            ref={tabs.ref(i)}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              "relative h-7 flex-1 cursor-pointer rounded-[8px] text-[12px] outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring",
              tab === k ? cn("text-white", !tabs.mark && "bg-white/[0.13]") : "text-white/50 hover:text-white/80",
            )}
          >
            {k === "footage" ? "Footage" : "Graphics"}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tab === "footage" && !ed.binLoaded ? (
          // The footage is on its way: three rows' worth of shapes.
          <Skeleton loading label="Loading the footage">
            <div className="flex flex-col gap-1">
              {["Interview with Darshan.mov", "Stage wide shot.mp4", "Walk-on music.mp3"].map((name) => (
                <div key={name} className="flex min-h-12 items-center gap-2.5 px-2 py-1.5">
                  <span className="h-9 w-14 shrink-0 rounded-[6px]" skullet-block="" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[12px]">{name}</span>
                    <span className="tabular-nums text-[11px]">0:42 · 1920 × 1080</span>
                  </span>
                </div>
              ))}
            </div>
          </Skeleton>
        ) : tab === "footage" ? (
          <>
            {ed.uploads.map((u) => (
              <div key={u.key} className="flex flex-col gap-1.5 rounded-[10px] bg-white/[0.04] px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12px] text-white/80">{u.name}</span>
                  {u.error ? (
                    <button
                      type="button"
                      onClick={() => ed.dismissUpload(u.key)}
                      className="text-[11.5px] text-white/45 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Dismiss
                    </button>
                  ) : (
                    <span className="text-[11px] text-white/45 tabular-nums">{Math.round(u.progress * 100)}%</span>
                  )}
                </div>
                {u.error ? (
                  <p className="text-[11.5px] text-[#ff9592] leading-relaxed">{u.error}</p>
                ) : (
                  <div className="h-1 overflow-hidden rounded-full bg-white/[0.08]">
                    <div className="h-full rounded-full bg-white/70 transition-[width]" style={{ width: `${u.progress * 100}%` }} />
                  </div>
                )}
              </div>
            ))}
            {ed.media.map((m) => (
              <MediaRow
                key={m.id}
                id={id}
                media={m}
                used={used.has(m.id)}
                onAdd={() => onAddMedia(m)}
                onRemove={() => void removeMedia(m)}
              />
            ))}
            {!ed.media.length && !ed.uploads.length ? (
              <div className="flex flex-col items-start gap-2 px-1.5 py-3">
                <p className="font-medium text-[12.5px] text-white/85">No footage yet</p>
                <p className="text-[12px] text-white/50 leading-relaxed">
                  Drop videos, photos or music anywhere on the studio, or add them here.
                </p>
                <button
                  type="button"
                  onClick={() => picker.current?.click()}
                  className={cn(PILL_BUTTON, "mt-1 bg-white/[0.08] text-white/85 hover:bg-white/[0.12]")}
                >
                  <UploadUpIcon aria-hidden="true" />
                  Add files
                </button>
              </div>
            ) : null}
            {error ? <p className="px-1.5 text-[11.5px] text-[#ff9592] leading-relaxed">{error}</p> : null}
          </>
        ) : (
          <>
            {ed.graphics.map((g) => (
              <button
                key={g.name}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-studio-graphic", g.name);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onDoubleClick={() => onAddGraphic(g)}
                className="flex h-11 cursor-grab items-center gap-2.5 rounded-[10px] px-2 text-left outline-none transition-colors hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-white/[0.07] text-white/55">
                  <LayerThreeIcon aria-hidden="true" className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-white/85">{g.label}</span>
                <span className="text-[11px] text-white/40"><span className="tabular-nums">{g.duration.toFixed(1)}</span>{"\u2009"}s</span>
              </button>
            ))}
            {!ed.graphics.length ? (
              <p className="px-1.5 py-3 text-[12px] text-white/50 leading-relaxed">
                No graphics yet. Ask Claude to make one, such as a lower third with a name and role.
              </p>
            ) : (
              <p className="px-1.5 pt-1 text-[11.5px] text-white/35 leading-relaxed">
                Drag one onto the timeline, or double-click to add it at the playhead.
              </p>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

// The row's picture, in px (w-16 h-10).
const THUMB_W = 64;
const THUMB_H = 40;

// "0:53" or "12:07": whole seconds are enough here (the timeline shows hundredths).
const length = (t: number) => {
  const s = Math.max(1, Math.round(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// "Take 2026-11-05 20.33" and ".mp4", so the extension can sit quieter.
const splitName = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 && name.length - dot <= 6 ? { stem: name.slice(0, dot), ext: name.slice(dot) } : { stem: name, ext: "" };
};

// Where the picture sits in the timeline strip (media.ts thumbStrip: a frame
// every `thumbEvery` seconds): 2/5 of the way in rather than the first
// frame, since a recording often opens on black. Tall frames show a run of
// them side by side, as many as fit.
function stripOffset(media: Media, aspect: number) {
  const frame = THUMB_H * aspect;
  const frames = media.duration && media.thumbEvery ? Math.max(1, Math.ceil(media.duration / media.thumbEvery)) : 1;
  const at = Math.floor(frames * 0.4);
  if (frame >= THUMB_W) return -(Math.min(frames - 1, at) * frame) - (frame - THUMB_W) / 2;
  return -(Math.max(0, Math.min(at, frames - Math.ceil(THUMB_W / frame))) * frame);
}

function MediaRow({
  id,
  media,
  used,
  onAdd,
  onRemove,
}: {
  id: string;
  media: Media;
  used: boolean;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const ready = media.status === "ready";
  const thumb = media.thumbs ? mediaUrl(id, media.id, media.thumbs) : null;
  const aspect = media.width && media.height ? media.width / media.height : 16 / 9;
  const { stem, ext } = splitName(media.name);
  // What's worth knowing at a glance, quietest last.
  const facts: ReactNode[] = [];
  if (used) {
    facts.push(
      <span key="used" className="flex shrink-0 items-center gap-1 text-white/60">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-[#5fd59c]" />
        In the film
      </span>,
    );
  }
  if (media.transcript) facts.push(<span key="words" className="shrink-0">Transcript</span>);
  if (media.kind === "image") facts.push(<span key="kind">Photo</span>);
  else if (!used && media.width && media.height) {
    facts.push(
      <span key="size" className="truncate tabular-nums">
        {media.width} × {media.height}
      </span>,
    );
  } else if (media.kind === "audio" && !facts.length) facts.push(<span key="kind">Sound</span>);
  return (
    <div className="group relative">
      <button
        type="button"
        draggable={ready}
        disabled={!ready && media.status !== "failed"}
        onDragStart={(e) => {
          e.dataTransfer.setData("application/x-studio-media", media.id);
          e.dataTransfer.effectAllowed = "copy";
        }}
        onDoubleClick={() => ready && onAdd()}
        className={cn(
          "flex min-h-12 w-full items-center gap-2.5 rounded-[10px] px-1.5 py-1 text-left outline-none transition-colors focus-visible:bg-white/[0.07] focus-visible:ring-1 focus-visible:ring-white/15 focus-visible:ring-inset",
          ready ? "cursor-grab hover:bg-white/[0.06] active:cursor-grabbing" : "cursor-default",
        )}
        aria-label={ready ? `${media.name}. Double-click to add it at the playhead` : media.name}
      >
        <span className="relative flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[7px] bg-white/[0.07] text-white/45">
          {thumb && media.kind === "image" ? (
            <span className="absolute inset-0 bg-center bg-cover" style={{ backgroundImage: `url(${thumb})` }} />
          ) : thumb && media.kind === "video" ? (
            <span
              className="absolute inset-0 bg-no-repeat"
              style={{ backgroundImage: `url(${thumb})`, backgroundSize: "auto 100%", backgroundPosition: `${stripOffset(media, aspect)}px 0` }}
            />
          ) : media.kind === "audio" ? (
            <MusicBeamNoteIcon aria-hidden="true" className="size-4" />
          ) : null}
          {media.kind !== "image" && media.duration ? (
            <span className="absolute right-1 bottom-1 rounded-[4px] bg-black/70 px-[3px] text-[9.5px] text-white/90 leading-[13px] tabular-nums">
              {length(media.duration)}
            </span>
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline">
            <span className="truncate text-[12px] text-white/85">{stem}</span>
            {ext ? <span className="shrink-0 text-[12px] text-white/30">{ext}</span> : null}
          </span>
          {media.status === "importing" ? (
            // One line that changes in place as the import moves on.
            <span key={media.step} className="studio-shimmer truncate text-[11.5px] text-white/50">
              {media.step ?? "Getting it ready"}
            </span>
          ) : media.status === "failed" ? (
            <span className="truncate text-[11.5px] text-[#ff9592]">{media.error ?? "Unable to read this file"}</span>
          ) : media.transcribing ? (
            <span className="studio-shimmer truncate text-[11.5px] text-white/50">Writing down what’s said</span>
          ) : facts.length ? (
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-white/40">
              {facts.flatMap((fact, i) =>
                i
                  ? [
                      <span key={`dot${String(i)}`} aria-hidden="true" className="text-white/20">
                        ·
                      </span>,
                      fact,
                    ]
                  : [fact],
              )}
            </span>
          ) : null}
        </span>
      </button>
      {media.status !== "importing" ? (
        // Save and remove, on hover: a small toolbar floating over the row's end.
        <span className="absolute end-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-[9px] bg-[#262626] p-0.5 opacity-0 shadow-[0_4px_12px_rgba(0,0,0,0.45)] transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
          {ready ? (
            <SaveToLibrary
              className="size-7 rounded-[7px] [&_svg]:size-4"
              save={() => libraryApi.fromFilm({ film: id, media: media.id })}
            />
          ) : null}
          {!used ? (
            <Hint label={`Remove ${media.name}`}>
              <button type="button" onClick={onRemove} aria-label={`Remove ${media.name}`} className={cn(ICON_BUTTON, "size-7 rounded-[7px]")}>
                <DeleteDustbin01Icon aria-hidden="true" />
              </button>
            </Hint>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
