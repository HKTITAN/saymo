"use client";

import { Popover } from "@base-ui/react/popover";
import { useEffect, useState } from "react";
import { DownloadDownIcon, EyeOffIcon, VideoCallIcon } from "@/components/icons";
import { SURFACE } from "@/components/tool/dial";
import type { RenderQuality, RenderStatus } from "@/lib/studio/contract";
import { cn } from "@/lib/utils";
import { api, outUrl, StudioError } from "./api";
import { ConnectionsButton, SavedTo } from "./connections";
import { CARD, Hint, ICON_BUTTON, PANEL_MOTION, PILL_BUTTON } from "./panel";

// Top right: make the video, follow its progress, then download it. One
// render runs at a time across the studio; a second one waits its turn.

const POPUP =
  "origin-(--transform-origin) outline-none transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0";

const OPTION =
  "flex w-full cursor-pointer flex-col gap-0.5 rounded-[9px] px-2.5 py-2 text-left outline-none transition-colors hover:bg-white/[0.07] focus-visible:bg-white/[0.07] disabled:cursor-default disabled:opacity-50";

const FILES: Record<string, string> = {
  "4k.mp4": "4K video",
  "1080p.mp4": "1080p video",
  "draft.mp4": "Draft video",
  "poster.png": "Still",
  "wide-16x9.mp4": "Wide 16:9",
  "square-1x1.mp4": "Square 1:1",
  "portrait-4x5.mp4": "Portrait 4:5",
  "story-9x16.mp4": "Story 9:16",
  "wide-16x9.png": "Wide 16:9 still",
  "square-1x1.png": "Square 1:1 still",
  "portrait-4x5.png": "Portrait 4:5 still",
  "story-9x16.png": "Story 9:16 still",
};
const fileLabel = (name: string) => FILES[name] ?? name;

export function RenderControl({
  id,
  hidden,
  onHide,
  sizes = true,
}: {
  id: string | null;
  hidden: boolean;
  onHide: () => void;
  sizes?: boolean; // offers "Every size" (motion films; not a video edit or a Rust film)
}) {
  const [status, setStatus] = useState<RenderStatus>({ state: "idle" });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped to start following a render again.
  const [follow, setFollow] = useState(0);

  // Asks how the render is going, every 0.8 s while one is going.
  useEffect(() => {
    if (!id) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      const next = await api.renderStatus(id).catch(() => null);
      if (!live || !next) return;
      setStatus(next);
      if (next.state === "running" || next.state === "queued") timer = setTimeout(ask, 800);
    };
    void ask();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id, follow]);

  const start = async (quality: RenderQuality) => {
    if (!id) return;
    setError(null);
    setOpen(false);
    try {
      setStatus(await api.render(id, quality));
      setFollow((n) => n + 1);
    } catch (e) {
      setError(e instanceof StudioError ? e.message : "Unable to start the render. Try again.");
      setOpen(true);
    }
  };

  const working = status.state === "running" || status.state === "queued";
  const progress = status.state === "running" ? status.progress : 0;

  return (
    <div
      inert={hidden}
      className={cn(
        CARD,
        PANEL_MOTION,
        "pointer-events-auto absolute top-4 right-4 flex h-11 w-[300px] items-center gap-1 rounded-[14px] px-1.5",
        hidden && "pointer-events-none -translate-y-1 opacity-0",
      )}
    >
      <Hint label="Hide panels" keys={["H"]}>
        <button type="button" className={cn(ICON_BUTTON, "size-8")} onClick={onHide} aria-label="Hide panels">
          <EyeOffIcon aria-hidden="true" />
        </button>
      </Hint>
      <ConnectionsButton />
      <span className="flex-1" aria-hidden="true" />

      {status.state === "done" && !working ? (
        <Popover.Root>
          <Popover.Trigger className={cn(PILL_BUTTON, "text-white/75 hover:bg-white/[0.08] hover:text-white data-popup-open:bg-white/[0.08]")}>
            <DownloadDownIcon aria-hidden="true" />
            Download
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner side="bottom" align="end" sideOffset={10} collisionPadding={12} className="z-50">
              <Popover.Popup className={cn(SURFACE, POPUP, "flex w-[220px] flex-col gap-0.5 p-1.5")}>
                {status.files.map((f) => (
                  <a
                    key={f}
                    href={id ? outUrl(id, f, true) : undefined}
                    download
                    className="flex min-h-9 items-center gap-2.5 rounded-[9px] px-2.5 text-[12.5px] text-white/80 outline-none transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:bg-white/[0.07] [&>svg]:size-4 [&>svg]:text-white/50"
                  >
                    <DownloadDownIcon aria-hidden="true" />
                    {fileLabel(f)}
                  </a>
                ))}
                {id ? <SavedTo id={id} renderedAt={status.at} /> : null}
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      ) : null}

      {/* While a render runs the button shows its progress and doesn't open. */}
      <Popover.Root open={open} onOpenChange={(next) => setOpen(next && !working)}>
        <Popover.Trigger
          disabled={!id}
          aria-label={working ? "Render in progress" : undefined}
          className={cn(
            PILL_BUTTON,
            "relative overflow-hidden",
            working ? "cursor-default bg-white/[0.08] text-white/85" : "bg-white text-[#141414] hover:bg-white/90",
          )}
        >
          {working ? (
            <>
              <span
                className="absolute inset-y-0 left-0 bg-white/[0.12] transition-[width] duration-500 ease-out"
                style={{ width: `${Math.round(progress * 100)}%` }}
                aria-hidden="true"
              />
              <span className="relative tabular-nums">
                {status.state === "queued" ? "Waiting for another render" : `Rendering ${Math.round(progress * 100)}%`}
              </span>
            </>
          ) : (
            <>
              <VideoCallIcon aria-hidden="true" />
              Render
            </>
          )}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="end" sideOffset={10} collisionPadding={12} className="z-50">
            <Popover.Popup className={cn(SURFACE, POPUP, "flex w-[260px] flex-col gap-0.5 p-1.5")}>
              <button type="button" className={OPTION} onClick={() => start("draft")}>
                <span className="text-[12.5px] text-white/90">Draft</span>
                <span className="text-[11.5px] text-white/45">A quick 1080p video to check the timing</span>
              </button>
              <button type="button" className={OPTION} onClick={() => start("final")}>
                <span className="text-[12.5px] text-white/90">4K video</span>
                <span className="text-[11.5px] text-white/45">The finished film in 4K and 1080p, with a still</span>
              </button>
              {sizes ? (
                <button type="button" className={OPTION} onClick={() => start("sizes")}>
                  <span className="text-[12.5px] text-white/90">Every size</span>
                  <span className="text-[11.5px] text-white/45">Wide, square, portrait and story, each laid out for its frame</span>
                </button>
              ) : null}
              {id ? <SavedTo id={id} renderedAt={status.state === "done" ? status.at : null} /> : null}
              {error || status.state === "failed" ? (
                <p className="px-2.5 pt-1 pb-1.5 text-[11.5px] text-[#ff9592] leading-relaxed">
                  {error ?? (status.state === "failed" ? status.message : null)}
                </p>
              ) : null}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
